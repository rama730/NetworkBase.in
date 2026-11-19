import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// Workflow tabs A0.6 (report 38.3 F2 S4, W6, call 6): Record a decision files a document under Decisions with the
// workspace's next D-number; numbers never repeat, even recorded at the same moment, and moving keeps them.

let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.174" }), cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) });
stubNextAfter();

let docs: typeof import("../../src/app/actions/workspace/doc");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerIdentityContext: async () => ({ user: viewerId ? { id: viewerId } : null, userId: viewerId || null, profile: null }),
  });
  docs = await loadAppModule(() => import("../../src/app/actions/workspace/doc"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

async function workspace(editPolicy = "leaders") {
  const [owner, member, viewer] = await Promise.all([1, 2, 3].map(() => sql.begin((tx) => createUser(tx))));
  const ws = await sql.begin((tx) => createProject(tx, owner!));
  created.push(ws);
  await sql`UPDATE workspaces SET workflows_enabled = true WHERE id = ${ws}`;
  await sql`INSERT INTO workspace_workflows (workspace_id, workflow, added_by) VALUES (${ws}, 'meetings', ${owner!})`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${ws}, ${owner!}, 'owner'), (${ws}, ${member!}, 'member'), (${ws}, ${viewer!}, 'viewer')`;
  const doc = async (slug: string) => {
    const [node] = await sql`INSERT INTO workspace_nodes (workspace_id, type, name, path, created_by) VALUES (${ws}, 'file', ${slug + ".md"}, ${"/" + slug + ".md"}, ${owner!}) RETURNING id`;
    const [row] = await sql`INSERT INTO workspace_documents (workspace_id, linked_node_id, slug, filename, settings) VALUES (${ws}, ${node!.id}, ${slug}, ${slug + ".md"}, ${sql.json({ version: 1, editPolicy, visibilityOverride: "inherit_workspace", externalImages: false, projectBlocks: true })}) RETURNING id`;
    return row!.id as string;
  };
  return { owner: owner!, member: member!, viewer: viewer!, ws, doc };
}
const settingsOf = async (id: string) => (await sql`SELECT settings FROM workspace_documents WHERE id = ${id}`)[0]!.settings;

test("W6: recording files the document under Decisions as D-1, Decided, today, from the meeting; the next is D-2", async () => {
  const t = await workspace();
  viewerId = t.owner;
  const weekly = await t.doc("weekly");
  const first = await t.doc("use-postgres");
  await t.doc("ship-friday");
  const r1 = await docs.recordDecisionAction(t.ws, { docSlug: "use-postgres", fromDocSlug: "weekly" });
  assert.deepEqual(r1, { success: true, number: 1, label: "D-001" });
  const s = await settingsOf(first);
  assert.deepEqual([s.section, s.decisionNumber, s.decisionStatus, s.fromDocId, s.date], ["decisions", 1, "decided", weekly, new Date().toISOString().slice(0, 10)]);
  const r2 = await docs.recordDecisionAction(t.ws, { docSlug: "ship-friday" });
  assert.deepEqual(r2, { success: true, number: 2, label: "D-002" });
  assert.deepEqual(await docs.recordDecisionAction(t.ws, { docSlug: "use-postgres" }), { success: true, number: 1, label: "D-001" }, "recording again keeps its number");
  const list = await docs.listWorkspaceDocsAction(t.ws);
  assert.ok(list.success);
  assert.deepEqual(list.docs.filter((d) => d.decisionNumber).map((d) => [d.slug, d.decisionNumber, d.decisionStatus, d.fromDocId ?? null]), [["ship-friday", 2, "decided", null], ["use-postgres", 1, "decided", weekly]]);
});

test("call 6: five decisions recorded at the same moment get five different numbers", async () => {
  const t = await workspace();
  viewerId = t.owner;
  for (const n of [1, 2, 3, 4, 5]) await t.doc(`d${n}`);
  const results = await Promise.all([1, 2, 3, 4, 5].map((n) => docs.recordDecisionAction(t.ws, { docSlug: `d${n}` })));
  assert.deepEqual(results.map((r) => (r.success ? r.number : 0)).sort(), [1, 2, 3, 4, 5]);
});

test("permissions: a member can't record from a leaders-only meeting; a viewer can't record at all", async () => {
  const t = await workspace("leaders");
  await t.doc("weekly");
  await t.doc("idea");
  viewerId = t.member;
  assert.equal((await docs.recordDecisionAction(t.ws, { docSlug: "idea", fromDocSlug: "weekly" })).success, false);
  viewerId = t.viewer;
  assert.equal((await docs.recordDecisionAction(t.ws, { docSlug: "idea" })).success, false);
  const [row] = await sql`SELECT count(*)::int AS n FROM workspace_documents WHERE workspace_id = ${t.ws} AND settings ? 'decisionNumber'`;
  assert.equal(row!.n, 0);
});

test("Move to section: into Decisions numbers the document; back to Pages keeps its number", async () => {
  const t = await workspace();
  viewerId = t.owner;
  const id = await t.doc("plan");
  assert.equal((await docs.moveDocToSectionAction(t.ws, { docSlug: "plan", section: "decisions" })).success, true);
  assert.equal((await settingsOf(id)).decisionNumber, 1);
  assert.equal((await docs.moveDocToSectionAction(t.ws, { docSlug: "plan", section: "pages" })).success, true);
  const s = await settingsOf(id);
  assert.deepEqual([s.section ?? null, s.decisionNumber], [null, 1]);
});

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// Workflow tabs A4.1 (report 38.11 D1): meetings, series, Finish with carried action items, reminders, Open action items.


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
let taskActions: typeof import("../../src/app/actions/task");
let tasksServer: typeof import("../../src/lib/workspaces/server/tasks");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerIdentityContext: async () => ({ user: viewerId ? { id: viewerId } : null, userId: viewerId || null, profile: null }),
  });
  docs = await loadAppModule(() => import("../../src/app/actions/workspace/doc"));
  taskActions = await loadAppModule(() => import("../../src/app/actions/task"));
  tasksServer = await loadAppModule(() => import("../../src/lib/workspaces/server/tasks"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

async function workspace() {
  const [owner, member, viewer, outsider] = await Promise.all([1, 2, 3, 4].map(() => sql.begin((tx) => createUser(tx))));
  const ws = await sql.begin((tx) => createProject(tx, owner!));
  created.push(ws);
  await sql`UPDATE workspaces SET workflows_enabled = true, time_zone = 'Asia/Kolkata' WHERE id = ${ws}`;
  await sql`INSERT INTO workspace_workflows (workspace_id, workflow, added_by) VALUES (${ws}, 'offsite', ${owner!})`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${ws}, ${owner!}, 'owner'), (${ws}, ${member!}, 'member'), (${ws}, ${viewer!}, 'viewer')`;
  const doc = async (slug: string) => {
    const [node] = await sql`INSERT INTO workspace_nodes (workspace_id, type, name, path, created_by) VALUES (${ws}, 'file', ${slug + ".md"}, ${"/" + slug + ".md"}, ${owner!}) RETURNING id`;
    const [row] = await sql`INSERT INTO workspace_documents (workspace_id, linked_node_id, slug, filename, settings) VALUES (${ws}, ${node!.id}, ${slug}, ${slug + ".md"}, ${sql.json({ version: 1, editPolicy: "leaders", visibilityOverride: "inherit_workspace", externalImages: false, projectBlocks: true })}) RETURNING id`;
    return row!.id as string;
  };
  return { owner: owner!, member: member!, viewer: viewer!, outsider: outsider!, ws, doc };
}
const settingsOf = async (id: string) => (await sql`SELECT settings FROM workspace_documents WHERE id = ${id}`)[0]!.settings;
const ist = (s: string) => new Date(`${s}+05:30`).toISOString();

test("W1–W3: an off-site files its dates and invitees (members only), adds the checklist rows with one Book travel per invitee, and tells invitees", async () => {
  const t = await workspace();
  viewerId = t.owner;
  const id = await t.doc("offsite");
  const made = await docs.createOffsiteAction(t.ws, { docSlug: "offsite", name: "Team off-site", dateFrom: "2099-03-04", dateTo: "2099-03-06", place: "Goa", invitedIds: [t.owner, t.member, t.outsider] });
  assert.ok(made.success, JSON.stringify(made));
  const s = await settingsOf(id);
  assert.deepEqual([s.section, s.offsiteTitle, s.dateFrom, s.dateTo, s.place, s.invitedIds, s.visibilityOverride], ["offsite", "Team off-site", "2099-03-04", "2099-03-06", "Goa", [t.owner, t.member], "members_only"]);
  const rows = await sql`SELECT title, source_block, assignee_id FROM tasks WHERE source_doc_id = ${id} ORDER BY source_block, source_position`;
  assert.deepEqual(rows.filter((r) => r.source_block === "before").map((r) => r.title), ["Pick dates", "Book venue", "Share agenda"]);
  assert.deepEqual(rows.filter((r) => r.source_block === "travel").map((r) => [r.title.startsWith("Book travel — ") || r.title, r.assignee_id]).sort(),
    [[true, t.member], [true, t.owner], ["Book rooms", null]].sort());
  assert.deepEqual(rows.filter((r) => r.source_block === "after").map((r) => r.title), ["Share notes", "Upload photos"]);
  assert.equal((await sql`SELECT count(*)::int AS n FROM user_notifications WHERE user_id = ${t.member} AND title = 'Off-site: Team off-site · are you going?'`)[0]!.n, 1);
  const listed = await docs.listWorkspaceDocsAction(t.ws);
  assert.ok(listed.success);
  assert.equal(listed.docs.find((d) => d.slug === "offsite")?.title, "Team off-site");
});

test("W2 and part 8: invitees answer Going / Can't go; counts; others can't answer; outsiders see nothing; the upcoming list", async () => {
  const t = await workspace();
  viewerId = t.owner;
  await t.doc("offsite");
  const soon = new Date(Date.now() + 12 * 86_400_000).toISOString().slice(0, 10);
  assert.ok((await docs.createOffsiteAction(t.ws, { docSlug: "offsite", name: "Team off-site", dateFrom: soon, dateTo: soon, invitedIds: [t.owner, t.member] })).success);
  viewerId = t.member;
  assert.ok((await docs.answerOffsiteAction(t.ws, { docSlug: "offsite", answer: "cant" })).success);
  assert.ok((await docs.answerOffsiteAction(t.ws, { docSlug: "offsite", answer: "going" })).success, "answers can change");
  viewerId = t.viewer;
  assert.equal((await docs.answerOffsiteAction(t.ws, { docSlug: "offsite", answer: "going" }) as { error?: string }).error, "Only people invited to this off-site answer.");
  const read = await docs.readOffsiteAction(t.ws, "offsite");
  assert.ok(read.success);
  assert.deepEqual([read.counts, read.mine], [{ going: 1, cant: 0, unanswered: 1 }, null]);
  viewerId = t.owner;
  const mine = await docs.readOffsiteAction(t.ws, "offsite");
  assert.ok(mine.success && mine.mine === "none");
  const up = await docs.readUpcomingOffsitesAction(t.ws);
  assert.ok(up.success);
  assert.deepEqual(up.offsites.map((o) => [o.name, o.counts.unanswered]), [["Team off-site", 1]]);
  // Days are counted from the workspace's own day (Kolkata here), so 11 or 12 from a UTC clock.
  assert.ok([11, 12].includes(up.offsites[0]!.days), String(up.offsites[0]!.days));
  await sql`UPDATE workspaces SET visibility = 'public' WHERE id = ${t.ws}`;
  viewerId = t.outsider;
  assert.equal((await docs.readOffsiteAction(t.ws, "offsite") as { error?: string }).error, "Off-sites are for workspace members.");
});

test("security review: an off-site's checklist rows never reach someone outside the workspace, even with a public Tasks tab", async () => {
  const t = await workspace();
  viewerId = t.owner;
  await t.doc("offsite");
  assert.ok((await docs.createOffsiteAction(t.ws, { docSlug: "offsite", name: "Retreat", dateFrom: "2099-03-04", dateTo: "2099-03-04", invitedIds: [t.member] })).success);
  const [row] = await sql`SELECT id FROM tasks WHERE workspace_id = ${t.ws} AND source_block = 'travel' AND title LIKE 'Book travel%'`;
  await sql`UPDATE workspaces SET visibility = 'public', public_tab_visibility = '{"tasks": true}'::jsonb WHERE id = ${t.ws}`;
  const detail = async () => { const r = await tasksServer.getWorkspaceTaskDetailAction(t.ws, row!.id) as { success?: boolean; task?: { title: string } | null }; return r.success && r.task ? r.task.title : null; };
  assert.match((await detail())!, /^Book travel/, "members see it");
  viewerId = t.outsider;
  assert.equal(await detail(), null);
});

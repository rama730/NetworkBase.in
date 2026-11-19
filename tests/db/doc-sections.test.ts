import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// Workflow tabs A0.4 (report 38.3 F2 W2, S1, S2, call 7): Move to section writes settings only, only into sections whose
// workflow is added, only for people who can edit; the docs list carries the section; a later settings save keeps it.

let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.173" }), cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) });
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

async function workspace() {
  const [owner, viewer] = await Promise.all([1, 2].map(() => sql.begin((tx) => createUser(tx))));
  const ws = await sql.begin((tx) => createProject(tx, owner!));
  created.push(ws);
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${ws}, ${owner!}, 'owner'), (${ws}, ${viewer!}, 'viewer')`;
  await sql`UPDATE workspaces SET workflows_enabled = true WHERE id = ${ws}`;
  const [node] = await sql`INSERT INTO workspace_nodes (workspace_id, type, name, path, created_by) VALUES (${ws}, 'file', 'Weekly.md', '/Weekly.md', ${owner!}) RETURNING id`;
  await sql`INSERT INTO workspace_documents (workspace_id, linked_node_id, slug, filename, created_at) VALUES (${ws}, ${node!.id}, 'weekly', 'Weekly.md', '2026-11-12T09:00:00Z')`;
  return { owner: owner!, viewer: viewer!, ws };
}
const settings = async (ws: string) => (await sql`SELECT settings FROM workspace_documents WHERE workspace_id = ${ws} AND slug = 'weekly'`)[0]!.settings;
const errorOf = (r: { success: boolean; error?: string }) => (r.success ? "" : r.error ?? "");

test("only sections whose workflow is added; a meeting takes the document's date; the list carries it", async () => {
  const t = await workspace();
  viewerId = t.owner;
  assert.match(errorOf(await docs.moveDocToSectionAction(t.ws, { docSlug: "weekly", section: "meetings" })), /isn’t in this workspace/);
  await sql`INSERT INTO workspace_workflows (workspace_id, workflow) VALUES (${t.ws}, 'meetings')`;
  const moved = await docs.moveDocToSectionAction(t.ws, { docSlug: "weekly", section: "meetings" });
  assert.deepEqual(moved.success && [moved.section, moved.date], ["meetings", "2026-11-12"]);
  const [versions] = await sql`SELECT count(*)::int AS n FROM workspace_document_versions WHERE doc_id IN (SELECT id FROM workspace_documents WHERE workspace_id = ${t.ws})`;
  assert.equal(versions!.n, 0, "no version is written (call 7)");
  const list = await docs.listWorkspaceDocsAction(t.ws);
  assert.ok(list.success && list.docs.some((d) => d.slug === "weekly" && d.section === "meetings" && d.date === "2026-11-12"), JSON.stringify(list));
});

test("a settings save keeps the section; moving back to Pages clears it; viewers can't move", async () => {
  const t = await workspace();
  await sql`INSERT INTO workspace_workflows (workspace_id, workflow) VALUES (${t.ws}, 'meetings')`;
  viewerId = t.owner;
  await docs.moveDocToSectionAction(t.ws, { docSlug: "weekly", section: "meetings", date: "2026-11-19", kind: "standup" });
  assert.equal((await docs.updateWorkspaceDocSettingsAction(t.ws, { docSlug: "weekly", editPolicy: "members" })).success, true);
  const kept = await settings(t.ws);
  assert.deepEqual([kept.section, kept.date, kept.kind, kept.editPolicy], ["meetings", "2026-11-19", "standup", "members"]);
  viewerId = t.viewer;
  assert.match(errorOf(await docs.moveDocToSectionAction(t.ws, { docSlug: "weekly", section: "pages" })), /Only people who can edit/);
  viewerId = t.owner;
  assert.equal((await docs.moveDocToSectionAction(t.ws, { docSlug: "weekly", section: "pages" })).success, true);
  const back = await settings(t.ws);
  assert.deepEqual([back.section, back.date, back.kind, back.editPolicy], [undefined, undefined, undefined, "members"]);
});

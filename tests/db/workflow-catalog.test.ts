import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// Workflow tabs A0.2 (report 38.2 F1 S2, S3, S8, calls 3, 4, 7, 10): owners and admins add and hide workflows; members
// and the public never change them; Undo works for 10 seconds while nothing was made; a pushed workflow is locked.

let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.172" }), cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) });
stubNextAfter();

let actions: typeof import("../../src/app/actions/workflows");
let activity: typeof import("../../src/app/actions/workspace/recent-activity");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerIdentityContext: async () => ({ user: viewerId ? { id: viewerId } : null, userId: viewerId || null, profile: null }),
  });
  // Bugs' round (A2.1) isn't built yet; the tests stand in for it. Project planner stays unbuilt.
  const catalog = await loadAppModule(() => import("../../src/lib/workflows/catalog"));
  catalog.catalogEntry("bugs")!.built = true;
  actions = await loadAppModule(() => import("../../src/app/actions/workflows"));
  activity = await loadAppModule(() => import("../../src/app/actions/workspace/recent-activity"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

async function workspace(opts: { on?: boolean; visibility?: string } = {}) {
  const [owner, admin, member, viewer, outsider] = await Promise.all([1, 2, 3, 4, 5].map(() => sql.begin((tx) => createUser(tx))));
  const ws = await sql.begin((tx) => createProject(tx, owner!, { visibility: opts.visibility ?? "public" }));
  created.push(ws);
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${ws}, ${owner!}, 'owner'), (${ws}, ${admin!}, 'admin'), (${ws}, ${member!}, 'member'), (${ws}, ${viewer!}, 'viewer')`;
  await sql`UPDATE workspaces SET workflows_enabled = ${opts.on ?? true} WHERE id = ${ws}`;
  return { owner: owner!, admin: admin!, member: member!, viewer: viewer!, outsider: outsider!, ws };
}
const added = async (ws: string) => {
  const res = await actions.readWorkflowsAction(ws);
  assert.ok(res.success, JSON.stringify(res));
  return res.success ? res.added.map((w) => w.workflow) : [];
};
const errorOf = (res: { success: boolean; error?: string }) => (res.success ? "" : res.error ?? "");

test("with the switch off nothing shows and nothing can be added", async () => {
  const t = await workspace({ on: false });
  viewerId = t.owner;
  const read = await actions.readWorkflowsAction(t.ws);
  assert.deepEqual(read.success && { enabled: read.enabled, added: read.added }, { enabled: false, added: [] });
  assert.match(errorOf(await actions.addWorkflowAction({ workspaceId: t.ws, workflow: "bugs" })), /aren’t on/);
});

test("owners and admins add; adding twice is a no-op; members, viewers and outsiders can't; the public sees nothing", async () => {
  const t = await workspace();
  viewerId = t.member;
  assert.match(errorOf(await actions.addWorkflowAction({ workspaceId: t.ws, workflow: "bugs" })), /Only owners and admins/);
  viewerId = t.viewer;
  assert.match(errorOf(await actions.addWorkflowAction({ workspaceId: t.ws, workflow: "bugs" })), /Only owners and admins/);
  viewerId = t.admin;
  const first = await actions.addWorkflowAction({ workspaceId: t.ws, workflow: "bugs" });
  assert.deepEqual(first.success && [first.name, first.alreadyAdded], ["Bugs", false]);
  const again = await actions.addWorkflowAction({ workspaceId: t.ws, workflow: "bugs" });
  assert.equal(again.success && again.alreadyAdded, true);
  const [count] = await sql`SELECT count(*)::int AS n FROM workspace_workflows WHERE workspace_id = ${t.ws}`;
  assert.equal(count!.n, 1);

  viewerId = t.member;
  const memberView = await actions.readWorkflowsAction(t.ws);
  assert.deepEqual(memberView.success && [memberView.canManage, memberView.added.map((w) => w.workflow)], [false, ["bugs"]]);
  viewerId = t.viewer;
  assert.deepEqual(await added(t.ws), ["bugs"], "viewers see workflow tabs");
  viewerId = t.outsider;
  assert.deepEqual(await added(t.ws), [], "never the public (B11)");
  viewerId = t.owner;
  const ownerView = await actions.readWorkflowsAction(t.ws);
  assert.ok(ownerView.success && ownerView.canManage && ownerView.added[0]!.addedBy, "Settings names who added it");
});

test("workflows whose round isn't built, and unknown ones, are refused", async () => {
  const t = await workspace();
  viewerId = t.owner;
  assert.match(errorOf(await actions.addWorkflowAction({ workspaceId: t.ws, workflow: "project_planner" })), /coming later/);
  assert.match(errorOf(await actions.addWorkflowAction({ workspaceId: t.ws, workflow: "pipeline" })), /Unknown workflow/);
});

test("Undo removes it within 10 seconds, only for the person who added it, and not once an item exists (call 7)", async () => {
  const t = await workspace();
  viewerId = t.owner;
  await actions.addWorkflowAction({ workspaceId: t.ws, workflow: "bugs" });
  viewerId = t.admin;
  assert.match(errorOf(await actions.undoAddWorkflowAction({ workspaceId: t.ws, workflow: "bugs" })), /Can’t undo now/);
  viewerId = t.owner;
  const undone = await actions.undoAddWorkflowAction({ workspaceId: t.ws, workflow: "bugs" });
  assert.equal(undone.success, true, JSON.stringify(undone));
  assert.deepEqual(await added(t.ws), []);

  await actions.addWorkflowAction({ workspaceId: t.ws, workflow: "bugs" });
  await sql`INSERT INTO tasks (workspace_id, creator_id, title, status, item_type, stage, on_board) VALUES (${t.ws}, ${t.owner}, 'A bug', 'todo', 'bug', 'new', false)`;
  assert.match(errorOf(await actions.undoAddWorkflowAction({ workspaceId: t.ws, workflow: "bugs" })), /Can’t undo: 1 item was added/);

  await sql`UPDATE workspace_workflows SET added_at = now() - interval '11 seconds' WHERE workspace_id = ${t.ws}`;
  await sql`DELETE FROM tasks WHERE workspace_id = ${t.ws}`;
  assert.match(errorOf(await actions.undoAddWorkflowAction({ workspaceId: t.ws, workflow: "bugs" })), /Can’t undo now/, "after 10 seconds");
});

test("Remove hides: counts first, everything kept, adding again brings it back (call 4, S3)", async () => {
  const t = await workspace();
  viewerId = t.owner;
  await actions.addWorkflowAction({ workspaceId: t.ws, workflow: "bugs" });
  const col = (await sql`SELECT id FROM workspace_workflow_columns WHERE workspace_id = ${t.ws} AND status = 'in_progress' AND is_default`)[0]!.id;
  await sql`INSERT INTO tasks (workspace_id, creator_id, title, status, item_type, stage, on_board, workflow_column_id) VALUES
    (${t.ws}, ${t.owner}, 'New one', 'todo', 'bug', 'new', false, null),
    (${t.ws}, ${t.owner}, 'Being fixed', 'in_progress', 'bug', 'fixing', true, ${col}),
    (${t.ws}, ${t.owner}, 'Closed', 'done', 'bug', 'wont_fix', false, null)`;
  const counts = await actions.workflowRemovalCountsAction({ workspaceId: t.ws, workflow: "bugs" });
  assert.deepEqual(counts.success && [counts.total, counts.open, counts.onBoard], [3, 2, 1]);
  viewerId = t.member;
  assert.match(errorOf(await actions.removeWorkflowAction({ workspaceId: t.ws, workflow: "bugs" })), /Only owners and admins/);
  viewerId = t.owner;
  const hidden = await actions.removeWorkflowAction({ workspaceId: t.ws, workflow: "bugs" });
  assert.deepEqual(hidden.success && [hidden.name, hidden.total], ["Bugs", 3]);
  assert.deepEqual(await added(t.ws), []);
  const [kept] = await sql`SELECT count(*)::int AS n FROM tasks WHERE workspace_id = ${t.ws} AND item_type = 'bug' AND deleted_at IS NULL`;
  assert.equal(kept!.n, 3, "nothing is deleted");
  assert.match(errorOf(await actions.removeWorkflowAction({ workspaceId: t.ws, workflow: "bugs" })), /isn’t added here/);
  await actions.addWorkflowAction({ workspaceId: t.ws, workflow: "bugs" });
  assert.deepEqual(await added(t.ws), ["bugs"]);
});

test("a workflow the organization pushes shows locked in the child and can't be removed there", async () => {
  const t = await workspace();
  const [org] = await sql`INSERT INTO workspaces (owner_id, title, slug, visibility, status, kind) VALUES (${t.owner}, 'Northgate CS', ${`org-${t.ws}`}, 'private', 'active', 'organization') RETURNING id`;
  created.unshift(org!.id);
  await sql`UPDATE workspaces SET parent_id = ${org!.id} WHERE id = ${t.ws}`;
  await sql`INSERT INTO workspace_workflows (workspace_id, workflow, push_to_children) VALUES (${org!.id}, 'bugs', true)`;
  viewerId = t.admin;
  const view = await actions.readWorkflowsAction(t.ws);
  assert.deepEqual(view.success && view.added, [{ workflow: "bugs", locked: true, by: "Northgate CS", addedAt: view.success ? view.added[0]!.addedAt : null, addedBy: null }]);
  assert.match(errorOf(await actions.removeWorkflowAction({ workspaceId: t.ws, workflow: "bugs" })), /Only Northgate CS can remove Bugs/);
});

test("adding and hiding go into the workspace activity, for insiders only (call 8)", async () => {
  const t = await workspace();
  viewerId = t.owner;
  await actions.addWorkflowAction({ workspaceId: t.ws, workflow: "bugs" });
  const [name] = await sql`SELECT full_name FROM profiles WHERE id = ${t.owner}`;
  let rows = await activity.readWorkspaceRecentActivityAction(t.ws);
  assert.ok(rows.some((r) => r.type === "workflow" && r.text === `${name!.full_name} added Bugs`), JSON.stringify(rows));
  await actions.removeWorkflowAction({ workspaceId: t.ws, workflow: "bugs" });
  rows = await activity.readWorkspaceRecentActivityAction(t.ws);
  assert.ok(rows.some((r) => r.type === "workflow" && r.text === `${name!.full_name} hid Bugs`));
  await sql`UPDATE workspaces SET public_tab_visibility = jsonb_set(public_tab_visibility, '{dashboard}', 'true') WHERE id = ${t.ws}`;
  viewerId = t.outsider;
  rows = await activity.readWorkspaceRecentActivityAction(t.ws);
  assert.ok(!rows.some((r) => r.type === "workflow"), "visitors never see workflow activity");
});

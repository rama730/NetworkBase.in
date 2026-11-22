import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// Workflow tabs A2.1 (report 38.6 T3): reporting with bug fields, Similar open bugs, I see this too, Confirm,
// the panel's fields, reads for members and viewers only, notices for owners and admins, and the tab's count.
let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.175" }), cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) });
stubNextAfter();

let tasksServer: typeof import("../../src/lib/workspaces/server/tasks");
let bugs: typeof import("../../src/app/actions/bugs");
let workflows: typeof import("../../src/lib/workflows/server");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerIdentityContext: async () => ({ user: viewerId ? { id: viewerId } : null, userId: viewerId || null, profile: null }),
  });
  tasksServer = await loadAppModule(() => import("../../src/lib/workspaces/server/tasks"));
  bugs = await loadAppModule(() => import("../../src/app/actions/bugs"));
  workflows = await loadAppModule(() => import("../../src/lib/workflows/server"));
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
  await sql`UPDATE workspaces SET workflows_enabled = true WHERE id = ${ws}`;
  await sql`INSERT INTO workspace_workflows (workspace_id, workflow, added_by) VALUES (${ws}, 'bugs', ${owner!})`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${ws}, ${owner!}, 'owner'), (${ws}, ${member!}, 'member'), (${ws}, ${viewer!}, 'viewer')`;
  return { owner: owner!, member: member!, viewer: viewer!, outsider: outsider!, ws };
}
const report = async (ws: string, title: string, typeFields: Record<string, unknown> = {}, stage = "new") => {
  const r = await tasksServer.createTaskAction({ projectId: ws, title, status: "todo", priority: "medium", itemType: "bug", stage, typeFields } as never);
  assert.ok(r.success && "task" in r && r.task, JSON.stringify(r));
  return (r as { task: { id: string } }).task.id;
};
const row = async (id: string) => (await sql`SELECT stage, priority, assignee_id, type_fields FROM tasks WHERE id = ${id}`)[0]!;
const notes = async (user: string) => (await sql`SELECT title, importance FROM user_notifications WHERE user_id = ${user} AND kind = 'project_task_activity' ORDER BY created_at`).map((r) => `${r.title} (${r.importance})`);

test("W2: a member reports with bug fields; severity sets priority; owners hear; unknown fields refused", async () => {
  const t = await workspace();
  viewerId = t.member;
  const a = await report(t.ws, "Payment gateway is down", { severity: "major", steps: "Open\nPay", where: { kind: "web", browser: "Firefox", version: "132" } });
  assert.deepEqual([(await row(a)).stage, (await row(a)).priority, ((await row(a)).type_fields as { where: { browser: string } }).where.browser], ["new", "high", "Firefox"]);
  assert.deepEqual(await notes(t.owner), ["New bug: Payment gateway is down (important)"]);
  assert.deepEqual(await notes(t.member), [], "the reporter isn't told about their own report");
  const bad = await tasksServer.createTaskAction({ projectId: t.ws, title: "X", status: "todo", priority: "medium", itemType: "bug", stage: "new", typeFields: { owner: "me" } } as never);
  assert.equal((bad as { error?: string }).error, "Bug has no field “owner”");
  viewerId = t.viewer;
  await report(t.ws, "Viewer report");
  // Viewers report bugs at New only: no plain tasks, no bug that starts further on.
  assert.equal((await tasksServer.createTaskAction({ projectId: t.ws, title: "Plain", status: "todo", priority: "medium" } as never)).success, false);
  assert.equal((await tasksServer.createTaskAction({ projectId: t.ws, title: "Skip", status: "todo", priority: "medium", itemType: "bug", stage: "confirmed" } as never)).success, false);
  assert.equal((await tasksServer.createTaskAction({ projectId: t.ws, title: "No stage", status: "todo", priority: "medium", itemType: "bug" } as never)).success, false, "no stage would start at Fixing");
  assert.equal((await workflows.readWorkspaceWorkflows(t.ws, t.owner)).waiting?.bugs, 2, "the tab counts New bugs");
});

test("W2–W3: Similar open bugs never shows closed ones; That's my bug adds you once, as a watcher; Undo removes", async () => {
  const t = await workspace();
  viewerId = t.owner;
  const open = await report(t.ws, "Payment gateway is down");
  const closed = await report(t.ws, "Payment page typo");
  await sql`UPDATE tasks SET stage = 'wont_fix', status = 'done' WHERE id = ${closed}`;
  viewerId = t.viewer;
  const found = await bugs.similarBugsAction({ projectId: t.ws, title: "payment" });
  assert.ok(found.success);
  assert.deepEqual(found.bugs.map((b) => b.title), ["Payment gateway is down"]);
  const loose = await bugs.similarBugsAction({ projectId: t.ws, title: "Payment fails" });
  assert.deepEqual(loose.success && loose.bugs.map((b) => b.title), ["Payment gateway is down"], "any word matches (live check)");
  assert.deepEqual((await bugs.similarBugsAction({ projectId: t.ws, title: "pay" })).success && [], [], "under 4 characters: nothing");
  await bugs.seeTooAction({ projectId: t.ws, taskId: open, on: true });
  await bugs.seeTooAction({ projectId: t.ws, taskId: open, on: true });
  assert.deepEqual(((await row(open)).type_fields as { alsoSeen: string[] }).alsoSeen, [t.viewer]);
  assert.equal((await sql`SELECT count(*)::int AS n FROM task_watchers WHERE task_id = ${open} AND user_id = ${t.viewer}`)[0]!.n, 1);
  await bugs.seeTooAction({ projectId: t.ws, taskId: open, on: false });
  assert.deepEqual(((await row(open)).type_fields as { alsoSeen: string[] }).alsoSeen, []);
});

test("W4: Confirm needs a member and a severity; Urgent sets priority, assigns, and tells owners and admins", async () => {
  const t = await workspace();
  viewerId = t.viewer;
  const bug = await report(t.ws, "Crash on export");
  assert.equal((await bugs.confirmBugAction({ projectId: t.ws, taskId: bug, severity: "urgent" })).success, false, "viewers can't triage");
  viewerId = t.member;
  assert.deepEqual(await bugs.confirmBugAction({ projectId: t.ws, taskId: bug, severity: undefined as never }), { success: false, error: "Pick a severity to confirm" });
  assert.deepEqual(await bugs.confirmBugAction({ projectId: t.ws, taskId: bug, severity: "urgent", assigneeId: t.member }), { success: true });
  const r = await row(bug);
  assert.deepEqual([r.stage, r.priority, r.assignee_id, (r.type_fields as { severity: string }).severity], ["confirmed", "urgent", t.member, "urgent"]);
  assert.deepEqual((await notes(t.owner)).slice(-1), ["Urgent bug confirmed: Crash on export (important)"]);
  assert.equal((await bugs.confirmBugAction({ projectId: t.ws, taskId: bug, severity: "minor" })).success, false, "only New bugs are confirmed");
  // W8: Fixed tells the reporter (the viewer) and whoever sees it too, not the person who moved it.
  viewerId = t.owner;
  await bugs.seeTooAction({ projectId: t.ws, taskId: bug, on: true });
  viewerId = t.member;
  const { setTaskStageAction } = await loadAppModule(() => import("../../src/app/actions/task"));
  await setTaskStageAction({ taskId: bug, projectId: t.ws, stage: "fixing", toBacklog: true });
  await setTaskStageAction({ taskId: bug, projectId: t.ws, stage: "fixed", toBacklog: true });
  assert.deepEqual((await notes(t.viewer)).slice(-1), ["Fixed: Crash on export (important)"]);
  assert.deepEqual((await notes(t.owner)).slice(-1), ["Fixed: Crash on export (important)"]);
  assert.equal((await notes(t.member)).filter((x) => x.startsWith("Fixed")).length, 0);
  // Someone who left hears nothing more.
  const other = await report(t.ws, "Second crash");
  await sql`DELETE FROM workspace_members WHERE workspace_id = ${t.ws} AND user_id = ${t.viewer}`;
  await sql`UPDATE tasks SET creator_id = ${t.viewer} WHERE id = ${other}`;
  await setTaskStageAction({ taskId: other, projectId: t.ws, stage: "fixing", toBacklog: true });
  await setTaskStageAction({ taskId: other, projectId: t.ws, stage: "fixed", toBacklog: true });
  assert.equal((await notes(t.viewer)).filter((x) => x === "Fixed: Second crash (important)").length, 0);
});

test("S5: the panel's fields save; a severity change writes priority; viewers read but can't change; outsiders can't read", async () => {
  const t = await workspace();
  viewerId = t.owner;
  const bug = await report(t.ws, "Logo blurry", { severity: "urgent" });
  assert.deepEqual(await bugs.setBugFieldsAction({ projectId: t.ws, taskId: bug, fields: { severity: "minor", fixedIn: "v2.4" } }), { success: true });
  const r = await row(bug);
  assert.deepEqual([r.priority, (r.type_fields as { fixedIn: string }).fixedIn], ["medium", "v2.4"]);
  viewerId = t.viewer;
  const read = await bugs.readBugAction(t.ws, bug);
  assert.ok(read.success && !read.canEdit);
  assert.equal((await bugs.setBugFieldsAction({ projectId: t.ws, taskId: bug, fields: { fixedIn: "v9" } })).success, false);
  const list = await bugs.readBugsAction(t.ws);
  assert.ok(list.success && list.bugs.length === 1 && !list.canTriage);
  viewerId = t.outsider;
  assert.equal((await bugs.readBugsAction(t.ws)).success, false);
  assert.equal((await bugs.similarBugsAction({ projectId: t.ws, title: "logo blurry" })).success, false);
});

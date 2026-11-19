import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// Workflow tabs A0.1 (report 38.2 F1): a typed item's stage sets its status and whether it's on the board; the board
// read leaves off-board items out; joining takes a sprint, leaving records "moved back"; Blocked keeps the stage;
// a done stage waits for approval where review is on; plain tasks behave exactly as before.

let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.171" }), cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) });
stubNextAfter();

let actions: typeof import("../../src/app/actions/task");
let server: typeof import("../../src/lib/workspaces/server/tasks");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
  });
  actions = await loadAppModule(() => import("../../src/app/actions/task"));
  server = await loadAppModule(() => import("../../src/lib/workspaces/server/tasks"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

async function workspace(opts: { review?: boolean; workflows?: boolean } = {}) {
  const [owner, member] = await Promise.all([1, 2].map(() => sql.begin((tx) => createUser(tx))));
  const ws = await sql.begin((tx) => createProject(tx, owner!));
  created.push(ws);
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${ws}, ${owner!}, 'owner'), (${ws}, ${member!}, 'member')`;
  await sql`UPDATE workspaces SET workflows_enabled = ${opts.workflows ?? true}, task_review_required = ${opts.review ?? false} WHERE id = ${ws}`;
  const [sprint] = await sql`INSERT INTO workspace_sprints (workspace_id, sprint_number, name, status, start_date, end_date)
    VALUES (${ws}, 1, 'Week 47', 'active', now(), now() + interval '7 days') RETURNING id`;
  return { owner: owner!, member: member!, ws, sprint: sprint!.id as string };
}

async function bug(ws: string, creator: string, stage = "new") {
  const [row] = await sql`INSERT INTO tasks (workspace_id, creator_id, title, status, item_type, stage, on_board, workflow_column_id)
    VALUES (${ws}, ${creator}, 'Login button does nothing', 'todo', 'bug', ${stage}, false, null) RETURNING id`;
  return row!.id as string;
}
const row = async (id: string) => (await sql`SELECT status, stage, on_board, workflow_column_id, sprint_id, review_status FROM tasks WHERE id = ${id}`)[0]!;
const boardIds = async (ws: string) => {
  const res = await server.fetchWorkspaceTasksAction(ws, 100);
  assert.ok(res && "success" in res ? res.success : true, JSON.stringify(res));
  return ((res as { tasks?: Array<{ id: string }> }).tasks ?? []).map((t) => t.id);
};

test("a plain task is untouched: status moves as before, no stage", async () => {
  const t = await workspace();
  viewerId = t.owner;
  const [task] = await sql`INSERT INTO tasks (workspace_id, creator_id, title, status) VALUES (${t.ws}, ${t.owner}, 'Plain', 'todo') RETURNING id, item_type, stage, on_board`;
  assert.deepEqual([task!.item_type, task!.stage, task!.on_board], ["task", null, true]);
  const moved = await actions.updateTaskStatusAction(task!.id, "in_progress", t.ws);
  assert.equal(moved.success, true, JSON.stringify(moved));
  assert.deepEqual([(await row(task!.id)).status, (await row(task!.id)).stage], ["in_progress", null]);
  const refused = await actions.setTaskStageAction({ taskId: task!.id, projectId: t.ws, stage: "fixing" });
  assert.equal(refused.success, false);
});

test("New → Confirmed stays off the board; Confirmed → Fixing joins the chosen sprint; Fixing → Confirmed leaves it, moved back", async () => {
  const t = await workspace();
  viewerId = t.owner;
  const id = await bug(t.ws, t.owner);
  assert.ok(!(await boardIds(t.ws)).includes(id), "a New bug isn't on the board");

  assert.equal((await actions.setTaskStageAction({ taskId: id, projectId: t.ws, stage: "confirmed" })).success, true);
  assert.deepEqual(await row(id), { status: "todo", stage: "confirmed", on_board: false, workflow_column_id: null, sprint_id: null, review_status: "none" });

  const joined = await actions.setTaskStageAction({ taskId: id, projectId: t.ws, stage: "fixing", sprintId: t.sprint });
  assert.equal(joined.success, true, JSON.stringify(joined));
  const fixing = await row(id);
  assert.deepEqual([fixing.status, fixing.stage, fixing.on_board, fixing.sprint_id], ["in_progress", "fixing", true, t.sprint]);
  assert.ok(fixing.workflow_column_id, "it sits in the default In progress column");
  assert.ok((await boardIds(t.ws)).includes(id), "now on the board");
  const [added] = await sql`SELECT payload FROM task_activity_events WHERE task_id = ${id} AND event_type = 'added_to_sprint'`;
  assert.equal(added!.payload.reason, "joined_from_workflow");

  assert.equal((await actions.setTaskStageAction({ taskId: id, projectId: t.ws, stage: "confirmed" })).success, true);
  assert.deepEqual(await row(id), { status: "todo", stage: "confirmed", on_board: false, workflow_column_id: null, sprint_id: null, review_status: "none" });
  const [back] = await sql`SELECT sprint_id, payload FROM task_activity_events WHERE task_id = ${id} AND event_type = 'removed_from_sprint'`;
  assert.deepEqual([back!.sprint_id, back!.payload.reason, back!.payload.toStage], [t.sprint, "moved_back", "confirmed"]);
  const [membership] = await sql`SELECT removed_at FROM sprint_task_memberships WHERE task_id = ${id}`;
  assert.ok(membership!.removed_at, "the sprint keeps it in its history");
});

test("a member's item joins the Backlog, never a sprint (decision 146)", async () => {
  const t = await workspace();
  viewerId = t.member;
  const id = await bug(t.ws, t.member, "confirmed");
  assert.equal((await actions.setTaskStageAction({ taskId: id, projectId: t.ws, stage: "fixing", sprintId: t.sprint })).success, true);
  assert.equal((await row(id)).sprint_id, null);
});

test("on the board: Blocked keeps the stage; Completed takes Fixed; back out of Completed returns to Fixing", async () => {
  const t = await workspace();
  viewerId = t.owner;
  const id = await bug(t.ws, t.owner, "confirmed");
  await actions.setTaskStageAction({ taskId: id, projectId: t.ws, stage: "fixing" });
  assert.equal((await actions.updateTaskStatusAction(id, "blocked", t.ws)).success, true);
  assert.deepEqual([(await row(id)).status, (await row(id)).stage], ["blocked", "fixing"]);
  assert.equal((await actions.updateTaskStatusAction(id, "done", t.ws)).success, true);
  assert.deepEqual([(await row(id)).status, (await row(id)).stage], ["done", "fixed"]);
  assert.equal((await actions.updateTaskStatusAction(id, "in_progress", t.ws)).success, true);
  assert.deepEqual([(await row(id)).status, (await row(id)).stage], ["in_progress", "fixing"]);
});

test("with review on, Completed waits: the stage stays Fixing until approval, then Fixed (B3)", async () => {
  const t = await workspace({ review: true });
  viewerId = t.owner;
  const id = await bug(t.ws, t.owner, "confirmed");
  await actions.setTaskStageAction({ taskId: id, projectId: t.ws, stage: "fixing" });
  assert.equal((await actions.updateTaskStatusAction(id, "done", t.ws)).success, true);
  assert.deepEqual([(await row(id)).status, (await row(id)).stage, (await row(id)).review_status], ["done", "fixing", "pending"]);
  const approved = await actions.approveTaskReviewAction(id, t.ws);
  assert.equal(approved.success, true, JSON.stringify(approved));
  assert.deepEqual([(await row(id)).stage, (await row(id)).review_status], ["fixed", "none"]);
});

test("closing stages finish off the board without review; unknown stages and workspaces without workflows are refused", async () => {
  const t = await workspace({ review: true });
  viewerId = t.owner;
  const id = await bug(t.ws, t.owner);
  assert.equal((await actions.setTaskStageAction({ taskId: id, projectId: t.ws, stage: "wont_fix" })).success, true);
  assert.deepEqual(await row(id), { status: "done", stage: "wont_fix", on_board: false, workflow_column_id: null, sprint_id: null, review_status: "none" });
  const unknown = await actions.setTaskStageAction({ taskId: id, projectId: t.ws, stage: "shipped" });
  assert.match(unknown.success ? "" : unknown.error, /Unknown stage/);

  const off = await workspace({ workflows: false });
  viewerId = off.owner;
  const other = await bug(off.ws, off.owner);
  assert.equal((await actions.setTaskStageAction({ taskId: other, projectId: off.ws, stage: "confirmed" })).success, false);
});

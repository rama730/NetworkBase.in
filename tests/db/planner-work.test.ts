import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// Workflow tabs A1.3 (report 38.5 T1 W3, W5, part 5): projects group work. Part of only into a project in the same
// workspace, projects don't nest; completion counts work; completing can send open work to the Backlog.

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

let tasksServer: typeof import("../../src/lib/workspaces/server/tasks");
let taskActions: typeof import("../../src/app/actions/task");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerIdentityContext: async () => ({ user: viewerId ? { id: viewerId } : null, userId: viewerId || null, profile: null }),
  });
  tasksServer = await loadAppModule(() => import("../../src/lib/workspaces/server/tasks"));
  taskActions = await loadAppModule(() => import("../../src/app/actions/task"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

async function workspace() {
  const [owner, member] = await Promise.all([1, 2].map(() => sql.begin((tx) => createUser(tx))));
  const ws = await sql.begin((tx) => createProject(tx, owner!));
  created.push(ws);
  await sql`UPDATE workspaces SET workflows_enabled = true WHERE id = ${ws}`;
  await sql`INSERT INTO workspace_workflows (workspace_id, workflow, added_by) VALUES (${ws}, 'project_planner', ${owner!})`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${ws}, ${owner!}, 'owner'), (${ws}, ${member!}, 'member')`;
  const [sprint] = await sql`INSERT INTO workspace_sprints (workspace_id, creator_id, name, start_date, end_date, status) VALUES (${ws}, ${owner!}, 'Sprint 1', now() - interval '1 day', now() + interval '7 days', 'active') RETURNING id`;
  return { owner: owner!, member: member!, ws, sprint: sprint!.id as string };
}
const make = async (ws: string, title: string, extra: Record<string, unknown> = {}) => {
  const r = await tasksServer.createTaskAction({ projectId: ws, title, status: "todo", priority: "medium", ...extra } as never);
  assert.ok(r.success && "task" in r && r.task, JSON.stringify(r));
  return (r as { task: { id: string } }).task.id;
};

test("W3: a project (never on the board) holds work through Part of; start never after due; no nesting", async () => {
  const t = await workspace();
  viewerId = t.owner;
  const project = await make(t.ws, "Website relaunch", { itemType: "project", startDate: "2026-12-02T00:00:00Z", dueDate: "2026-12-20T00:00:00Z" });
  const [p] = await sql`SELECT item_type, stage, on_board, status, start_date FROM tasks WHERE id = ${project}`;
  assert.deepEqual([p!.item_type, p!.stage, p!.on_board, p!.status, p!.start_date?.toISOString()], ["project", "not_started", false, "todo", "2026-12-02T00:00:00.000Z"]);
  const work = await make(t.ws, "Write copy", { partOfId: project });
  assert.equal((await sql`SELECT part_of_id FROM tasks WHERE id = ${work}`)[0]!.part_of_id, project);
  const bad = await tasksServer.createTaskAction({ projectId: t.ws, title: "Inner", status: "todo", priority: "medium", itemType: "project", partOfId: project } as never);
  assert.deepEqual([bad.success, (bad as { error?: string }).error], [false, "A project can’t be Part of another project"]);
  const notProject = await tasksServer.createTaskAction({ projectId: t.ws, title: "x", status: "todo", priority: "medium", partOfId: work } as never);
  assert.equal((notProject as { error?: string }).error, "Part of must be a project in this workspace");
  const backwards = await tasksServer.createTaskAction({ projectId: t.ws, title: "y", status: "todo", priority: "medium", startDate: "2026-12-10T00:00:00Z", dueDate: "2026-12-01T00:00:00Z" } as never);
  assert.equal((backwards as { error?: string }).error, "The start date is after the due date");
});

test("setPartOf, Group into a project, completion and completing with work sent to the Backlog", async () => {
  const t = await workspace();
  viewerId = t.owner;
  const a = await make(t.ws, "A", { sprintId: t.sprint });
  const b = await make(t.ws, "B", { sprintId: t.sprint });
  const c = await make(t.ws, "C");
  const grouped = await taskActions.groupIntoProjectAction({ projectId: t.ws, taskIds: [a, b], name: "Launch" });
  assert.ok(grouped.success, JSON.stringify(grouped));
  const projectId = (grouped as { id: string }).id;
  assert.deepEqual((await taskActions.setPartOfAction({ projectId: t.ws, taskIds: [c], partOfId: projectId })).success, true);
  assert.equal((await taskActions.setPartOfAction({ projectId: t.ws, taskIds: [projectId], partOfId: projectId })).success, false, "a project is never Part of");
  await sql`UPDATE tasks SET status = 'done' WHERE id = ${a}`;
  const read = await taskActions.readProjectWorkAction(t.ws, projectId);
  assert.ok(read.success);
  assert.deepEqual([read.work.length, read.completion], [3, { percent: 33, source: "work" }]);
  const done = await taskActions.completeProjectAction({ projectId: t.ws, projectTaskId: projectId, openTasks: "backlog" });
  assert.equal(done.success, true, JSON.stringify(done));
  const rows = await sql`SELECT title, sprint_id FROM tasks WHERE part_of_id = ${projectId} ORDER BY title`;
  assert.deepEqual(rows.map((r) => [r.title, r.sprint_id]), [["A", t.sprint], ["B", null], ["C", null]], "done work keeps its sprint; open work leaves it");
  assert.equal((await sql`SELECT stage, status FROM tasks WHERE id = ${projectId}`)[0]!.stage, "completed");
});

test("a member can't make a project without the Project planner; Part of refuses another workspace's project", async () => {
  const t = await workspace();
  const other = await workspace();
  viewerId = other.owner;
  const foreign = await make(other.ws, "Theirs", { itemType: "project" });
  viewerId = t.owner;
  assert.equal((await taskActions.setPartOfAction({ projectId: t.ws, taskIds: [await make(t.ws, "Mine")], partOfId: foreign })).success, false);
  // Reading another workspace's project through your own workspace finds nothing (no counts, no override).
  assert.deepEqual(await taskActions.readProjectWorkAction(t.ws, foreign), { success: false, error: "Not found" });
  // Assignment work never joins a project; organizations keep the board only (call 11).
  const own = await make(t.ws, "Ours", { itemType: "project" });
  const work = await make(t.ws, "Hand-in");
  await sql`UPDATE tasks SET kind = 'assignment' WHERE id = ${work}`;
  assert.equal((await taskActions.setPartOfAction({ projectId: t.ws, taskIds: [work], partOfId: own })).error, "Assignments can’t be Part of a project");
  await sql`UPDATE workspaces SET kind = 'organization' WHERE id = ${t.ws}`;
  assert.equal((await taskActions.setPartOfAction({ projectId: t.ws, taskIds: [await make(t.ws, "Plain")], partOfId: own })).error, "Projects aren’t available in organizations");
  assert.deepEqual(await taskActions.readProjectWorkAction(t.ws, own), { success: false, error: "Not found" });
  assert.equal((await taskActions.readProjectsAction(t.ws)).success, false);
  await sql`UPDATE workspaces SET kind = 'workspace' WHERE id = ${t.ws}`;
  await sql`UPDATE workspace_workflows SET hidden_at = now() WHERE workspace_id = ${t.ws}`;
  const hidden = await tasksServer.createTaskAction({ projectId: t.ws, title: "P", status: "todo", priority: "medium", itemType: "project" } as never);
  assert.equal((hidden as { error?: string }).error, "Project planner was removed from this workspace");
});

test("W1: the Projects list with stage, dates and completion from their work", async () => {
  const t = await workspace();
  viewerId = t.owner;
  const p = await make(t.ws, "Relaunch", { itemType: "project", startDate: "2026-12-02T00:00:00Z", dueDate: "2026-12-20T00:00:00Z" });
  const a = await make(t.ws, "A", { partOfId: p });
  await make(t.ws, "B", { partOfId: p });
  await sql`UPDATE tasks SET status = 'done' WHERE id = ${a}`;
  const list = await taskActions.readProjectsAction(t.ws);
  assert.ok(list.success);
  assert.deepEqual(list.projects.map((x) => [x.title, x.stage, x.startDate, x.completion.percent]), [["Relaunch", "not_started", "2026-12-02T00:00:00.000Z", 50]]);
});

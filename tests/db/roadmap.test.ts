import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// Workflow tabs A2.10 (report 38.9 T2): roadmap items, columns, work, the automatic In progress, Won't do.
let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.176" }), cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) });
stubNextAfter();

let tasksServer: typeof import("../../src/lib/workspaces/server/tasks");
let roadmap: typeof import("../../src/app/actions/roadmap");
let taskActions: typeof import("../../src/app/actions/task");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerIdentityContext: async () => ({ user: viewerId ? { id: viewerId } : null, userId: viewerId || null, profile: null }),
  });
  tasksServer = await loadAppModule(() => import("../../src/lib/workspaces/server/tasks"));
  roadmap = await loadAppModule(() => import("../../src/app/actions/roadmap"));
  taskActions = await loadAppModule(() => import("../../src/app/actions/task"));
});
const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

async function workspace() {
  const [owner, member, viewer] = await Promise.all([1, 2, 3].map(() => sql.begin((tx) => createUser(tx))));
  const ws = await sql.begin((tx) => createProject(tx, owner!));
  created.push(ws);
  await sql`UPDATE workspaces SET workflows_enabled = true WHERE id = ${ws}`;
  await sql`INSERT INTO workspace_workflows (workspace_id, workflow, added_by) VALUES (${ws}, 'roadmap', ${owner!}), (${ws}, 'project_planner', ${owner!}), (${ws}, 'requests', ${owner!})`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${ws}, ${owner!}, 'owner'), (${ws}, ${member!}, 'member'), (${ws}, ${viewer!}, 'viewer')`;
  return { owner: owner!, member: member!, viewer: viewer!, ws };
}
const row = async (id: string) => (await sql`SELECT stage, status, on_board, type_fields FROM tasks WHERE id = ${id}`)[0]!;
const make = async (ws: string, input: Record<string, unknown>) => {
  const r = await tasksServer.createTaskAction({ projectId: ws, status: "todo", priority: "medium", ...input } as never);
  assert.ok(r.success, JSON.stringify(r));
  return (r as { task: { id: string } }).task.id;
};

test("W1–W5: an item lands in Backlog off the board; a column makes it Planned; work starting moves it to In progress; progress counts work and Built by", async () => {
  const t = await workspace();
  viewerId = t.member;
  const item = await make(t.ws, { title: "SSO sign-in", itemType: "roadmap_item", stage: "backlog", typeFields: { outcome: "People sign in with their company account", column: "next", itemType: "feature" } });
  assert.deepEqual(Object.values(await row(item)).slice(0, 3), ["backlog", "todo", false]);
  assert.equal((await tasksServer.createTaskAction({ projectId: t.ws, title: "Bad", status: "todo", priority: "medium", itemType: "roadmap_item", stage: "backlog", typeFields: { column: "soon" } } as never)).success, false);
  const moved = await roadmap.moveRoadmapColumnAction({ projectId: t.ws, taskId: item, column: "now" });
  assert.ok(moved.success && moved.stage === "planned", JSON.stringify(moved));
  assert.equal(((await row(item)).type_fields as { column: string }).column, "now");
  // Work: two tasks Part of the item; a project as Built by.
  const a = await make(t.ws, { title: "SAML config", partOfId: item, assigneeId: t.member });
  const b = await make(t.ws, { title: "Login button", partOfId: item });
  const project = await make(t.ws, { title: "Auth rework", itemType: "project", stage: "in_progress" });
  await make(t.ws, { title: "Token store", partOfId: project, status: "done" });
  await make(t.ws, { title: "Session table", partOfId: project });
  assert.equal((await roadmap.setRoadmapFieldsAction({ projectId: t.ws, taskId: item, fields: { builtBy: [a] } }) as { error?: string }).error, "Built by takes projects from this workspace");
  assert.ok((await roadmap.setRoadmapFieldsAction({ projectId: t.ws, taskId: item, fields: { builtBy: [project] } })).success);
  // A roadmap item can't be Part of something else.
  assert.equal((await taskActions.setPartOfAction({ projectId: t.ws, taskIds: [item], partOfId: project })).success, false);
  // W5: the first work task starting moves the item to In progress.
  const started = await taskActions.updateTaskStatusAction(a, "in_progress", t.ws);
  assert.ok(started.success, JSON.stringify(started));
  assert.equal((await row(item)).stage, "in_progress");
  await sql`UPDATE tasks SET status = 'done' WHERE id = ${b}`;
  const read = await roadmap.readRoadmapAction(t.ws);
  assert.ok(read.success);
  const r = read.items.find((i) => i.id === item)!;
  assert.deepEqual([r.progress, r.workCount, r.openWork], [50, 2, 1], "1 of 2 tasks + a 2-task project at 50 %");
  // Testing by hand; work starting again doesn't move it.
  assert.ok((await taskActions.setTaskStageAction({ projectId: t.ws, taskId: item, stage: "testing" })).success);
  await sql`UPDATE tasks SET status = 'todo' WHERE id = ${a}`;
  assert.ok((await taskActions.updateTaskStatusAction(a, "in_progress", t.ws)).success);
  assert.equal((await row(item)).stage, "testing");
});

test("W7 and people: Won't do needs a reason and keeps open work; viewers read but can't change the roadmap", async () => {
  const t = await workspace();
  viewerId = t.owner;
  const item = await make(t.ws, { title: "Dark mode", itemType: "roadmap_item", stage: "planned", typeFields: { column: "later", itemType: "improvement" } });
  await make(t.ws, { title: "Theme tokens", partOfId: item });
  viewerId = t.viewer;
  assert.equal((await roadmap.readRoadmapAction(t.ws)).success, true);
  assert.equal((await roadmap.moveRoadmapColumnAction({ projectId: t.ws, taskId: item, column: "now" }) as { error?: string }).error, "Viewers can’t change the roadmap");
  viewerId = t.member;
  assert.equal((await roadmap.wontDoAction({ projectId: t.ws, taskId: item, reason: " " }) as { error?: string }).error, "Say why it won’t be done");
  const closed = await roadmap.wontDoAction({ projectId: t.ws, taskId: item, reason: "Not this year" });
  assert.ok(closed.success && closed.openWork === 1, JSON.stringify(closed));
  const r = await row(item);
  assert.deepEqual([r.stage, r.status, (r.type_fields as { wontDoReason: string; column: string }).wontDoReason, (r.type_fields as { column: string }).column], ["wont_do", "done", "Not this year", "later"], "the column is kept for a reopen");
});

test("part 8: My work lists a roadmap item assigned to you only while it's in Now", async () => {
  const t = await workspace();
  viewerId = t.member;
  const later = await make(t.ws, { title: "Offline mode", itemType: "roadmap_item", stage: "planned", assigneeId: t.member, typeFields: { column: "later" } });
  const myTasks = await loadAppModule(() => import("../../src/lib/domain/my-tasks"));
  const counts = async () => (await myTasks.countMyOpenTasks(t.member)).open;
  const before = await counts();
  assert.ok((await roadmap.moveRoadmapColumnAction({ projectId: t.ws, taskId: later, column: "now" })).success);
  assert.equal(await counts(), before + 1);
});

test("part 8: Launched tells the assignee and the askers of its requests (Shipped, Summary); Won't do tells the assignee", async () => {
  const t = await workspace();
  viewerId = t.owner;
  const item = await make(t.ws, { title: "CSV export", itemType: "roadmap_item", stage: "testing", assigneeId: t.member, typeFields: { column: "now" } });
  viewerId = t.viewer;
  const requests = await loadAppModule(() => import("../../src/app/actions/requests"));
  const types = await requests.readRequestsAction(t.ws);
  assert.ok(types.success);
  const type = types.types[0]!;
  const answers = Object.fromEntries(type.questions.filter((q: { required?: boolean }) => q.required).map((q: { id: string }) => [q.id, "CSV of everything"]));
  const asked = await tasksServer.createTaskAction({ projectId: t.ws, title: "Export my data", status: "todo", priority: "medium", itemType: "request", stage: "new", typeFields: { requestTypeId: type.id, answers } } as never);
  assert.ok(asked.success, JSON.stringify(asked));
  const reqId = (asked as { task: { id: string } }).task.id;
  viewerId = t.owner;
  assert.ok((await taskActions.setPartOfAction({ projectId: t.ws, taskIds: [reqId], partOfId: item })).success, "a request can be Part of a roadmap item");
  assert.ok((await taskActions.setTaskStageAction({ projectId: t.ws, taskId: item, stage: "launched" })).success);
  const notes = async (u: string) => (await sql`SELECT title, importance FROM user_notifications WHERE user_id = ${u}`).map((r) => `${r.title}|${r.importance}`);
  assert.ok((await notes(t.member)).includes("Launched: CSV export|important"));
  assert.ok((await notes(t.viewer)).includes("Shipped: CSV export|more"), JSON.stringify(await notes(t.viewer)));
  const other = await make(t.ws, { title: "Plugins", itemType: "roadmap_item", stage: "planned", assigneeId: t.member, typeFields: { column: "later" } });
  assert.ok((await roadmap.wontDoAction({ projectId: t.ws, taskId: other, reason: "Too big" })).success);
  assert.ok((await notes(t.member)).includes("Won’t do: Plugins|important"));
});

test("W9 (A2.11): the Backlog keeps a hand order; work start and requests come with the read", async () => {
  const t = await workspace();
  viewerId = t.member;
  const a = await make(t.ws, { title: "A", itemType: "roadmap_item", stage: "backlog", typeFields: {} });
  const b = await make(t.ws, { title: "B", itemType: "roadmap_item", stage: "backlog", typeFields: {} });
  const c = await make(t.ws, { title: "C", itemType: "roadmap_item", stage: "backlog", typeFields: {} });
  const { backlogOrder } = await loadAppModule(() => import("../../src/lib/workflows/roadmap"));
  const order = async () => { const r = await roadmap.readRoadmapAction(t.ws); assert.ok(r.success); return backlogOrder(r.items.filter((i) => i.stage === "backlog")).map((i) => i.title); };
  assert.deepEqual(await order(), ["C", "B", "A"], "newest first until placed");
  assert.ok((await roadmap.moveBacklogAction({ projectId: t.ws, taskId: a, beforeId: c })).success);
  assert.deepEqual(await order(), ["A", "C", "B"]);
  assert.ok((await roadmap.moveBacklogAction({ projectId: t.ws, taskId: c, beforeId: null })).success);
  assert.deepEqual(await order(), ["A", "B", "C"]);
  assert.ok((await roadmap.moveBacklogAction({ projectId: t.ws, taskId: c, beforeId: b })).success);
  assert.deepEqual(await order(), ["A", "C", "B"]);
  await sql`UPDATE tasks SET stage = 'planned' WHERE id = ${b}`;
  assert.equal((await roadmap.moveBacklogAction({ projectId: t.ws, taskId: b, beforeId: null }) as { error?: string }).error, "Only Backlog items are ordered here");
  await make(t.ws, { title: "Work", partOfId: a, startDate: "2026-11-30" });
  await make(t.ws, { title: "Earlier work", partOfId: a, startDate: "2026-11-20" });
  const r = await roadmap.readRoadmapAction(t.ws);
  assert.ok(r.success);
  assert.equal(r.items.find((i) => i.id === a)!.workStart, "2026-11-20");
});

test("W7 (A2.11): a bare stage move to Won't do is refused; Won't do… records the reason first", async () => {
  const t = await workspace();
  viewerId = t.owner;
  const item = await make(t.ws, { title: "Plugins", itemType: "roadmap_item", stage: "planned", typeFields: { column: "later" } });
  assert.equal((await taskActions.setTaskStageAction({ projectId: t.ws, taskId: item, stage: "wont_do" }) as { error?: string }).error, "Close a roadmap item with Won’t do…, so it says why");
  assert.ok((await roadmap.wontDoAction({ projectId: t.ws, taskId: item, reason: "Too big" })).success);
});

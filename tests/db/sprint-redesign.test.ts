import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// Sprint redesign (docs/superpowers/plans/2026-11-04-sprint-redesign.md, phase 2): who carries what, what earlier
// sprints finished, the backlog to plan from, and Add work.

let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.177" }) });
stubNextAfter();
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

let sprints: typeof import("../../src/lib/workspaces/server/sprints");
let taskActions: typeof import("../../src/app/actions/task");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
  });
  sprints = await loadAppModule(() => import("../../src/lib/workspaces/server/sprints"));
  taskActions = await loadAppModule(() => import("../../src/app/actions/task"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

async function workspace() {
  const [owner, member] = await Promise.all([1, 2].map(() => sql.begin((tx) => createUser(tx))));
  const id = await sql.begin((tx) => createProject(tx, owner!));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${id}, ${owner!}, 'owner'), (${id}, ${member!}, 'member')`;
  await sql`UPDATE profiles SET full_name = 'Ravi Kumar' WHERE id = ${owner!}`;
  await sql`UPDATE profiles SET full_name = 'Asha Nair' WHERE id = ${member!}`;
  created.push(id);
  return { id, owner: owner!, member: member! };
}

async function task(w: { id: string; owner: string }, title: string, extra: { sprint?: string; status?: string; points?: number; assignee?: string } = {}) {
  const [row] = await sql`INSERT INTO tasks (workspace_id, title, creator_id, sprint_id, status, story_points, assignee_id)
    VALUES (${w.id}, ${title}, ${w.owner}, ${extra.sprint ?? null}, ${extra.status ?? "todo"}, ${extra.points ?? null}, ${extra.assignee ?? null}) RETURNING id`;
  if (extra.sprint) await sql`INSERT INTO sprint_task_memberships (workspace_id, sprint_id, task_id, added_by) VALUES (${w.id}, ${extra.sprint}, ${row!.id}, ${w.owner})`;
  return row!.id as string;
}

async function sprint(w: { id: string; owner: string }, name: string, start: number, end: number) {
  viewerId = w.owner;
  const made = await sprints.createSprintAction({ projectId: w.id, name, startDate: day(start), endDate: day(end), autoStart: false });
  assert.ok(made.success, JSON.stringify(made));
  return made.success ? made.sprint.id : "";
}

test("the sprint shows each person's open points, the unassigned work, and what the last closed sprints finished", async () => {
  const w = await workspace();
  const old = await sprint(w, "Sprint 1", -20, -10);
  await task(w, "Old A", { sprint: old, status: "done", points: 5 });
  await task(w, "Old B", { sprint: old, status: "done", points: 8 });
  await task(w, "Old open", { sprint: old, status: "todo", points: 20 });
  await sql`UPDATE workspace_sprints SET status = 'completed', completed_at = now() - interval '9 days' WHERE id = ${old}`;
  const older = await sprint(w, "Sprint 0", -40, -30);
  await task(w, "Older", { sprint: older, status: "done", points: 7 });
  await sql`UPDATE workspace_sprints SET status = 'completed', completed_at = now() - interval '29 days' WHERE id = ${older}`;
  const now = await sprint(w, "Sprint 2", -2, 8);
  await sprints.startSprintNowAction(now, w.id);
  await task(w, "Search API", { sprint: now, status: "in_progress", points: 5, assignee: w.owner });
  await task(w, "Search box", { sprint: now, status: "todo", points: 3, assignee: w.member });
  await task(w, "Index job", { sprint: now, status: "todo", points: 2 });
  await task(w, "Shipped", { sprint: now, status: "done", points: 1, assignee: w.owner });
  viewerId = w.owner;
  const detail = await sprints.fetchWorkspaceSprintDetailAction({ projectId: w.id, sprintId: now });
  assert.ok(detail.success, JSON.stringify(detail));
  const d = detail.success ? detail.data : null!;
  assert.deepEqual(d.people?.map((p) => [p.name, p.openPoints, p.openTasks]), [["Ravi Kumar", 5, 1], ["Asha Nair", 3, 1]]);
  assert.deepEqual(d.unassigned, { tasks: 1, points: 2 });
  assert.deepEqual(d.velocity, { last: 13, average: 10 }, "Sprint 1 finished 13, Sprint 0 finished 7; unfinished work doesn't count");
  viewerId = "";
});

test("the backlog lists open work with no sprint, searches by title, and leaves out done work", async () => {
  const w = await workspace();
  const s = await sprint(w, "Sprint 1", 1, 10);
  await task(w, "Refund flow", { points: 5 });
  await task(w, "Invoice PDF", { points: 3, assignee: w.member });
  await task(w, "Already done", { status: "done" });
  await task(w, "In a sprint", { sprint: s });
  viewerId = w.owner;
  const all = await sprints.readSprintBacklogAction({ projectId: w.id, query: "" });
  assert.ok(all.success);
  assert.deepEqual(all.success && all.rows.map((r) => r.title).sort(), ["Invoice PDF", "Refund flow"]);
  const found = await sprints.readSprintBacklogAction({ projectId: w.id, query: "invoice" });
  assert.deepEqual(found.success && found.rows.map((r) => [r.title, r.storyPoints, r.assignee]), [["Invoice PDF", 3, "Asha Nair"]]);
  viewerId = "";
  assert.equal((await sprints.readSprintBacklogAction({ projectId: w.id, query: "" })).success, false, "signed out");
});

test("Add work moves backlog tasks into an upcoming sprint; members and closed sprints are refused per task", async () => {
  const w = await workspace();
  const s = await sprint(w, "Sprint 1", 1, 10);
  const a = await task(w, "Refund flow", { points: 5 });
  const b = await task(w, "Invoice PDF", { points: 3 });
  viewerId = w.member;
  const refused = await taskActions.addTasksToSprintAction({ projectId: w.id, sprintId: s, taskIds: [a] });
  assert.deepEqual([refused.added, refused.failed.length], [0, 1]);
  viewerId = w.owner;
  const added = await taskActions.addTasksToSprintAction({ projectId: w.id, sprintId: s, taskIds: [a, b] });
  assert.deepEqual([added.added, added.failed], [2, []]);
  const rows = await sql`SELECT t.sprint_id, m.sprint_id AS member_of FROM tasks t JOIN sprint_task_memberships m ON m.task_id = t.id AND m.removed_at IS NULL WHERE t.id IN (${a}, ${b})`;
  assert.deepEqual(rows.map((r) => [r.sprint_id, r.member_of]), [[s, s], [s, s]]);
  await sql`UPDATE workspace_sprints SET status = 'completed', completed_at = now() WHERE id = ${s}`;
  const c = await task(w, "Tax", {});
  const late = await taskActions.addTasksToSprintAction({ projectId: w.id, sprintId: s, taskIds: [c] });
  assert.equal(late.added, 0);
  assert.match(late.failed[0]!.error, /Planning or Active/);
  assert.equal((await taskActions.addTasksToSprintAction({ projectId: w.id, sprintId: s, taskIds: Array.from({ length: 31 }, () => c) })).added, 0, "at most 30 at a time");
  viewerId = "";
});

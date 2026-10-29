import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { addMember, closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: viewerId } }, error: null }) } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });

let workflow: typeof import("../../src/app/actions/project/workflow");
let subtasks: typeof import("../../src/app/actions/subtask");
let taskActions: typeof import("../../src/app/actions/task");
before(async () => {
  taskActions = await loadAppModule(() => import("../../src/app/actions/task"));
  workflow = await loadAppModule(() => import("../../src/app/actions/project/workflow"));
  subtasks = await loadAppModule(() => import("../../src/app/actions/subtask"));
});
after(async () => { await sql.end(); await closeAppDb(); });

async function withProject(fn: (ids: { owner: string; projectId: string }) => Promise<void>) {
  const owner = await sql.begin((tx) => createUser(tx));
  const projectId = await sql.begin((tx) => createProject(tx, owner));
  viewerId = owner;
  try {
    await fn({ owner, projectId });
  } finally {
    await sql`DELETE FROM task_activity_events WHERE project_id = ${projectId}`;
    await sql`DELETE FROM tasks WHERE project_id = ${projectId}`;
    await sql`DELETE FROM project_workflow_columns WHERE project_id = ${projectId}`;
    await sql`DELETE FROM project_members WHERE project_id = ${projectId}`;
    await sql`DELETE FROM projects WHERE id = ${projectId}`;
  }
}

// COR-024: the six-section limit holds under concurrent adds.
test("concurrent section adds never exceed six sections", async () => {
  await withProject(async ({ projectId }) => {
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) => workflow.createProjectWorkflowColumnAction({ projectId, title: `Extra ${i}` })),
    );
    const [{ count }] = await sql`SELECT count(*)::int AS count FROM project_workflow_columns WHERE project_id = ${projectId}`;
    assert.equal(count, 6);
    assert.equal(results.filter((r) => r.success).length, 6 - 4);
  });
});

// COR-023: a member removed from the workspace can no longer write subtasks or workflow.
test("removed members cannot write subtasks or sections", async () => {
  await withProject(async ({ projectId }) => {
    const member = await sql.begin((tx) => createUser(tx));
    await sql.begin((tx) => addMember(tx, projectId, member, "admin"));
    const [task] = await sql`INSERT INTO tasks (project_id, title) VALUES (${projectId}, 't') RETURNING id`;
    viewerId = member;
    assert.equal((await subtasks.createSubtaskAction(task!.id, "one", projectId)).success, true);
    await sql`DELETE FROM project_members WHERE project_id = ${projectId} AND user_id = ${member}`;
    assert.equal((await subtasks.createSubtaskAction(task!.id, "two", projectId)).success, false);
    assert.equal((await workflow.createProjectWorkflowColumnAction({ projectId, title: "Nope" })).success, false);
  });
});

// 0216: legacy NULL positions become distinct, in exactly the board's display order.
test("task position backfill keeps the board order and leaves no ties", async () => {
  const { readFileSync } = await import("node:fs");
  const migration = readFileSync("drizzle/0216_task_position_backfill.sql", "utf8");
  await withProject(async ({ projectId }) => {
    await workflow.getProjectWorkflowColumnsAction(projectId);
    const [column] = await sql`SELECT id FROM project_workflow_columns WHERE project_id = ${projectId} AND status = 'todo' AND is_default`;
    const insert = (title: string, position: number | null, at: string) =>
      sql`INSERT INTO tasks (project_id, title, workflow_column_id, position, created_at) VALUES (${projectId}, ${title}, ${column!.id}, ${position}, ${at}) RETURNING id`;
    await insert("old-a", null, "2026-01-01");
    await insert("old-b", null, "2026-01-02");
    await insert("dragged", 5000, "2026-01-03");
    await insert("tie", 5000, "2026-01-04");
    const order = async () => (await sql`SELECT title, position FROM tasks WHERE project_id = ${projectId}
      ORDER BY COALESCE(position, 0) DESC, created_at DESC, id DESC`).map((r) => r.title);
    const before = await order();
    await sql.unsafe(migration);
    assert.deepEqual(await order(), before);
    const [{ distinct, total }] = await sql`SELECT count(DISTINCT position)::int AS distinct, count(*)::int AS total FROM tasks WHERE project_id = ${projectId}`;
    assert.equal(distinct, total);
  });
});

test("story points save, deleted tasks refuse edits, and a drag to Done is the same transition as the status control", async () => {
  await withProject(async ({ projectId }) => {
    await workflow.getProjectWorkflowColumnsAction(projectId);
    const columns = await sql`SELECT id, status FROM project_workflow_columns WHERE project_id = ${projectId} AND is_default`;
    const col = (status: string) => columns.find((c) => c.status === status)!.id as string;
    const [task] = await sql`INSERT INTO tasks (project_id, title, workflow_column_id, status) VALUES (${projectId}, 'a', ${col("todo")}, 'todo') RETURNING id`;
    const taskId = task!.id as string;

    // COR-025
    const points = await taskActions.updateTaskFieldAction(taskId, "storyPoints", 5, projectId);
    assert.equal(points.success, true, JSON.stringify(points));
    assert.ok(points.updatedAt, "the server version comes back for the client to patch in");
    const [{ story_points }] = await sql`SELECT story_points FROM tasks WHERE id = ${taskId}`;
    assert.equal(story_points, 5);

    // COR-027: a drag records the status transition like the status control; review is only asked for when the workspace requires it (default: no).
    const moved = await taskActions.moveTaskToWorkflowColumnAction(taskId, projectId, col("done"));
    assert.equal(moved.success, true, JSON.stringify(moved));
    assert.equal(moved.reviewStatus, "none");
    const events = await sql`SELECT event_type FROM task_activity_events WHERE task_id = ${taskId} AND event_type = 'status_changed'`;
    assert.equal(events.length, 1);

    // COR-026
    await sql`UPDATE tasks SET deleted_at = now() WHERE id = ${taskId}`;
    const refused = await taskActions.updateTaskFieldAction(taskId, "title", "x", projectId);
    assert.equal(refused.success, false);
    assert.match(String(refused.error), /deleted/);
  });
});

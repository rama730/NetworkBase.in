import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { addMember, closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: viewerId } }, error: null }) } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });

let workflow: typeof import("../../src/app/actions/workspace/workflow");
let subtasks: typeof import("../../src/app/actions/subtask");
let taskActions: typeof import("../../src/app/actions/task");
before(async () => {
  taskActions = await loadAppModule(() => import("../../src/app/actions/task"));
  workflow = await loadAppModule(() => import("../../src/app/actions/workspace/workflow"));
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
    await sql`DELETE FROM task_activity_events WHERE workspace_id = ${projectId}`;
    await sql`DELETE FROM tasks WHERE workspace_id = ${projectId}`;
    await sql`DELETE FROM workspace_workflow_columns WHERE workspace_id = ${projectId}`;
    await sql`DELETE FROM workspace_members WHERE workspace_id = ${projectId}`;
    await sql`DELETE FROM workspaces WHERE id = ${projectId}`;
  }
}

// COR-024: the six-section limit holds under concurrent adds.
test("concurrent section adds never exceed six sections", async () => {
  await withProject(async ({ projectId }) => {
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) => workflow.createWorkspaceWorkflowColumnAction({ projectId, title: `Extra ${i}` })),
    );
    const [{ count }] = await sql`SELECT count(*)::int AS count FROM workspace_workflow_columns WHERE workspace_id = ${projectId}`;
    assert.equal(count, 6);
    assert.equal(results.filter((r) => r.success).length, 6 - 4);
  });
});

// COR-023: a member removed from the workspace can no longer write subtasks or workflow.
test("removed members cannot write subtasks or sections", async () => {
  await withProject(async ({ projectId }) => {
    const member = await sql.begin((tx) => createUser(tx));
    await sql.begin((tx) => addMember(tx, projectId, member, "admin"));
    const [task] = await sql`INSERT INTO tasks (workspace_id, title) VALUES (${projectId}, 't') RETURNING id`;
    viewerId = member;
    assert.equal((await subtasks.createSubtaskAction(task!.id, "one", projectId)).success, true);
    await sql`DELETE FROM workspace_members WHERE workspace_id = ${projectId} AND user_id = ${member}`;
    assert.equal((await subtasks.createSubtaskAction(task!.id, "two", projectId)).success, false);
    assert.equal((await workflow.createWorkspaceWorkflowColumnAction({ projectId, title: "Nope" })).success, false);
  });
});

test("story points save, deleted tasks refuse edits, and a drag to Done is the same transition as the status control", async () => {
  await withProject(async ({ projectId }) => {
    await workflow.getWorkspaceWorkflowColumnsAction(projectId);
    const columns = await sql`SELECT id, status FROM workspace_workflow_columns WHERE workspace_id = ${projectId} AND is_default`;
    const col = (status: string) => columns.find((c) => c.status === status)!.id as string;
    const [task] = await sql`INSERT INTO tasks (workspace_id, title, workflow_column_id, status) VALUES (${projectId}, 'a', ${col("todo")}, 'todo') RETURNING id`;
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

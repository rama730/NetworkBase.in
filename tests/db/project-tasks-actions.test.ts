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
before(async () => {
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

// COR-023: a member removed from the project can no longer write subtasks or workflow.
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

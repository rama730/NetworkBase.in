import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { addMember, closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: viewerId } }, error: null }) } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });

let mutations: typeof import("../../src/app/actions/files/mutations");
before(async () => {
  mutations = await loadAppModule(() => import("../../src/app/actions/files/mutations"));
});
after(async () => { await sql.end(); await closeAppDb(); });

// Actions commit, so each test owns a fresh project and removes it afterwards.
async function withProject(fn: (ids: { owner: string; projectId: string }) => Promise<void>) {
  const owner = await sql.begin((tx) => createUser(tx));
  const projectId = await sql.begin((tx) => createProject(tx, owner));
  viewerId = owner;
  try {
    await fn({ owner, projectId });
  } finally {
    await sql`DELETE FROM project_nodes WHERE project_id = ${projectId}`;
    await sql`DELETE FROM tasks WHERE project_id = ${projectId}`;
    await sql`DELETE FROM project_members WHERE project_id = ${projectId}`;
    await sql`DELETE FROM projects WHERE id = ${projectId}`;
  }
}

async function createTask(projectId: string) {
  const [task] = await sql`INSERT INTO tasks (project_id, title) VALUES (${projectId}, 't') RETURNING id`;
  return task!.id as string;
}

test("task system folder: first creation works, repeats are idempotent", async () => {
  await withProject(async ({ projectId }) => {
    const taskId = await createTask(projectId);
    const first = await mutations.getOrCreateTaskSystemFolderAction(projectId, taskId);
    const again = await mutations.getOrCreateTaskSystemFolderAction(projectId, taskId);
    assert.equal(again, first);
    const rows = await sql`SELECT path FROM project_nodes WHERE project_id = ${projectId} AND deleted_at IS NULL ORDER BY path`;
    assert.deepEqual(rows.map((r) => r.path), ["/.system", "/.system/tasks", `/.system/tasks/${taskId}`]);
  });
});

test("task system folder: rejects a malformed id and a task from another project", async () => {
  await withProject(async ({ owner, projectId }) => {
    await assert.rejects(mutations.getOrCreateTaskSystemFolderAction(projectId, "../../x"), /Task not found/);
    const otherProject = await sql.begin((tx) => createProject(tx, owner));
    const foreignTask = await createTask(otherProject);
    try {
      await assert.rejects(mutations.getOrCreateTaskSystemFolderAction(projectId, foreignTask), /Task not found/);
      await assert.rejects(mutations.getOrCreateTaskSystemFolderAction(projectId, randomUUID()), /Task not found/);
    } finally {
      await sql`DELETE FROM tasks WHERE project_id = ${otherProject}`;
      await sql`DELETE FROM projects WHERE id = ${otherProject}`;
    }
  });
});

test("folder-tree upload needs upload access, not just membership", async () => {
  await withProject(async ({ projectId }) => {
    const member = await sql.begin((tx) => createUser(tx));
    await sql.begin((tx) => addMember(tx, projectId, member));
    await sql`UPDATE project_members SET file_upload_enabled = false WHERE project_id = ${projectId} AND user_id = ${member}`;
    viewerId = member;
    await assert.rejects(
      mutations.bulkCreateFolderTree(projectId, null, [{ path: "a/b.txt", name: "b.txt", size: 1, mimeType: "text/plain" }]),
      /uploads are disabled/i,
    );
  });
});

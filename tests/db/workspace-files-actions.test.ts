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
let collections: typeof import("../../src/app/actions/files/collections");
let versions: typeof import("../../src/app/actions/files/versions");
let trash: typeof import("../../src/app/actions/files/trash");
before(async () => {
  trash = await loadAppModule(() => import("../../src/app/actions/files/trash"));
  versions = await loadAppModule(() => import("../../src/app/actions/files/versions"));
  mutations = await loadAppModule(() => import("../../src/app/actions/files/mutations"));
  collections = await loadAppModule(() => import("../../src/app/actions/files/collections"));
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
    await sql`DELETE FROM file_versions WHERE node_id IN (SELECT id FROM workspace_nodes WHERE workspace_id = ${projectId})`;
    await sql`DELETE FROM task_node_links WHERE task_id IN (SELECT id FROM tasks WHERE workspace_id = ${projectId})`;
    await sql`DELETE FROM workspace_nodes WHERE workspace_id = ${projectId}`;
    await sql`DELETE FROM tasks WHERE workspace_id = ${projectId}`;
    await sql`DELETE FROM workspace_members WHERE workspace_id = ${projectId}`;
    await sql`DELETE FROM workspaces WHERE id = ${projectId}`;
  }
}

async function createTask(projectId: string) {
  const [task] = await sql`INSERT INTO tasks (workspace_id, title) VALUES (${projectId}, 't') RETURNING id`;
  return task!.id as string;
}

test("task system folder: first creation works, repeats are idempotent", async () => {
  await withProject(async ({ projectId }) => {
    const taskId = await createTask(projectId);
    const first = await mutations.getOrCreateTaskSystemFolderAction(projectId, taskId);
    const again = await mutations.getOrCreateTaskSystemFolderAction(projectId, taskId);
    assert.equal(again, first);
    const rows = await sql`SELECT path FROM workspace_nodes WHERE workspace_id = ${projectId} AND deleted_at IS NULL ORDER BY path`;
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
      await sql`DELETE FROM tasks WHERE workspace_id = ${otherProject}`;
      await sql`DELETE FROM workspaces WHERE id = ${otherProject}`;
    }
  });
});

test("folder-tree upload needs upload access, not just membership", async () => {
  await withProject(async ({ projectId }) => {
    const member = await sql.begin((tx) => createUser(tx));
    await sql.begin((tx) => addMember(tx, projectId, member));
    await sql`UPDATE workspace_members SET file_upload_enabled = false WHERE workspace_id = ${projectId} AND user_id = ${member}`;
    viewerId = member;
    await assert.rejects(
      mutations.bulkCreateFolderTree(projectId, null, [{ path: "a/b.txt", name: "b.txt", size: 1, mimeType: "text/plain" }]),
      /uploads are disabled/i,
    );
  });
});

async function insertNode(projectId: string, owner: string, type: "file" | "folder", name: string, path: string, parentId: string | null) {
  const [row] = await sql`INSERT INTO workspace_nodes (workspace_id, type, name, path, parent_id, created_by)
    VALUES (${projectId}, ${type}, ${name}, ${path}, ${parentId}, ${owner}) RETURNING id`;
  return row!.id as string;
}

test("a trashed descendant follows its folder's rename and restores under the new path", async () => {
  await withProject(async ({ owner, projectId }) => {
    const folder = await insertNode(projectId, owner, "folder", "A", "/A", null);
    const file = await insertNode(projectId, owner, "file", "x.txt", "/A/x.txt", folder);
    await mutations.bulkTrashNodes([file], projectId);
    await mutations.renameNode(folder, "B", projectId);
    const [trashed] = await sql`SELECT path FROM workspace_nodes WHERE id = ${file}`;
    assert.equal(trashed!.path, "/B/x.txt");
    await mutations.restoreNode(file, projectId);
    const [restored] = await sql`SELECT path, deleted_at FROM workspace_nodes WHERE id = ${file}`;
    assert.equal(restored!.path, "/B/x.txt");
    assert.equal(restored!.deleted_at, null);
  });
});

test("folder-tree upload matches existing folders case-insensitively", async () => {
  await withProject(async ({ owner, projectId }) => {
    await insertNode(projectId, owner, "folder", "Docs", "/Docs", null);
    await mutations.bulkCreateFolderTree(projectId, null, [{ path: "docs/guide/a.txt", name: "a.txt", size: 1, mimeType: "text/plain" }]);
    const rows = await sql`SELECT path FROM workspace_nodes WHERE workspace_id = ${projectId} AND type = 'folder' AND deleted_at IS NULL ORDER BY path`;
    assert.deepEqual(rows.map((r) => r.path), ["/Docs", "/Docs/guide"]);
  });
});

test("renaming a folder never rewrites an unrelated trashed folder that once had its path", async () => {
  await withProject(async ({ owner, projectId }) => {
    const oldFolder = await insertNode(projectId, owner, "folder", "A", "/A", null);
    const oldFile = await insertNode(projectId, owner, "file", "old.txt", "/A/old.txt", oldFolder);
    await mutations.bulkTrashNodes([oldFolder], projectId);
    const liveFolder = await insertNode(projectId, owner, "folder", "A", "/A", null);
    await mutations.renameNode(liveFolder, "C", projectId);
    const [untouched] = await sql`SELECT path FROM workspace_nodes WHERE id = ${oldFile}`;
    assert.equal(untouched!.path, "/A/old.txt");
  });
});

// COR-011: task groups keep every selected file when the page spans more than 100 nodes.
test("task file groups never drop files past a 100-node hydration cap", async () => {
  await withProject(async ({ owner, projectId }) => {
    for (let t = 0; t < 3; t++) {
      const taskId = await createTask(projectId);
      for (let f = 0; f < 40; f++) {
        const node = await insertNode(projectId, owner, "file", `t${t}-f${f}.txt`, `/t${t}-f${f}.txt`, null);
        await sql`INSERT INTO task_node_links (task_id, node_id, created_by, tags) VALUES (${taskId}, ${node}, ${owner}, ${sql.json(["working_file"])})`;
      }
    }
    const { groups } = await collections.getTaskFileGroups(projectId);
    assert.equal(groups.length, 3);
    for (const group of groups) assert.equal(group.entries.length, 40, group.id);
  });
});

// COR-013: versions older than the newest 100 can be deleted; the current version falls back to the newest left.
test("version delete reaches any version and keeps the newest as current", async () => {
  await withProject(async ({ owner, projectId }) => {
    const key = `projects/${projectId}/files/a.bin`;
    const [asset] = await sql`INSERT INTO storage_assets (bucket, storage_key, purpose, state, declared_mime_type, declared_size, expires_at, verified_at, verified_size, verified_mime_type)
      VALUES ('project-files', ${key}, 'project_file', 'verified', 'application/octet-stream', 1, now() + interval '1 day', now(), 1, 'application/octet-stream') RETURNING id`;
    const [node] = await sql`INSERT INTO workspace_nodes (workspace_id, type, name, path, created_by, s3_key, asset_id, size, mime_type, current_version)
      VALUES (${projectId}, 'file', 'a.bin', '/a.bin', ${owner}, ${key}, ${asset!.id}, 1, 'application/octet-stream', 105) RETURNING id`;
    await sql`INSERT INTO file_versions (node_id, version, s3_key, size, mime_type, uploaded_by, asset_id)
      SELECT ${node!.id}, v, ${key}, 1, 'application/octet-stream', ${owner}, ${asset!.id} FROM generate_series(1, 105) v`;
    try {
      assert.equal((await versions.deleteFileVersionAction(projectId, node!.id, 1)).success, true);
      const current = await versions.deleteFileVersionAction(projectId, node!.id, 105);
      assert.equal(current.nextActiveVersion, 104);
      const [{ count }] = await sql`SELECT count(*)::int AS count FROM file_versions WHERE node_id = ${node!.id}`;
      assert.equal(count, 103);
    } finally {
      await sql`DELETE FROM file_versions WHERE node_id = ${node!.id}`;
      await sql`DELETE FROM workspace_nodes WHERE id = ${node!.id}`;
      await sql`DELETE FROM storage_asset_deletion_jobs WHERE asset_id = ${asset!.id}`.catch(() => undefined);
    }
  });
});

// PERF-003: the set-based guards still reject what the per-node ones did.
test("bulk move rejects a name clash and a move into a descendant", async () => {
  await withProject(async ({ owner, projectId }) => {
    const dest = await insertNode(projectId, owner, "folder", "dest", "/dest", null);
    await insertNode(projectId, owner, "file", "Same.txt", "/dest/Same.txt", dest);
    const clash = await insertNode(projectId, owner, "file", "same.txt", "/same.txt", null);
    await assert.rejects(mutations.moveWorkspaceNodes([clash], dest, projectId), /already exists/);
    const child = await insertNode(projectId, owner, "folder", "inner", "/dest/inner", dest);
    await assert.rejects(mutations.moveWorkspaceNodes([dest], child, projectId), /descendant/);
    const ok = await insertNode(projectId, owner, "file", "b.txt", "/b.txt", null);
    const moved = await mutations.moveWorkspaceNodes([ok], dest, projectId);
    assert.equal(moved.nodes[0]?.path, "/dest/b.txt");
  });
});

test("trash lists only what was trashed, newest first, and bulk purge deletes exactly the review", async () => {
  await withProject(async ({ owner, projectId }) => {
    const folder = await insertNode(projectId, owner, "folder", "F", "/F", null);
    await insertNode(projectId, owner, "file", "inside.txt", "/F/inside.txt", folder);
    const loose = await insertNode(projectId, owner, "file", "loose.txt", "/loose.txt", null);
    await mutations.bulkTrashNodes([folder], projectId);
    await mutations.bulkTrashNodes([loose], projectId);
    const page = await mutations.getTrashPage(projectId);
    assert.deepEqual(page.nodes.map((n) => n.name), ["loose.txt", "F"]);

    const impact = await trash.getBulkPermanentDeleteImpact(projectId, "all");
    assert.equal(impact.roots, 2);
    assert.equal(impact.items, 3);
    const result = await trash.permanentlyDeleteTrashedNodes(projectId, impact.fingerprints);
    assert.deepEqual({ deleted: result.deletedIds.length, pending: result.pendingIds.length, failed: result.failed.length }, { deleted: 3, pending: 0, failed: 0 });
    // A stale review is reported as failed, never silently counted as deleted.
    const again = await trash.permanentlyDeleteTrashedNodes(projectId, { [loose]: "stale" });
    assert.equal(again.deletedIds.length, 0);
  });
});

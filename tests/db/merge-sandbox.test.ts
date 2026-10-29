import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, sql, type Tx } from "./_helpers";

// mergeSandboxTask runs its own transaction, so fixtures are committed and
// removed by deleting the workspaces afterwards.
let merge: typeof import("../../src/lib/workspaces/merge-sandbox").mergeSandboxTask;
const createdProjects: string[] = [];
before(async () => {
  ({ mergeSandboxTask: merge } = await loadAppModule(() => import("../../src/lib/workspaces/merge-sandbox")));
});
after(async () => {
  if (createdProjects.length) await sql`DELETE FROM public.projects WHERE id IN ${sql(createdProjects)}`;
  await sql.end();
  await closeAppDb();
});

async function setup() {
  return sql.begin(async (tx) => {
    const owner = await createUser(tx);
    const projectId = await createProject(tx, owner);
    createdProjects.push(projectId);
    const [task] = await tx`INSERT INTO public.tasks (project_id, title) VALUES (${projectId}, 'sandbox') RETURNING id`;
    return { owner, projectId, taskId: task!.id as string };
  });
}

async function node(tx: Tx, input: {
  projectId: string; path: string; type?: "file" | "folder"; parentId?: string | null; taskId?: string | null;
  canonical?: string | null; sync?: string; assetId?: string | null; s3?: string;
}) {
  const name = input.path.split("/").pop()!;
  const [row] = await tx`
    INSERT INTO public.project_nodes (project_id, parent_id, type, name, path, task_id, canonical_node_id, sync_status, asset_id, s3_key)
    VALUES (${input.projectId}, ${input.parentId ?? null}, ${input.type ?? "file"}, ${name}, ${input.path}, ${input.taskId ?? null},
            ${input.canonical ?? null}, ${input.sync ?? "draft"}, ${input.assetId ?? null}, ${input.s3 ?? null})
    RETURNING id`;
  return row!.id as string;
}

const paths = async (projectId: string) =>
  (await sql`SELECT path FROM public.project_nodes WHERE project_id = ${projectId} AND task_id IS NULL AND deleted_at IS NULL ORDER BY path`).map((r) => r.path);

test("COR-057: a staged node cannot bind to another project's file (merge guard + DB-001 composite FK)", async () => {
  const a = await setup();
  const b = await setup();
  const foreign = await sql.begin((tx) => node(tx, { projectId: b.projectId, path: "/victim.txt", s3: "b/victim" }));
  await assert.rejects(
    sql.begin((tx) => node(tx, { projectId: a.projectId, path: "/victim.txt", taskId: a.taskId, canonical: foreign, s3: "a/evil" })),
    /project_nodes_project_id_canonical_node_id_fkey/,
  );
  const [victim] = await sql`SELECT path, s3_key, project_id FROM public.project_nodes WHERE id = ${foreign}`;
  assert.deepEqual({ ...victim }, { path: "/victim.txt", s3_key: "b/victim", project_id: b.projectId });
});

test("COR-059: deleting folder 'a_' leaves sibling 'ab' and its children alone", async () => {
  const p = await setup();
  await sql.begin(async (tx) => {
    const folder = await node(tx, { projectId: p.projectId, path: "/a_", type: "folder" });
    await node(tx, { projectId: p.projectId, path: "/a_/in.txt", parentId: folder });
    const sibling = await node(tx, { projectId: p.projectId, path: "/ab", type: "folder" });
    await node(tx, { projectId: p.projectId, path: "/ab/keep.txt", parentId: sibling });
    await node(tx, { projectId: p.projectId, path: "/a_", type: "folder", taskId: p.taskId, canonical: folder, sync: "deleted_tombstone" });
  });
  await merge(p.owner, p.projectId, p.taskId, randomUUID());
  assert.deepEqual(await paths(p.projectId), ["/ab", "/ab/keep.txt"]);
});

test("COR-058: renaming a folder moves its descendants, nested renames take the deepest prefix", async () => {
  const p = await setup();
  await sql.begin(async (tx) => {
    const src = await node(tx, { projectId: p.projectId, path: "/src", type: "folder" });
    const inner = await node(tx, { projectId: p.projectId, path: "/src/inner", type: "folder", parentId: src });
    await node(tx, { projectId: p.projectId, path: "/src/x.ts", parentId: src });
    await node(tx, { projectId: p.projectId, path: "/src/inner/y.ts", parentId: inner });
    await node(tx, { projectId: p.projectId, path: "/lib", type: "folder", taskId: p.taskId, canonical: src });
    await node(tx, { projectId: p.projectId, path: "/lib/core", type: "folder", taskId: p.taskId, canonical: inner });
  });
  await merge(p.owner, p.projectId, p.taskId, randomUUID());
  assert.deepEqual(await paths(p.projectId), ["/lib", "/lib/core", "/lib/core/y.ts", "/lib/x.ts"]);
});

test("COR-060: a new file under a staged copy of an existing folder survives the merge", async () => {
  const p = await setup();
  const docs = await sql.begin(async (tx) => {
    const docsFolder = await node(tx, { projectId: p.projectId, path: "/docs", type: "folder" });
    const staged = await node(tx, { projectId: p.projectId, path: "/docs", type: "folder", taskId: p.taskId, canonical: docsFolder });
    await node(tx, { projectId: p.projectId, path: "/docs/new.md", parentId: staged, taskId: p.taskId });
    return docsFolder;
  });
  await merge(p.owner, p.projectId, p.taskId, randomUUID());
  const [promoted] = await sql`SELECT parent_id FROM public.project_nodes WHERE project_id = ${p.projectId} AND path = '/docs/new.md' AND deleted_at IS NULL`;
  assert.equal(promoted?.parent_id, docs);
});

test("COR-004: merged edits carry the staged verified asset onto the canonical node and its new version", async () => {
  const p = await setup();
  const { canonical, assetId } = await sql.begin(async (tx) => {
    const [asset] = await tx`INSERT INTO public.storage_assets (project_id, owner_user_id, bucket, storage_key, purpose, state, declared_mime_type, declared_size, verified_mime_type, verified_size, verified_at, content_hash, expires_at)
      VALUES (${p.projectId}, ${p.owner}, 'project-files', ${`${p.projectId}/new`}, 'project_file:file', 'verified', 'text/plain', 3, 'text/plain', 3, now(), 'abc', now() + interval '1 day') RETURNING id`;
    const canonicalId = await node(tx, { projectId: p.projectId, path: "/f.txt", s3: `${p.projectId}/old` });
    const staged = await node(tx, { projectId: p.projectId, path: "/f.txt", taskId: p.taskId, canonical: canonicalId, s3: `${p.projectId}/new`, assetId: asset!.id });
    await tx`INSERT INTO public.file_versions (node_id, version, s3_key, size, mime_type, content_hash, asset_id) VALUES (${staged}, 1, ${`${p.projectId}/new`}, 3, 'text/plain', 'abc', ${asset!.id})`;
    return { canonical: canonicalId, assetId: asset!.id as string };
  });
  await merge(p.owner, p.projectId, p.taskId, randomUUID());
  const [nodeRow] = await sql`SELECT asset_id, s3_key FROM public.project_nodes WHERE id = ${canonical}`;
  const [version] = await sql`SELECT asset_id FROM public.file_versions WHERE node_id = ${canonical} ORDER BY version DESC LIMIT 1`;
  assert.equal(nodeRow?.asset_id, assetId);
  assert.equal(version?.asset_id, assetId);
});

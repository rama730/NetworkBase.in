import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// Report Part H, phase H-1 (M8): with Branches on, every change to main's files is a save, recorded by the database
// (0096). History, a save's files, files at a save and revert read and act on those saves.
moduleStubs.set("next/headers", { headers: async () => ({ get: () => null }), cookies: async () => ({ getAll: () => [], get: () => undefined, set: () => undefined }) });
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
const stored = new Map<string, Buffer>();
moduleStubs.set("@/lib/supabase/server", {
  createAdminClient: async () => ({ storage: { from: () => ({
    upload: async (key: string, body: Buffer) => { stored.set(key, Buffer.from(body)); return { error: null }; },
    download: async (key: string) => (stored.has(key) ? { data: new Blob([stored.get(key)!]), error: null } : { data: null, error: new Error("not found") }),
    remove: async (keys: string[]) => { for (const k of keys) stored.delete(k); return { error: null }; },
    createSignedUrl: async (key: string) => ({ data: { signedUrl: `https://storage.test/${key}` }, error: null }),
  }) } }),
});

type Saves = typeof import("../../src/lib/domain/saves");
let saves: Saves;
before(async () => { saves = await loadAppModule(() => import("../../src/lib/domain/saves")); });
after(async () => { await sql.end(); await closeAppDb(); });

const sha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
const actor = (id: string) => ({ user: { id } });
const request = () => new Request("https://app.test/x", { method: "POST" });

async function content(workspace: string, userId: string, text: string) {
  const bytes = Buffer.from(text);
  const key = `${workspace}/test/${sha(bytes)}-${randomUUID()}`;
  stored.set(key, bytes);
  const [asset] = await sql`INSERT INTO storage_assets (owner_user_id, workspace_id, bucket, storage_key, purpose, state, declared_mime_type, declared_size, content_hash, expires_at, verified_at, verified_size, verified_mime_type)
    VALUES (${userId}, ${workspace}, 'project-files', ${key}, 'workspace_file:file', 'verified', 'text/plain', ${bytes.byteLength}, ${sha(bytes)}, now(), now(), ${bytes.byteLength}, 'text/plain') RETURNING id`;
  return { key, assetId: asset!.id as string, hash: sha(bytes), size: bytes.byteLength };
}
async function addFile(workspace: string, userId: string, path: string, text: string, opts: { taskId?: string; tx?: typeof sql } = {}) {
  const c = await content(workspace, userId, text);
  const q = opts.tx ?? sql;
  const [node] = await q`INSERT INTO workspace_nodes (workspace_id, type, name, path, created_by, size, current_version, s3_key, asset_id, mime_type, task_id)
    VALUES (${workspace}, 'file', ${path.split("/").pop()!}, ${path}, ${userId}, ${c.size}, 1, ${c.key}, ${c.assetId}, 'text/plain', ${opts.taskId ?? null}) RETURNING id`;
  await q`INSERT INTO file_versions (node_id, version, s3_key, asset_id, size, mime_type, content_hash, uploaded_by) VALUES (${node!.id}, 1, ${c.key}, ${c.assetId}, ${c.size}, 'text/plain', ${c.hash}, ${userId})`;
  return node!.id as string;
}
/** A new version, the way the editor saves one: the version row, then the node points at it. */
async function edit(workspace: string, userId: string, nodeId: string, text: string, comment: string | null = null, q: typeof sql = sql) {
  const c = await content(workspace, userId, text);
  const [{ v }] = await q`SELECT coalesce(max(version), 0) + 1 AS v FROM file_versions WHERE node_id = ${nodeId}`;
  await q`INSERT INTO file_versions (node_id, version, s3_key, asset_id, size, mime_type, content_hash, uploaded_by, comment) VALUES (${nodeId}, ${v}, ${c.key}, ${c.assetId}, ${c.size}, 'text/plain', ${c.hash}, ${userId}, ${comment})`;
  await q`UPDATE workspace_nodes SET current_version = ${v}, s3_key = ${c.key}, asset_id = ${c.assetId}, size = ${c.size} WHERE id = ${nodeId}`;
}
const history = async (workspace: string) => sql`SELECT s.* FROM saves s JOIN branches b ON b.id = s.branch_id AND b.is_default WHERE s.workspace_id = ${workspace} ORDER BY s.seq`;
const changesOf = async (saveId: string) => sql`SELECT path, before_path, op FROM save_changes WHERE save_id = ${saveId} ORDER BY path`;
async function readText(workspace: string, path: string) {
  const [n] = await sql`SELECT s3_key FROM workspace_nodes WHERE workspace_id = ${workspace} AND path = ${path} AND deleted_at IS NULL`;
  return n ? stored.get(n.s3_key as string)?.toString() : undefined;
}

async function setup(on = true) {
  const owner = await sql.begin((tx) => createUser(tx));
  const workspace = await sql.begin((tx) => createProject(tx, owner));
  await addFile(workspace, owner, "/README.md", "# Demo\n");
  await addFile(workspace, owner, "/src/a.ts", "export const a = 1;\n");
  if (on) await saves.setBranchesEnabled(actor(owner), workspace, true);
  return { owner, workspace };
}

test("off: writes record nothing; turning it on makes main, the start of history and a checkpoint", async () => {
  const { owner, workspace } = await setup(false);
  await addFile(workspace, owner, "/b.md", "b");
  assert.equal((await sql`SELECT count(*)::int AS n FROM saves WHERE workspace_id = ${workspace}`)[0]!.n, 0);
  await saves.setBranchesEnabled(actor(owner), workspace, true);
  const [w] = await sql`SELECT branches_enabled, change_sets_enabled FROM workspaces WHERE id = ${workspace}`;
  assert.deepEqual([w!.branches_enabled, w!.change_sets_enabled], [true, true]);
  const [start] = await history(workspace);
  assert.equal(start!.kind, "start");
  assert.equal(start!.message, "Start of history");
  const files = await sql`SELECT f.path FROM checkpoint_files f JOIN tree_checkpoints c ON c.id = f.checkpoint_id WHERE c.save_id = ${start!.id} ORDER BY f.path COLLATE "C"`;
  assert.deepEqual(files.map((f) => f.path), ["/README.md", "/b.md", "/src/a.ts"]); // byte order: capitals first
  const [main] = await sql`SELECT name, head_save_id FROM branches WHERE workspace_id = ${workspace} AND is_default`;
  assert.deepEqual([main!.name, main!.head_save_id], ["main", start!.id]);
  // Turning it on twice changes nothing.
  await saves.setBranchesEnabled(actor(owner), workspace, true);
  assert.equal((await history(workspace)).length, 1);
});

test("each kind of write is one save with the right changes, message and author", async () => {
  const { owner, workspace } = await setup();
  const added = await addFile(workspace, owner, "/notes.md", "hello");
  await edit(workspace, owner, added, "hello again", "Fix the greeting");
  await sql`UPDATE workspace_nodes SET deleted_at = now(), deleted_by = ${owner} WHERE id = ${added}`;
  await sql`UPDATE workspace_nodes SET deleted_at = NULL, deleted_by = NULL WHERE id = ${added}`;
  await sql`UPDATE workspace_nodes SET path = '/docs/notes.md', name = 'notes.md' WHERE id = ${added}`;
  const all = await history(workspace);
  assert.deepEqual(all.map((s) => s.message), ["Start of history", "Added notes.md", "Fix the greeting", "Deleted notes.md", "Restored notes.md", "Moved notes.md to /docs"]);
  assert.deepEqual(all.map((s) => Number(s.seq)), [1, 2, 3, 4, 5, 6]);
  for (let i = 1; i < all.length; i++) assert.equal(all[i]!.parent_save_id, all[i - 1]!.id);
  assert.ok(all.slice(1).every((s) => s.author_id === owner));
  assert.deepEqual((await changesOf(all[5]!.id)).map((c) => [c.before_path, c.path, c.op]), [["/notes.md", "/docs/notes.md", "rename"]]);
  // Things that aren't file changes record nothing: sync state, metadata, a lock-like touch.
  await sql`UPDATE workspace_nodes SET sync_status = 'git_synced', metadata = '{"executable": true}', updated_at = now() WHERE id = ${added}`;
  assert.equal((await history(workspace)).length, 6);
});

test("one transaction is one save; a file added and removed in it leaves none; task and /.system files never count", async () => {
  const { owner, workspace } = await setup();
  const [readme] = await sql`SELECT id FROM workspace_nodes WHERE workspace_id = ${workspace} AND path = '/README.md'`;
  await sql.begin(async (tx) => {
    await edit(workspace, owner, readme!.id, "# Demo 2\n", null, tx as unknown as typeof sql);
    await addFile(workspace, owner, "/c.ts", "c", { tx: tx as unknown as typeof sql });
  });
  let all = await history(workspace);
  assert.equal(all.length, 2);
  assert.equal(all[1]!.message, "Changed 2 files");
  assert.deepEqual([all[1]!.files_added, all[1]!.files_changed], [1, 1]);
  await sql.begin(async (tx) => {
    const id = await addFile(workspace, owner, "/tmp.txt", "x", { tx: tx as unknown as typeof sql });
    await tx`DELETE FROM workspace_nodes WHERE id = ${id}`;
  });
  const [task] = await sql`INSERT INTO tasks (workspace_id, title, creator_id) VALUES (${workspace}, 'T', ${owner}) RETURNING id`;
  await addFile(workspace, owner, "/.system/tasks/1/work.md", "w", { taskId: task!.id });
  await addFile(workspace, owner, "/x/task-file.md", "w", { taskId: task!.id });
  all = await history(workspace);
  assert.equal(all.length, 2);
});

test("a writer's own words win; a folder rename moves every file under it", async () => {
  const { owner, workspace } = await setup();
  await addFile(workspace, owner, "/src/b.ts", "b");
  await sql.begin(async (tx) => {
    await tx`SELECT set_config('nb.save', ${JSON.stringify({ kind: "restore", message: "Restored the src folder", authorId: owner })}, true)`;
    await tx`UPDATE workspace_nodes SET path = regexp_replace(path, '^/src/', '/lib/') WHERE workspace_id = ${workspace} AND path LIKE '/src/%'`;
  });
  const last = (await history(workspace)).at(-1)!;
  assert.deepEqual([last.kind, last.message, last.files_renamed], ["restore", "Restored the src folder", 2]);
});

test("files at a save: checkpoint plus replay matches the files at that moment, with a checkpoint every 100 saves", async () => {
  const { owner, workspace } = await setup();
  const [a] = await sql`SELECT id FROM workspace_nodes WHERE workspace_id = ${workspace} AND path = '/src/a.ts'`;
  for (let i = 0; i < 104; i++) await edit(workspace, owner, a!.id, `export const a = ${i + 2};\n`);
  await addFile(workspace, owner, "/late.md", "late");
  const all = await history(workspace);
  assert.equal(all.length, 106);
  const checkpoints = await sql`SELECT s.seq FROM tree_checkpoints c JOIN saves s ON s.id = c.save_id WHERE c.workspace_id = ${workspace} ORDER BY s.seq`;
  assert.deepEqual(checkpoints.map((c) => Number(c.seq)), [1, 100]);
  const o = actor(owner);
  const at = async (seq: number) => (await saves.filesAtSave(o, all[seq - 1]!.id)).files.files.map((f) => `${f.path}@${f.version}`);
  assert.deepEqual(await at(1), ["/README.md@1", "/src/a.ts@1"]);
  assert.deepEqual(await at(50), ["/README.md@1", "/src/a.ts@50"]);
  assert.deepEqual(await at(103), ["/README.md@1", "/src/a.ts@103"]);
  assert.deepEqual(await at(106), ["/README.md@1", "/late.md@1", "/src/a.ts@105"]);
});

test("history lists newest first with filters; members only", async () => {
  const { owner, workspace } = await setup();
  const other = await sql.begin((tx) => createUser(tx));
  await addFile(workspace, owner, "/docs/one.md", "1");
  await addFile(workspace, owner, "/two.md", "2");
  const o = actor(owner);
  const page = await saves.listSaves(o, workspace, { limit: 2 });
  assert.deepEqual(page.saves.map((s) => s.message), ["Added two.md", "Added one.md"]);
  const rest = await saves.listSaves(o, workspace, { cursor: page.nextCursor });
  assert.deepEqual(rest.saves.map((s) => s.message), ["Start of history"]);
  assert.deepEqual((await saves.listSaves(o, workspace, { path: "/docs" })).saves.map((s) => s.message), ["Added one.md"]);
  const one = await saves.getSave(o, page.saves[0]!.id);
  assert.deepEqual(one.files.map((f) => [f.path, f.op]), [["/two.md", "add"]]);
  const diff = await saves.saveDiff(o, page.saves[0]!.id, "/two.md");
  assert.equal(diff.kind, "text");
  await assert.rejects(saves.listSaves(actor(other), workspace), { code: "NOT_FOUND" });
  await assert.rejects(saves.setBranchesEnabled(actor(other), workspace, false), { code: "NOT_FOUND" });
});

test("revert: a change goes back, a delete comes back, an add goes away, as one new revert save", async () => {
  const { owner, workspace } = await setup();
  const o = actor(owner);
  const [readme] = await sql`SELECT id FROM workspace_nodes WHERE workspace_id = ${workspace} AND path = '/README.md'`;
  const [a] = await sql`SELECT id FROM workspace_nodes WHERE workspace_id = ${workspace} AND path = '/src/a.ts'`;
  await sql.begin(async (tx) => {
    await edit(workspace, owner, readme!.id, "# Changed\n", null, tx as unknown as typeof sql);
    await tx`UPDATE workspace_nodes SET deleted_at = now(), deleted_by = ${owner} WHERE id = ${a!.id}`;
    await addFile(workspace, owner, "/new.md", "new", { tx: tx as unknown as typeof sql });
  });
  const target = (await history(workspace)).at(-1)!;
  const result = await saves.revertSave(o, request(), target.id);
  assert.equal(result.outcome, "reverted");
  assert.equal(await readText(workspace, "/README.md"), "# Demo\n");
  assert.equal(await readText(workspace, "/src/a.ts"), "export const a = 1;\n");
  assert.equal(await readText(workspace, "/new.md"), undefined);
  const last = (await history(workspace)).at(-1)!;
  assert.deepEqual([last.id, last.kind, last.reverts_save_id, last.message], [result.saveId, "revert", target.id, `Revert "Changed 3 files"`]);
  await assert.rejects(saves.revertSave(o, request(), (await history(workspace))[0]!.id), { code: "NOT_REVERTIBLE" });
});

test("revert merges with later work on the same file", async () => {
  const { owner, workspace } = await setup();
  const [readme] = await sql`SELECT id FROM workspace_nodes WHERE workspace_id = ${workspace} AND path = '/README.md'`;
  await edit(workspace, owner, readme!.id, "a\nb\nc\nd\ne\nf\n");
  await edit(workspace, owner, readme!.id, "a\nb\nc\nd\nE\nf\n");
  const target = (await history(workspace)).at(-1)!;
  await edit(workspace, owner, readme!.id, "A\nb\nc\nd\nE\nf\n");
  const result = await saves.revertSave(actor(owner), request(), target.id);
  assert.equal(result.outcome, "reverted");
  assert.equal(await readText(workspace, "/README.md"), "A\nb\nc\nd\ne\nf\n");
});

test("speed (H18, H25): 5,000 files; turning History on, a history page and files at a save stay quick", async () => {
  const owner = await sql.begin((tx) => createUser(tx));
  const workspace = await sql.begin((tx) => createProject(tx, owner));
  await sql`INSERT INTO workspace_nodes (workspace_id, type, name, path, created_by, size, current_version, s3_key, mime_type)
    SELECT ${workspace}, 'file', 'f' || i || '.ts', '/src/m' || (i % 50) || '/f' || i || '.ts', ${owner}, 10, 1, 'k/' || i, 'text/plain' FROM generate_series(1, 5000) i`;
  const o = actor(owner);
  let t = Date.now();
  await saves.setBranchesEnabled(o, workspace, true);
  const enableMs = Date.now() - t;
  const ids = await sql`SELECT id FROM workspace_nodes WHERE workspace_id = ${workspace} ORDER BY path LIMIT 150`;
  for (const n of ids) await sql`UPDATE workspace_nodes SET current_version = 2 WHERE id = ${n.id}`;
  t = Date.now();
  const page = await saves.listSaves(o, workspace, {});
  const historyMs = Date.now() - t;
  const all = await history(workspace);
  t = Date.now();
  const tree = await saves.filesAtSave(o, all.at(-1)!.id);
  const treeMs = Date.now() - t;
  assert.equal(page.saves.length, 50);
  assert.equal(tree.files.files.length, 5000);
  assert.equal(tree.files.files.filter((f) => f.version === 2).length, 150);
  console.log(`bench: enable ${enableMs} ms, history page ${historyMs} ms, files at a save ${treeMs} ms`);
  assert.ok(historyMs < 500, `history page took ${historyMs} ms`);
  assert.ok(treeMs < 1000, `files at a save took ${treeMs} ms`);
});

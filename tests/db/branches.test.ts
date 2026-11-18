import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { addMember, closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, unprotect } from "./_helpers";

// Report Part H, phase H-2 (M8): branches. A branch is main at its base plus its own files; saves on it go through
// change sets or the branch writer; update from main merges; names, limits and who may rename or delete.
let headerValues: Record<string, string> = {};
moduleStubs.set("next/headers", { headers: async () => ({ get: (name: string) => headerValues[name.toLowerCase()] ?? null }), cookies: async () => ({ getAll: () => [], get: () => undefined, set: () => undefined }) });
moduleStubs.set("@/lib/security/csrf", { validateCsrf: () => null });
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

// Branch watchers' notifications (H8, H24) are caught here instead of queued.
const sent: Array<{ kind: string; title: string; recipientUserId: string; dedupeKey: string; operation?: string }> = [];
moduleStubs.set("@/lib/notifications/fanout", { enqueueNotificationFanout: async (e: { writes: Array<{ operation: string; input: { kind: string; title: string; recipientUserId: string; dedupeKey: string } }> }) => { for (const w of e.writes) sent.push({ ...w.input, operation: w.operation }); return { enqueued: e.writes.length }; } });
type Branches = typeof import("../../src/lib/domain/branches");
type Saves = typeof import("../../src/lib/domain/saves");
type Sets = typeof import("../../src/lib/domain/change-sets");
let branches: Branches;
let saves: Saves;
let sets: Sets;
before(async () => {
  branches = await loadAppModule(() => import("../../src/lib/domain/branches"));
  saves = await loadAppModule(() => import("../../src/lib/domain/saves"));
  sets = await loadAppModule(() => import("../../src/lib/domain/change-sets"));
});
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
async function addFile(workspace: string, userId: string, path: string, text: string) {
  const c = await content(workspace, userId, text);
  const [node] = await sql`INSERT INTO workspace_nodes (workspace_id, type, name, path, created_by, size, current_version, s3_key, asset_id, mime_type)
    VALUES (${workspace}, 'file', ${path.split("/").pop()!}, ${path}, ${userId}, ${c.size}, 1, ${c.key}, ${c.assetId}, 'text/plain') RETURNING id`;
  await sql`INSERT INTO file_versions (node_id, version, s3_key, asset_id, size, mime_type, content_hash, uploaded_by) VALUES (${node!.id}, 1, ${c.key}, ${c.assetId}, ${c.size}, 'text/plain', ${c.hash}, ${userId})`;
  return node!.id as string;
}
async function editMain(workspace: string, userId: string, path: string, text: string) {
  const [n] = await sql`SELECT id FROM workspace_nodes WHERE workspace_id = ${workspace} AND path = ${path} AND deleted_at IS NULL`;
  const c = await content(workspace, userId, text);
  const [{ v }] = await sql`SELECT coalesce(max(version), 0) + 1 AS v FROM file_versions WHERE node_id = ${n!.id}`;
  await sql.begin(async (tx) => {
    await tx`INSERT INTO file_versions (node_id, version, s3_key, asset_id, size, mime_type, content_hash, uploaded_by) VALUES (${n!.id}, ${v}, ${c.key}, ${c.assetId}, ${c.size}, 'text/plain', ${c.hash}, ${userId})`;
    await tx`UPDATE workspace_nodes SET current_version = ${v}, s3_key = ${c.key}, asset_id = ${c.assetId}, size = ${c.size} WHERE id = ${n!.id}`;
  });
}
/** Writes on a branch the way the CLI and agents do: a change set on the branch, finished and applied. */
async function onBranch(userId: string, workspace: string, branchId: string, title: string, files: Record<string, string | null>) {
  const o = actor(userId);
  const set = await sets.startChangeSet(o, { workspaceId: workspace, title, branchId });
  const live = await branches.branchLiveFiles(branchId, Object.keys(files));
  const items = [];
  for (const [path, text] of Object.entries(files)) {
    if (text === null) { items.push({ op: "delete" as const, path }); continue; }
    const c = await content(workspace, userId, text);
    items.push({ op: (live.has(path) ? "change" : "add") as "change" | "add", path, contentHash: c.hash, size: c.size, mimeType: "text/plain" });
  }
  await sets.upsertItems(o, set.id, items);
  await sets.finishChangeSet(o, set.id, {});
  return sets.applyChangeSet(o, request(), set.id);
}
async function textOn(branch: { id: string }, mainId: string, path: string) {
  const [b] = await sql`SELECT * FROM branches WHERE id = ${branch.id}`;
  const page = await branches.branchTree({ id: b!.id, isDefault: b!.is_default, headSaveId: b!.head_save_id, baseSaveId: b!.base_save_id } as never, mainId, { paths: [path] });
  const f = page.files[0];
  if (!f) return undefined;
  return stored.get(f.storageKey!)?.toString();
}
async function setup() {
  const owner = await sql.begin((tx) => createUser(tx));
  const workspace = await sql.begin((tx) => createProject(tx, owner));
  await addFile(workspace, owner, "/README.md", "# Demo\n");
  await addFile(workspace, owner, "/src/a.ts", "a1\na2\na3\na4\na5\na6\n");
  await saves.setBranchesEnabled(actor(owner), workspace, true);
  await unprotect(workspace);
  const [main] = await sql`SELECT id FROM branches WHERE workspace_id = ${workspace} AND is_default`;
  return { owner, workspace, mainId: main!.id as string };
}

test("create from main: names are checked and unique; the branch has main's files; main is listed first", async () => {
  const { owner, workspace, mainId } = await setup();
  const o = actor(owner);
  await assert.rejects(branches.createBranch(o, workspace, { name: "main" }), { code: "BAD_BRANCH_NAME" });
  await assert.rejects(branches.createBranch(o, workspace, { name: "a..b" }), { code: "BAD_BRANCH_NAME" });
  const { branch } = await branches.createBranch(o, workspace, { name: "feature-x" });
  await assert.rejects(branches.createBranch(o, workspace, { name: "Feature-X" }), { code: "BRANCH_EXISTS" });
  assert.deepEqual([branch.name, branch.ahead, branch.behind, branch.changedFiles], ["feature-x", 0, 0, 0]);
  const [row] = await sql`SELECT * FROM branches WHERE id = ${branch.id}`;
  const tree = await branches.branchTree({ id: row!.id, isDefault: false, headSaveId: null, baseSaveId: row!.base_save_id } as never, mainId);
  assert.deepEqual(tree.files.map((f) => f.path), ["/README.md", "/src/a.ts"]);
  const list = await branches.listBranches(o, workspace);
  assert.deepEqual(list.branches.map((b) => b.name), ["main", "feature-x"]);
});

test("saving on a branch through a change set changes the branch only; history, changes and diffs show it", async () => {
  const { owner, workspace, mainId } = await setup();
  const o = actor(owner);
  const { branch } = await branches.createBranch(o, workspace, { name: "ram/try-header" });
  const applied = await onBranch(owner, workspace, branch.id, "New header", { "/README.md": "# Demo, new header\n", "/docs/new.md": "new\n", "/src/a.ts": null });
  assert.ok((applied as { saveId?: string }).saveId);
  assert.equal(await textOn(branch, mainId, "/README.md"), "# Demo, new header\n");
  assert.equal(await textOn(branch, mainId, "/src/a.ts"), undefined);
  const [mainReadme] = await sql`SELECT n.current_version FROM workspace_nodes n WHERE n.workspace_id = ${workspace} AND n.path = '/README.md'`;
  assert.equal(mainReadme!.current_version, 1, "main didn't change");
  const changes = await branches.branchChanges(o, branch.id);
  assert.deepEqual(changes.files.map((f) => [f.path, f.op]), [["/README.md", "change"], ["/docs/new.md", "add"], ["/src/a.ts", "delete"]]);
  const diff = await branches.branchFileDiff(o, branch.id, "/README.md");
  assert.equal(diff.kind, "text");
  const list = await branches.listBranches(o, workspace);
  const mine = list.branches.find((b) => b.id === branch.id)!;
  assert.deepEqual([mine.ahead, mine.changedFiles, mine.lastSave?.message], [1, 3, "New header"]);
  const history = await saves.listSaves(o, workspace, { branch: "ram/try-header" });
  assert.deepEqual(history.saves.map((s) => [s.number, s.message, s.files.changed, s.files.added, s.files.deleted]), [[1, "New header", 1, 1, 1]]);
  assert.equal((await saves.saveDiff(o, history.saves[0]!.id, "/README.md")).kind, "text");
  // Main's history has none of it.
  assert.ok(!(await saves.listSaves(o, workspace, {})).saves.some((s) => s.message === "New header"));
  // Back to main's content: the path is no longer the branch's own.
  await onBranch(owner, workspace, branch.id, "Undo the header", { "/README.md": "# Demo\n" });
  assert.deepEqual((await branches.branchChanges(o, branch.id)).files.map((f) => f.path), ["/docs/new.md", "/src/a.ts"]);
});

test("two saves from the same head: the second gets BRANCH_MOVED; a change set made before a branch change conflicts", async () => {
  const { owner, workspace } = await setup();
  const o = actor(owner);
  const { branch } = await branches.createBranch(o, workspace, { name: "race" });
  const c = await content(workspace, owner, "x\n");
  await branches.writeBranch(branch.id, { changes: [{ op: "add", path: "/x.md", contentHash: c.hash, assetId: c.assetId, size: c.size }], expectedHead: null, message: "first", authorId: owner });
  await assert.rejects(branches.writeBranch(branch.id, { changes: [{ op: "add", path: "/y.md", contentHash: c.hash, assetId: c.assetId }], expectedHead: null, message: "second", authorId: owner }), { code: "BRANCH_MOVED" });
  const set = await sets.startChangeSet(o, { workspaceId: workspace, title: "late", branchId: branch.id });
  const late = await content(workspace, owner, "late\n");
  await sets.upsertItems(o, set.id, [{ op: "change", path: "/x.md", contentHash: late.hash, size: late.size }]);
  await sets.finishChangeSet(o, set.id, {});
  const other = await content(workspace, owner, "someone else\n");
  await branches.writeBranch(branch.id, { changes: [{ op: "change", path: "/x.md", contentHash: other.hash, assetId: other.assetId }], message: "meanwhile", authorId: owner });
  await assert.rejects(sets.applyChangeSet(o, request(), set.id), { code: "CHANGE_SET_CONFLICT" });
});

test("update from main: main-only changes come in, both-sided text merges, real conflicts wait for a choice", async () => {
  const { owner, workspace, mainId } = await setup();
  const o = actor(owner);
  await addFile(workspace, owner, "/both.md", "1\n2\n3\n");
  const { branch } = await branches.createBranch(o, workspace, { name: "feature" });
  await onBranch(owner, workspace, branch.id, "Branch work", { "/src/a.ts": "a1\na2\na3\na4\na5\nA6\n", "/both.md": "1\nBRANCH\n3\n" });
  await editMain(workspace, owner, "/README.md", "# Demo on main\n");
  await editMain(workspace, owner, "/src/a.ts", "A1\na2\na3\na4\na5\na6\n");
  await editMain(workspace, owner, "/both.md", "1\nMAIN\n3\n");
  assert.equal((await branches.listBranches(o, workspace)).branches.find((b) => b.id === branch.id)!.behind, 3);
  const first = await branches.updateFromMain(o, branch.id);
  assert.deepEqual(first.conflicts, [{ path: "/both.md", kind: "edit" }]);
  assert.equal(first.save, null, "nothing changes while a conflict waits");
  const done = await branches.updateFromMain(o, branch.id, { resolutions: { "/both.md": "branch" } });
  assert.ok(done.save);
  assert.equal(await textOn(branch, mainId, "/README.md"), "# Demo on main\n");
  assert.equal(await textOn(branch, mainId, "/src/a.ts"), "A1\na2\na3\na4\na5\nA6\n", "both edits, merged");
  assert.equal(await textOn(branch, mainId, "/both.md"), "1\nBRANCH\n3\n");
  const view = (await branches.listBranches(o, workspace)).branches.find((b) => b.id === branch.id)!;
  assert.deepEqual([view.behind, view.ahead], [0, 1]);
  assert.deepEqual((await branches.updateFromMain(o, branch.id)).upToDate, true);
  // The update is a save on the branch, not on main.
  const history = await saves.listSaves(o, workspace, { branch: branch.id });
  assert.deepEqual(history.saves.map((s) => [s.kind, s.message]), [["merge", "Updated from main"], ["save", "Branch work"]]);
});

test("revert a branch save: a new save on the branch puts its files back", async () => {
  const { owner, workspace, mainId } = await setup();
  const o = actor(owner);
  const { branch } = await branches.createBranch(o, workspace, { name: "undo-me" });
  await onBranch(owner, workspace, branch.id, "Change things", { "/README.md": "# Changed\n", "/new.md": "n\n" });
  const [target] = (await saves.listSaves(o, workspace, { branch: branch.id })).saves;
  const result = await saves.revertSave(o, request(), target!.id);
  assert.equal(result.outcome, "reverted");
  assert.equal(await textOn(branch, mainId, "/README.md"), "# Demo\n");
  assert.equal(await textOn(branch, mainId, "/new.md"), undefined);
  assert.deepEqual((await branches.branchChanges(o, branch.id)).files, []);
  const [main] = await sql`SELECT count(*)::int AS n FROM saves WHERE branch_id = ${mainId}`;
  assert.equal(main!.n, 1, "main has only its start");
});

test("from another branch, rename, delete and restore; main can't be renamed; a member can't delete someone else's", async () => {
  const { owner, workspace, mainId } = await setup();
  const o = actor(owner);
  const member = await sql.begin((tx) => createUser(tx));
  await sql.begin((tx) => addMember(tx, workspace, member, "member"));
  const { branch: src } = await branches.createBranch(o, workspace, { name: "src" });
  await onBranch(owner, workspace, src.id, "On src", { "/s.md": "s\n" });
  const { branch: copy } = await branches.createBranch(o, workspace, { name: "copy", from: "src" });
  assert.equal(await textOn(copy, mainId, "/s.md"), "s\n");
  await assert.rejects(branches.renameBranch(o, mainId, "trunk"), { code: "MAIN_BRANCH" });
  await assert.rejects(branches.deleteBranch(actor(member), copy.id), { code: "FORBIDDEN" });
  await branches.renameBranch(o, copy.id, "copy-2");
  const gone = await branches.deleteBranch(o, copy.id);
  assert.equal(gone.deleted, true);
  assert.deepEqual((await branches.listBranches(o, workspace)).branches.map((b) => b.name), ["main", "src"]);
  assert.deepEqual((await branches.listBranches(o, workspace, { status: "deleted" })).branches.map((b) => b.name), ["copy-2"]);
  await assert.rejects(onBranch(owner, workspace, copy.id, "after delete", { "/z.md": "z\n" }), { code: "BRANCH_DELETED" });
  await branches.restoreBranch(o, copy.id);
  assert.deepEqual((await branches.listBranches(o, workspace)).branches.map((b) => b.name).sort(), ["copy-2", "main", "src"]);
  // Members can create and save on branches; outsiders can't see them.
  const { branch: theirs } = await branches.createBranch(actor(member), workspace, { name: "member-work" });
  assert.ok(theirs.id);
  const outsider = await sql.begin((tx) => createUser(tx));
  await assert.rejects(branches.listBranches(actor(outsider), workspace), { code: "NOT_FOUND" });
  await assert.rejects(branches.listBranchFiles(actor(outsider), theirs.id), { code: "NOT_FOUND" });
  // No probing: an outsider gets the same answer for a real branch, a deleted one and a name that doesn't exist.
  await branches.deleteBranch(o, (await branches.createBranch(o, workspace, { name: "gone" })).branch.id);
  for (const name of ["member-work", "gone", "never-was"]) await assert.rejects(branches.findBranch(actor(outsider), workspace, name), { code: "NOT_FOUND" });
});

test("speed (H25): a 5,000-file workspace; a branch's files resolve well under a second", async () => {
  const owner = await sql.begin((tx) => createUser(tx));
  const workspace = await sql.begin((tx) => createProject(tx, owner));
  await sql`INSERT INTO workspace_nodes (workspace_id, type, name, path, created_by, size, current_version, s3_key, mime_type)
    SELECT ${workspace}, 'file', 'f' || i || '.ts', '/src/m' || (i % 50) || '/f' || i || '.ts', ${owner}, 10, 1, 'k/' || i, 'text/plain' FROM generate_series(1, 5000) i`;
  const o = actor(owner);
  await saves.setBranchesEnabled(o, workspace, true);
  await unprotect(workspace);
  const { branch } = await branches.createBranch(o, workspace, { name: "big" });
  const c = await content(workspace, owner, "changed\n");
  await branches.writeBranch(branch.id, { changes: Array.from({ length: 200 }, (_, i) => ({ op: "change" as const, path: `/src/m${(i + 1) % 50}/f${i + 1}.ts`, contentHash: c.hash, assetId: c.assetId, size: c.size })), message: "200 files", authorId: owner });
  const t = Date.now();
  const page = await branches.listBranchFiles(o, branch.id);
  const ms = Date.now() - t;
  assert.equal(page.files.length, 5000);
  assert.equal(page.files.filter((f) => f.own).length, 200);
  console.log(`bench: branch files ${ms} ms`);
  assert.ok(ms < 1000, `branch files took ${ms} ms`);
});

test("routes: a token lists and creates branches, reads a branch's manifest with revisions, and starts a change set on it", async () => {
  const { owner, workspace } = await setup();
  const t = `nb_dev_${randomUUID().replace(/-/g, "")}`;
  await sql`INSERT INTO extension_device_sessions (user_id, token_hash, token_prefix, device_name, client_version, expires_at, token_type, scopes)
            VALUES (${owner}, ${sha(t)}, ${t.slice(0, 11)}, 'cli', '2.4.0', now() + interval '1 day', 'device', ${sql.json(["workspace:read", "file:read", "file:write"])})`;
  type Route = (r: Request, c?: unknown) => Promise<Response>;
  const list = await loadAppModule(() => import("../../src/app/api/v1/workspaces/[id]/branches/route")) as { GET: Route; POST: Route };
  const manifest = await loadAppModule(() => import("../../src/app/api/v1/workspaces/[id]/manifest/route")) as { GET: Route };
  const start = await loadAppModule(() => import("../../src/app/api/v1/workspaces/[id]/change-sets/route")) as { POST: Route };
  const call = async (h: Route, method: string, path: string, body?: unknown) => {
    headerValues = { authorization: `Bearer ${t}`, "x-networkbase-request-method": method, "x-networkbase-request-target": path.split("?")[0]! };
    const res = await h(new Request(`https://app.test${path}`, { method, headers: { "content-type": "application/json", "idempotency-key": randomUUID() }, ...(body ? { body: JSON.stringify(body) } : {}) }), { params: Promise.resolve({ id: workspace }) });
    return { status: res.status, json: await res.json() as any };
  };
  const made = await call(list.POST, "POST", `/api/v1/workspaces/${workspace}/branches`, { name: "via-api" });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  const id = made.json.data.branch.id;
  const c = await content(workspace, owner, "api\n");
  await branches.writeBranch(id, { changes: [{ op: "change", path: "/README.md", contentHash: c.hash, assetId: c.assetId, size: c.size }], message: "api", authorId: owner });
  const m = await call(manifest.GET, "GET", `/api/v1/workspaces/${workspace}/manifest?branch=via-api`);
  assert.equal(m.status, 200, JSON.stringify(m.json));
  const readme = m.json.data.files.find((f: any) => f.path === "/README.md");
  assert.deepEqual([readme.version, readme.contentHash], [1_000_001, c.hash]);
  assert.equal(m.json.data.files.find((f: any) => f.path === "/src/a.ts").version, 1, "main's file keeps main's version");
  assert.equal(m.json.data.branch.name, "via-api");
  const set = await call(start.POST, "POST", `/api/v1/workspaces/${workspace}/change-sets`, { title: "on a branch", branchId: id });
  assert.equal(set.status, 201, JSON.stringify(set.json));
  const [row] = await sql`SELECT branch_id FROM change_sets WHERE id = ${set.json.data.changeSet.id}`;
  assert.equal(row!.branch_id, id);
  const listed = await call(list.GET, "GET", `/api/v1/workspaces/${workspace}/branches`);
  assert.deepEqual(listed.json.data.branches.map((b: any) => b.name), ["main", "via-api"]);
});

test("H-2b: the explorer on a branch: folders with counts, folder move and delete as one save, upload through a change set", async () => {
  const { owner, workspace } = await setup();
  const o = actor(owner);
  const { branch } = await branches.createBranch(o, workspace, { name: "explore" });
  await onBranch(owner, workspace, branch.id, "docs", { "/docs/a.md": "a\n", "/docs/deep/b.md": "b\n" });
  const root = await branches.branchFolder(o, branch.id, null);
  assert.deepEqual(root.folders.map((f) => [f.name, f.files]), [["docs", 2], ["src", 1]]);
  assert.deepEqual(root.files.map((f) => f.name), ["README.md"]);
  const docs = await branches.branchFolder(o, branch.id, "docs");
  assert.deepEqual([docs.folders.map((f) => f.path), docs.files.map((f) => [f.path, f.own])], [["/docs/deep"], [["/docs/a.md", true]]]);
  await assert.rejects(branches.branchFolder(o, branch.id, "/nope"), { code: "NOT_FOUND" });
  // Move a folder: one save; into itself is refused; onto an existing path is a conflict.
  await assert.rejects(branches.moveOnBranch(o, branch.id, "/docs", "/docs/x"), { code: "BAD_PATH" });
  await assert.rejects(branches.moveOnBranch(o, branch.id, "/docs/a.md", "/README.md"), { code: "CONFLICT" });
  const moved = await branches.moveOnBranch(o, branch.id, "/docs", "/guide");
  assert.ok(moved.save);
  assert.deepEqual((await branches.branchPaths(o, branch.id)).paths, ["/README.md", "/guide/a.md", "/guide/deep/b.md", "/src/a.ts"]);
  const [s] = await sql`SELECT message, files_renamed FROM saves WHERE id = ${moved.save!.id}`;
  assert.deepEqual([s!.message, s!.files_renamed], ["Renamed docs to guide", 2]);
  const gone = await branches.deleteOnBranch(o, branch.id, "/guide");
  assert.ok(gone.save);
  assert.deepEqual((await branches.branchPaths(o, branch.id)).paths, ["/README.md", "/src/a.ts"]);
  // Upload: begin, send bytes, finish → one save on the branch; main is untouched.
  const bytes = Buffer.from("uploaded\n");
  const { changeSetId } = await branches.beginUploadOnBranch(o, branch.id, [{ path: "/up/one.txt", hash: sha(bytes), size: bytes.byteLength, mimeType: "text/plain" }]);
  await sets.putContent(o, changeSetId, { files: [{ hash: sha(bytes), base64: bytes.toString("base64") }] });
  const up = await branches.finishUploadOnBranch(o, request(), changeSetId);
  assert.ok(up.save);
  assert.equal((await branches.branchFileText(o, branch.id, "/up/one.txt")).text, "uploaded\n");
  const [onMain] = await sql`SELECT id FROM workspace_nodes WHERE workspace_id = ${workspace} AND path = '/up/one.txt'`;
  assert.equal(onMain, undefined);
});

test("H-2b: History shows lines added and removed per save and per file, worked out once", async () => {
  const { owner, workspace, mainId } = await setup();
  const o = actor(owner);
  const { branch } = await branches.createBranch(o, workspace, { name: "lines" });
  await branches.saveTextOnBranch(o, branch.id, { path: "/src/a.ts", text: "a1\na2 changed\na3\na4\na5\na6\nnew line\n", expectedHash: sha("a1\na2\na3\na4\na5\na6\n") });
  const list = await saves.listSaves(o, workspace, { branch: branch.id });
  assert.deepEqual(list.saves[0]!.lines, { added: 2, removed: 1 });
  const one = await saves.getSave(o, list.saves[0]!.id);
  assert.deepEqual(one.files.map((f) => [f.path, f.lines]), [["/src/a.ts", { added: 2, removed: 1 }]]);
  const [{ a }] = await sql`SELECT lines_added AS a FROM saves WHERE id = ${list.saves[0]!.id}`;
  assert.equal(a, 2, "kept");
  void mainId;
});

test("H-2b: the upload finish only applies an upload on a branch, never a change set on main", async () => {
  const { owner, workspace } = await setup();
  const o = actor(owner);
  const onMain = await sets.startChangeSet(o, { workspaceId: workspace, title: "main set" });
  await assert.rejects(branches.finishUploadOnBranch(o, request(), onMain.id), { code: "NOT_AVAILABLE" });
  const other = await sql.begin((tx) => createUser(tx));
  await sql.begin((tx) => addMember(tx, workspace, other, "member"));
  const { branch } = await branches.createBranch(o, workspace, { name: "uploads" });
  const bytes = Buffer.from("x\n");
  const { changeSetId } = await branches.beginUploadOnBranch(o, branch.id, [{ path: "/x.txt", hash: sha(bytes), size: 2, mimeType: "text/plain" }]);
  await assert.rejects(branches.finishUploadOnBranch(actor(other), request(), changeSetId), { code: "NOT_FOUND" }, "someone else's upload");
});

test("C14b: a file as a branch save left it: read it, use it as a new save; a save that didn't change it says so", async () => {
  const { owner, workspace, mainId } = await setup();
  const o = actor(owner);
  const { branch } = await branches.createBranch(o, workspace, { name: "feature-x" });
  await onBranch(owner, workspace, branch.id, "First", { "/README.md": "# First\n" });
  await onBranch(owner, workspace, branch.id, "Second", { "/README.md": "# Second\n", "/docs/b.md": "b\n" });
  const history = await saves.listSaves(o, workspace, { branch: branch.id, path: "/README.md" });
  assert.deepEqual(history.saves.map((s) => s.number), [2, 1], "nb file history on the branch");
  const at1 = await branches.branchFileAtSave(o, branch.id, "/README.md", 1);
  assert.equal(stored.get(at1.file.storageKey!)?.toString(), "# First\n");
  await assert.rejects(branches.branchFileAtSave(o, branch.id, "/docs/b.md", 1), { code: "NOT_FOUND" });
  const used = await branches.useSaveOnBranch(o, branch.id, { path: "/README.md", save: 1 });
  assert.equal(used.save?.number, 3);
  assert.equal(await textOn(branch, mainId, "/README.md"), "# First\n");
  assert.equal((await branches.useSaveOnBranch(o, branch.id, { path: "/README.md", save: 1 })).save, null, "already like that");
  const [main] = await sql`SELECT current_version FROM workspace_nodes WHERE workspace_id = ${workspace} AND path = '/README.md'`;
  assert.equal(main!.current_version, 1, "main is untouched");
  const outsider = await sql.begin((tx) => createUser(tx));
  await assert.rejects(branches.useSaveOnBranch(actor(outsider), branch.id, { path: "/README.md", save: 1 }));
});

test("H8, H24: saves on a branch tell its watchers (never the saver), one notification per 15 minutes, counted up", async () => {
  const { owner, workspace } = await setup();
  const sam = await sql.begin((tx) => createUser(tx));
  await sql.begin((tx) => addMember(tx, workspace, sam, "member"));
  const { branch } = await branches.createBranch(actor(owner), workspace, { name: "feature-x" });
  sent.length = 0;
  await branches.saveTextOnBranch(actor(owner), branch.id, { path: "/notes.md", text: "one\n" });
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(sent.filter((n) => n.kind === "branch_saves").length, 0, "nobody else watches it yet");
  await branches.saveTextOnBranch(actor(sam), branch.id, { path: "/notes.md", text: "two\n", expectedHash: sha("one\n") });
  await branches.saveTextOnBranch(actor(sam), branch.id, { path: "/notes.md", text: "three\n", expectedHash: sha("two\n") });
  for (let i = 0; i < 40 && sent.filter((n) => n.kind === "branch_saves").length < 2; i++) await new Promise((r) => setTimeout(r, 50));
  const toOwner = sent.filter((n) => n.kind === "branch_saves" && n.recipientUserId === owner);
  assert.equal(toOwner.length, 2);
  assert.equal(new Set(toOwner.map((n) => n.dedupeKey)).size, 1, "one notification per window, aggregated");
  assert.ok(toOwner.every((n) => n.operation === "aggregate" && /saved on feature-x/.test(n.title)));
  assert.equal(sent.filter((n) => n.recipientUserId === sam).length, 0, "the saver isn't told");
  // Someone who left isn't told about the branch any more.
  await sql`DELETE FROM workspace_members WHERE workspace_id = ${workspace} AND user_id = ${sam}`;
  sent.length = 0;
  await branches.saveTextOnBranch(actor(owner), branch.id, { path: "/notes.md", text: "four\n", expectedHash: sha("three\n") });
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(sent.filter((n) => n.recipientUserId === sam).length, 0, "a former member isn't told");
});

test("H24: an archived workspace's branches are read-only; someone removed shows as a former member", async () => {
  const { owner, workspace } = await setup();
  const sam = await sql.begin((tx) => createUser(tx));
  await sql.begin((tx) => addMember(tx, workspace, sam, "member"));
  const { branch } = await branches.createBranch(actor(sam), workspace, { name: "sam/idea" });
  await sql`DELETE FROM workspace_members WHERE workspace_id = ${workspace} AND user_id = ${sam}`;
  const list = await branches.listBranches(actor(owner), workspace);
  assert.equal(list.branches.find((b) => b.id === branch.id)?.createdBy?.former, true, "former member");
  await sql`UPDATE workspaces SET status = 'archived' WHERE id = ${workspace}`;
  await assert.rejects(branches.saveTextOnBranch(actor(owner), branch.id, { path: "/a.md", text: "x" }), /archived, so its branches and merge requests are read-only/);
  await assert.rejects(branches.createBranch(actor(owner), workspace, { name: "late" }));
  assert.ok((await branches.listBranches(actor(owner), workspace)).branches.length >= 2, "still readable");
});

test("H15: 500 active branches per workspace; an agent sign-in works on at most 10", async () => {
  const { owner, workspace } = await setup();
  const o = actor(owner);
  await sql`INSERT INTO branches (workspace_id, name, created_by) SELECT ${workspace}, 'bulk/' || i, ${owner} FROM generate_series(1, 500) i`;
  await assert.rejects(branches.createBranch(o, workspace, { name: "one-more" }), { code: "BRANCH_LIMIT" });
  await sql`UPDATE branches SET status = 'merged' WHERE workspace_id = ${workspace} AND name LIKE 'bulk/%'`;
  assert.ok((await branches.createBranch(o, workspace, { name: "one-more" })).branch.id, "merged ones don't count");
  // An agent sign-in: its change sets went to 10 active branches already.
  const [session] = await sql`INSERT INTO extension_device_sessions (user_id, token_hash, token_prefix, device_name, client_version, expires_at, token_type, agent_name, workspace_id)
    VALUES (${owner}, ${randomUUID()}, 'nb_agt_x', 'agent', '2.6.0', now() + interval '1 day', 'agent', 'Claude Code', ${workspace}) RETURNING id`;
  for (let i = 0; i < 10; i++) {
    const { branch } = await branches.createBranch(o, workspace, { name: `agent/${i}` });
    await sql`INSERT INTO change_sets (workspace_id, author_id, title, branch_id, agent_session_id, via, status) VALUES (${workspace}, ${owner}, 'x', ${branch.id}, ${session!.id}, 'agent', 'applied')`;
  }
  const agent = { user: { id: owner }, tokenKind: "agent" as const, extensionSessionId: session!.id as string };
  await assert.rejects(branches.createBranch(agent, workspace, { name: "agent/11" }), { code: "BRANCH_LIMIT" });
  assert.ok((await branches.createBranch(o, workspace, { name: "person-still-can" })).branch.id, "people aren't held by the agent limit");
});

test("H2, H23, H26: the daily sweep deletes merged branches after 7 days, drops deleted ones' files after 30, asks once after 90 quiet days", async () => {
  const { owner, workspace } = await setup();
  const o = actor(owner);
  const merged = (await branches.createBranch(o, workspace, { name: "merged-old" })).branch;
  const recent = (await branches.createBranch(o, workspace, { name: "merged-new" })).branch;
  const gone = (await branches.createBranch(o, workspace, { name: "deleted-long-ago" })).branch;
  await branches.saveTextOnBranch(o, gone.id, { path: "/gone.md", text: "gone\n" });
  const quiet = (await branches.createBranch(o, workspace, { name: "quiet" })).branch;
  await sql`UPDATE branches SET status = 'merged', updated_at = now() - interval '8 days' WHERE id = ${merged.id}`;
  await sql`UPDATE branches SET status = 'merged', updated_at = now() - interval '2 days' WHERE id = ${recent.id}`;
  await sql`UPDATE branches SET status = 'deleted', deleted_at = now() - interval '31 days' WHERE id = ${gone.id}`;
  await sql`UPDATE branches SET created_at = now() - interval '91 days' WHERE id = ${quiet.id}`;
  sent.length = 0;
  await branches.sweepBranches();
  const status = async (id: string) => (await sql`SELECT status FROM branches WHERE id = ${id}`)[0]!.status;
  assert.equal(await status(merged.id), "deleted");
  assert.equal(await status(recent.id), "merged");
  assert.equal((await sql`SELECT count(*)::int AS n FROM branch_files WHERE branch_id = ${gone.id}`)[0]!.n, 0);
  assert.equal((await sql`SELECT count(*)::int AS n FROM save_changes sc JOIN saves s ON s.id = sc.save_id WHERE s.branch_id = ${gone.id}`)[0]!.n, 1, "its history stays");
  const notes = sent.filter((n) => n.dedupeKey === `branch-stale:${quiet.id}`);
  assert.equal(notes.length, 1);
  assert.match(notes[0]!.title, /Archive or keep quiet\?/);
  assert.equal(await status(quiet.id), "active", "nothing is deleted for being quiet");
});

test("H15, H23 journey 7: organizations and their workspaces (team workspaces, students' assignment copies) can't turn branches on", async () => {
  const owner = await sql.begin((tx) => createUser(tx));
  const org = await sql.begin((tx) => createProject(tx, owner));
  await sql`UPDATE workspaces SET kind = 'organization' WHERE id = ${org}`;
  const copy = await sql.begin((tx) => createProject(tx, owner));
  await sql`UPDATE workspaces SET parent_id = ${org} WHERE id = ${copy}`;
  await assert.rejects(saves.setBranchesEnabled(actor(owner), org, true), { code: "BRANCHES_OFF" });
  await assert.rejects(saves.setBranchesEnabled(actor(owner), copy, true), { code: "BRANCHES_OFF" });
  await assert.rejects(branches.createBranch(actor(owner), copy, { name: "try" }), { code: "BRANCHES_OFF" });
});

test("speed (H25, H11): 500 branches list fast for the picker; a branch's files come from memory until its head moves", async () => {
  const { owner, workspace, mainId } = await setup();
  const o = actor(owner);
  await sql`INSERT INTO branches (workspace_id, name, created_by) SELECT ${workspace}, 'many/' || i, ${owner} FROM generate_series(1, 499) i`;
  let t = performance.now();
  const list = await branches.listBranches(o, workspace);
  const listMs = Math.round(performance.now() - t);
  assert.equal(list.branches.length, 500);
  const { branch } = await branches.createBranch(o, workspace, { name: "cached" }).catch(async () => {
    await sql`DELETE FROM branches WHERE workspace_id = ${workspace} AND name = 'many/499'`;
    return branches.createBranch(o, workspace, { name: "cached" });
  });
  const [row] = await sql`SELECT * FROM branches WHERE id = ${branch.id}`;
  const b = { id: row!.id, isDefault: false, headSaveId: row!.head_save_id, baseSaveId: row!.base_save_id } as never;
  const first = await branches.branchTree(b, mainId);
  t = performance.now();
  const again = await branches.branchTree(b, mainId);
  const cachedMs = performance.now() - t;
  console.log(`bench: 500 branches listed in ${listMs} ms; cached branch files ${cachedMs.toFixed(2)} ms`);
  assert.equal(again, first, "the same page object, from memory");
  assert.ok(listMs < 1500, `listing 500 branches took ${listMs} ms`);
  await branches.saveTextOnBranch(o, branch.id, { path: "/new.md", text: "n\n" });
  const [moved] = await sql`SELECT head_save_id FROM branches WHERE id = ${branch.id}`;
  const after = await branches.branchTree({ ...(b as object), headSaveId: moved!.head_save_id } as never, mainId);
  assert.ok(after.files.some((f) => f.path === "/new.md"), "a new head reads fresh");
});

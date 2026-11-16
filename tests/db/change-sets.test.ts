import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// Report Part G (M5): a change set collects a multi-file job, applies it all at once or not at all, and undoes it
// in one step; a teammate's newer save is never overwritten; agents need the person's yes for big ones.
let headerValues: Record<string, string> = {};
moduleStubs.set("next/headers", { headers: async () => ({ get: (name: string) => headerValues[name.toLowerCase()] ?? null }), cookies: async () => ({ getAll: () => [], get: () => undefined, set: () => undefined }) });
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("@/lib/security/csrf", { validateCsrf: () => null });
/** Storage in memory. */
const stored = new Map<string, Buffer>();
moduleStubs.set("@/lib/supabase/server", {
  createAdminClient: async () => ({ storage: { from: () => ({
    upload: async (key: string, body: Buffer) => { stored.set(key, Buffer.from(body)); return { error: null }; },
    download: async (key: string) => (stored.has(key) ? { data: new Blob([stored.get(key)!]), error: null } : { data: null, error: new Error("not found") }),
    remove: async (keys: string[]) => { for (const k of keys) stored.delete(k); return { error: null }; },
    createSignedUploadUrl: async (key: string) => ({ data: { signedUrl: `https://storage.test/${key}`, token: "t" }, error: null }),
  }) } }),
});

type Route = (r: Request, c?: any) => Promise<Response>;
let ws: { POST: Route; GET: Route };
let one: { GET: Route };
let items: { PUT: Route; DELETE: Route };
let content: { POST: Route };
let finish: { POST: Route };
let apply: { POST: Route };
let discard: { POST: Route };
let undo: { POST: Route };
let copy: { POST: Route };
let undoToken: { POST: Route };
let update: { POST: Route };
let resolve: { POST: Route };
before(async () => {
  ws = await loadAppModule(() => import("../../src/app/api/v1/workspaces/[id]/change-sets/route"));
  one = await loadAppModule(() => import("../../src/app/api/v1/change-sets/[cs]/route"));
  items = await loadAppModule(() => import("../../src/app/api/v1/change-sets/[cs]/items/route"));
  content = await loadAppModule(() => import("../../src/app/api/v1/change-sets/[cs]/content/route"));
  finish = await loadAppModule(() => import("../../src/app/api/v1/change-sets/[cs]/finish/route"));
  apply = await loadAppModule(() => import("../../src/app/api/v1/change-sets/[cs]/apply/route"));
  discard = await loadAppModule(() => import("../../src/app/api/v1/change-sets/[cs]/discard/route"));
  undo = await loadAppModule(() => import("../../src/app/api/v1/change-sets/[cs]/undo/route"));
  copy = await loadAppModule(() => import("../../src/app/api/v1/change-sets/[cs]/copy/route"));
  undoToken = await loadAppModule(() => import("../../src/app/api/v1/undo/[id]/route"));
  update = await loadAppModule(() => import("../../src/app/api/v1/change-sets/[cs]/update/route"));
  resolve = await loadAppModule(() => import("../../src/app/api/v1/change-sets/[cs]/resolve/route"));
});
after(async () => { await sql.end(); await closeAppDb(); });

const sha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
async function token(userId: string, kind: "device" | "agent", workspaceId: string | null, scopes: string[] = []) {
  const t = `nb_${kind === "agent" ? "agt" : "dev"}_${randomUUID().replace(/-/g, "")}`;
  await sql`INSERT INTO extension_device_sessions (user_id, token_hash, token_prefix, device_name, client_version, expires_at, token_type, agent_name, workspace_id, scopes)
            VALUES (${userId}, ${sha(t)}, ${t.slice(0, 11)}, 'laptop', '2.2.0', now() + interval '1 day', ${kind}, ${kind === "agent" ? "Claude Code" : null}, ${workspaceId}, ${sql.json(scopes)})`;
  return t;
}
async function call(handler: Route, t: string, method: string, path: string, body?: unknown, ctx?: unknown, extra: Record<string, string> = {}) {
  headerValues = { authorization: `Bearer ${t}`, "x-networkbase-request-method": method, "x-networkbase-request-target": path };
  const res = await handler(new Request(`https://app.test${path}`, { method, headers: { "content-type": "application/json", "idempotency-key": randomUUID(), ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), ctx);
  return { status: res.status, json: await res.json() as any };
}
const csCtx = (cs: string) => ({ params: Promise.resolve({ cs }) });

/** A workspace with change sets on, its owner's CLI token, and files a.txt, b.txt, c.txt, d.txt at v1. */
async function setup(files = ["a", "b", "c", "d"]) {
  const owner = await sql.begin((tx) => createUser(tx));
  const workspace = await sql.begin((tx) => createProject(tx, owner));
  await sql`UPDATE workspaces SET change_sets_enabled = true WHERE id = ${workspace}`;
  for (const f of files) await addVersion(workspace, owner, `/${f}.txt`, `${f} one\n`);
  return { owner, workspace, cli: await token(owner, "device", null) };
}
/** Saves `text` as the next version of `path` (creating the file), as a teammate's save would. */
async function addVersion(workspace: string, userId: string, path: string, text: string) {
  const bytes = Buffer.from(text);
  const key = `${workspace}/test/${sha(bytes)}-${randomUUID()}`;
  stored.set(key, bytes);
  const [asset] = await sql`INSERT INTO storage_assets (owner_user_id, workspace_id, bucket, storage_key, purpose, state, declared_mime_type, declared_size, content_hash, expires_at, verified_at, verified_size, verified_mime_type)
    VALUES (${userId}, ${workspace}, 'project-files', ${key}, 'workspace_file:file', 'verified', 'text/plain', ${bytes.byteLength}, ${sha(bytes)}, now(), now(), ${bytes.byteLength}, 'text/plain') RETURNING id`;
  let [node] = await sql`SELECT id, current_version FROM workspace_nodes WHERE workspace_id = ${workspace} AND path = ${path} AND deleted_at IS NULL`;
  if (!node) [node] = await sql`INSERT INTO workspace_nodes (workspace_id, type, name, path, created_by, size, current_version) VALUES (${workspace}, 'file', ${path.split("/").pop()!}, ${path}, ${userId}, 0, 0) RETURNING id, current_version`;
  const version = Number(node!.current_version) + 1;
  await sql`INSERT INTO file_versions (node_id, version, s3_key, asset_id, size, mime_type, content_hash, uploaded_by) VALUES (${node!.id}, ${version}, ${key}, ${asset!.id}, ${bytes.byteLength}, 'text/plain', ${sha(bytes)}, ${userId})`;
  await sql`UPDATE workspace_nodes SET current_version = ${version}, s3_key = ${key}, asset_id = ${asset!.id}, size = ${bytes.byteLength} WHERE id = ${node!.id}`;
  return { nodeId: node!.id as string, version };
}
const fileState = async (workspace: string) => Object.fromEntries((await sql`SELECT path, current_version, deleted_at FROM workspace_nodes WHERE workspace_id = ${workspace} AND type = 'file' ORDER BY path`)
  .map((r) => [r.path, r.deleted_at ? "trash" : `v${r.current_version}`]));
const textOf = async (workspace: string, path: string) => {
  const [n] = await sql`SELECT s3_key FROM workspace_nodes WHERE workspace_id = ${workspace} AND path = ${path} AND deleted_at IS NULL`;
  return n ? stored.get(n.s3_key)?.toString() : undefined;
};

/** Start, add items, upload what's missing, finish. */
async function draft(t: string, workspace: string, list: Array<{ op: string; path: string; fromPath?: string; text?: string }>, title = "Redesign sign-in") {
  const started = await call(ws.POST, t, "POST", `/api/v1/workspaces/${workspace}/change-sets`, { title }, { params: Promise.resolve({ id: workspace }) });
  assert.equal(started.status, 201, JSON.stringify(started.json));
  const cs = started.json.data.changeSet.id as string;
  const put = await call(items.PUT, t, "PUT", `/api/v1/change-sets/${cs}/items`, {
    items: list.map((i) => ({ op: i.op, path: i.path, fromPath: i.fromPath, ...(i.text != null ? { contentHash: sha(i.text), size: Buffer.byteLength(i.text), mimeType: "text/plain" } : {}) })),
  }, csCtx(cs));
  assert.equal(put.status, 200, JSON.stringify(put.json));
  const files = list.filter((i) => i.text != null && put.json.data.missingContent.includes(sha(i.text!))).map((i) => ({ hash: sha(i.text!), base64: Buffer.from(i.text!).toString("base64") }));
  if (files.length) {
    const up = await call(content.POST, t, "POST", `/api/v1/change-sets/${cs}/content`, { files }, csCtx(cs));
    assert.equal(up.status, 200, JSON.stringify(up.json));
  }
  return { cs, put: put.json.data };
}
const finishIt = (t: string, cs: string, body: unknown = {}) => call(finish.POST, t, "POST", `/api/v1/change-sets/${cs}/finish`, body, csCtx(cs));
const applyIt = (t: string, cs: string, body: unknown = {}) => call(apply.POST, t, "POST", `/api/v1/change-sets/${cs}/apply`, body, csCtx(cs));
const undoIt = (t: string, cs: string, body: unknown = {}) => call(undo.POST, t, "POST", `/api/v1/change-sets/${cs}/undo`, body, csCtx(cs));

test("off by default: a workspace without the flag refuses new change sets", async () => {
  const { workspace, cli } = await setup([]);
  await sql`UPDATE workspaces SET change_sets_enabled = false WHERE id = ${workspace}`;
  const res = await call(ws.POST, cli, "POST", `/api/v1/workspaces/${workspace}/change-sets`, { title: "x" }, { params: Promise.resolve({ id: workspace }) });
  assert.equal(res.status, 403);
  assert.equal(res.json.errorCode, "CHANGE_SETS_OFF");
});

test("add, change, delete and rename apply together as one set of versions, and one undo puts every file back", async () => {
  const { workspace, cli } = await setup();
  const { cs, put } = await draft(cli, workspace, [
    { op: "add", path: "/new/page.tsx", text: "export default 1\n" },
    { op: "change", path: "/b.txt", text: "b two\n" },
    { op: "delete", path: "/c.txt" },
    { op: "rename", path: "/moved/d.txt", fromPath: "/d.txt" },
    { op: "change", path: "/a.txt", text: "a one\n" }, // back to its base: dropped
  ]);
  assert.equal(put.items.length, 4, "the unchanged file isn't an item");
  const done = await finishIt(cli, cs);
  assert.equal(done.status, 200, JSON.stringify(done.json));
  assert.equal(done.json.data.changeSet.status, "ready");
  assert.match(done.json.data.summary, /Redesign sign-in: 4 files \(1 added, 1 changed, 1 deleted, 1 renamed\), \+2 −1/);

  const applied = await applyIt(cli, cs);
  assert.equal(applied.status, 200, JSON.stringify(applied.json));
  assert.deepEqual(await fileState(workspace), { "/a.txt": "v1", "/b.txt": "v2", "/c.txt": "trash", "/moved/d.txt": "v1", "/new/page.tsx": "v1" });
  assert.equal(await textOf(workspace, "/b.txt"), "b two\n");
  const [v] = await sql`SELECT count(*)::int AS n FROM file_versions WHERE change_set_id = ${cs}`;
  assert.equal(v!.n, 2, "the add and the change made versions that point back to the set");
  const [folder] = await sql`SELECT id FROM workspace_nodes WHERE workspace_id = ${workspace} AND path = '/moved' AND type = 'folder'`;
  assert.ok(folder, "the rename made its folder");

  const again = await applyIt(cli, cs);
  assert.equal(again.status, 200);
  assert.deepEqual(again.json.data.applied, applied.json.data.applied, "a repeated apply returns the stored result");

  const undone = await undoIt(cli, cs);
  assert.equal(undone.status, 200, JSON.stringify(undone.json));
  assert.deepEqual(await fileState(workspace), { "/a.txt": "v1", "/b.txt": "v1", "/c.txt": "v1", "/d.txt": "v1", "/new/page.tsx": "trash" });
  assert.equal(await textOf(workspace, "/b.txt"), "b one\n");
  assert.equal(undone.json.data.changeSet.status, "undone");
});

test("content the workspace already has is never uploaded again", async () => {
  const { workspace, cli } = await setup();
  const { put } = await draft(cli, workspace, [{ op: "add", path: "/copy-of-a.txt", text: "a one\n" }]);
  assert.deepEqual(put.missingContent, []);
  assert.equal(put.items[0].state, "ready");
});

test("a new item makes a ready set open again, and finishing waits for every upload", async () => {
  const { workspace, cli } = await setup();
  const { cs } = await draft(cli, workspace, [{ op: "change", path: "/a.txt", text: "a two\n" }]);
  assert.equal((await finishIt(cli, cs)).status, 200);
  await call(items.PUT, cli, "PUT", `/api/v1/change-sets/${cs}/items`, { items: [{ op: "change", path: "/b.txt", contentHash: sha("b brand new\n"), size: 12, mimeType: "text/plain" }] }, csCtx(cs));
  const [row] = await sql`SELECT status FROM change_sets WHERE id = ${cs}`;
  assert.equal(row!.status, "open");
  const early = await finishIt(cli, cs);
  assert.equal(early.status, 409);
  assert.equal(early.json.errorCode, "CONTENT_MISSING");
  assert.equal(early.json.details.missing[0].path, "/b.txt");
});

test("a teammate's save since the base is a conflict, never an overwrite; nothing is written", async () => {
  const { owner, workspace, cli } = await setup();
  const { cs } = await draft(cli, workspace, [{ op: "change", path: "/a.txt", text: "mine\n" }, { op: "change", path: "/b.txt", text: "mine too\n" }]);
  assert.equal((await finishIt(cli, cs)).status, 200);
  await addVersion(workspace, owner, "/b.txt", "theirs\n"); // the same line as "mine too": can't merge
  const res = await applyIt(cli, cs);
  assert.equal(res.status, 409);
  assert.equal(res.json.errorCode, "CHANGE_SET_CONFLICT");
  assert.deepEqual(res.json.details.conflicts.map((c: { path: string; kind: string }) => [c.path, c.kind]), [["/b.txt", "edit"]]);
  assert.deepEqual(await fileState(workspace), { "/a.txt": "v1", "/b.txt": "v2", "/c.txt": "v1", "/d.txt": "v1" });
  assert.equal(await textOf(workspace, "/b.txt"), "theirs\n");
});

test("a failure part-way through apply writes nothing, and the set stays ready to retry", async () => {
  const { workspace, cli } = await setup();
  const { cs } = await draft(cli, workspace, [{ op: "change", path: "/a.txt", text: "a new\n" }, { op: "change", path: "/b.txt", text: "b new\n" }]);
  assert.equal((await finishIt(cli, cs)).status, 200);
  // The second file's content vanishes after finish: its write fails inside the transaction.
  await sql`UPDATE change_set_items SET asset_id = NULL WHERE change_set_id = ${cs} AND path = '/b.txt'`;
  const res = await applyIt(cli, cs);
  assert.equal(res.status, 409);
  assert.equal(res.json.errorCode, "CONTENT_MISSING");
  assert.deepEqual(await fileState(workspace), { "/a.txt": "v1", "/b.txt": "v1", "/c.txt": "v1", "/d.txt": "v1" });
  const [row] = await sql`SELECT status FROM change_sets WHERE id = ${cs}`;
  assert.equal(row!.status, "ready");
  const [v] = await sql`SELECT count(*)::int AS n FROM file_versions WHERE change_set_id = ${cs}`;
  assert.equal(v!.n, 0);
});

test("undo is refused when a file changed since, and partial undoes the others", async () => {
  const { owner, workspace, cli } = await setup();
  const { cs } = await draft(cli, workspace, [{ op: "change", path: "/a.txt", text: "a new\n" }, { op: "change", path: "/b.txt", text: "b new\n" }]);
  await finishIt(cli, cs);
  assert.equal((await applyIt(cli, cs)).status, 200);
  await addVersion(workspace, owner, "/b.txt", "edited after\n");
  const blocked = await undoIt(cli, cs);
  assert.equal(blocked.status, 409);
  assert.equal(blocked.json.errorCode, "UNDO_BLOCKED");
  assert.deepEqual(blocked.json.details.blocked.map((b: { path: string }) => b.path), ["/b.txt"]);
  const partial = await undoIt(cli, cs, { partial: true });
  assert.equal(partial.status, 200, JSON.stringify(partial.json));
  assert.deepEqual(partial.json.data.undone, ["/a.txt"]);
  assert.equal(await textOf(workspace, "/a.txt"), "a one\n");
  assert.equal(await textOf(workspace, "/b.txt"), "edited after\n");
});

test("two applies on the same file at once: one lands, the other reports the conflict", async () => {
  const { workspace, cli } = await setup();
  const first = await draft(cli, workspace, [{ op: "change", path: "/a.txt", text: "first\n" }, { op: "change", path: "/b.txt", text: "first b\n" }], "First");
  const second = await draft(cli, workspace, [{ op: "change", path: "/b.txt", text: "second b\n" }, { op: "change", path: "/a.txt", text: "second\n" }], "Second");
  await finishIt(cli, first.cs);
  await finishIt(cli, second.cs);
  const results = await Promise.all([applyIt(cli, first.cs), applyIt(cli, second.cs)]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409], JSON.stringify(results.map((r) => r.json.errorCode)));
  const [n] = await sql`SELECT count(*)::int AS n FROM file_versions v JOIN workspace_nodes w ON w.id = v.node_id WHERE w.workspace_id = ${workspace} AND w.path = '/a.txt'`;
  assert.equal(n!.n, 2, "exactly one apply wrote a.txt");
});

test("paths: .., Windows-reserved names and never-synced folders are refused", async () => {
  const { workspace, cli } = await setup([]);
  const started = await call(ws.POST, cli, "POST", `/api/v1/workspaces/${workspace}/change-sets`, { title: "t" }, { params: Promise.resolve({ id: workspace }) });
  const cs = started.json.data.changeSet.id;
  for (const path of ["/../etc/passwd", "/CON.txt", "/.git/config", "/a/aux"]) {
    const res = await call(items.PUT, cli, "PUT", `/api/v1/change-sets/${cs}/items`, { items: [{ op: "add", path, contentHash: sha("x"), size: 1 }] }, csCtx(cs));
    assert.equal(res.json.errorCode, "BAD_PATH", path);
  }
});

test("at most 10 open change sets per person per workspace", async () => {
  const { owner, workspace, cli } = await setup([]);
  for (let i = 0; i < 10; i += 1) await sql`INSERT INTO change_sets (workspace_id, author_id, title) VALUES (${workspace}, ${owner}, ${`s${i}`})`;
  const res = await call(ws.POST, cli, "POST", `/api/v1/workspaces/${workspace}/change-sets`, { title: "one more" }, { params: Promise.resolve({ id: workspace }) });
  assert.equal(res.status, 409);
  assert.equal(res.json.errorCode, "CHANGE_SET_LIMIT");
});

test("a key in a file is never stored: agents can't confirm it, people can", async () => {
  const { owner, workspace, cli } = await setup([]);
  const secret = "aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY1\nAKIAIOSFODNN7EXAMPLE\n";
  const b64 = Buffer.from(secret).toString("base64");
  const agent = await token(owner, "agent", workspace, ["file:read", "file:write"]);
  const a = await draft(agent, workspace, [{ op: "add", path: "/config.txt", text: secret }]);
  const sent = await call(content.POST, agent, "POST", `/api/v1/change-sets/${a.cs}/content`, { files: [{ hash: sha(secret), base64: b64 }], confirmSecrets: true }, csCtx(a.cs));
  assert.equal(sent.json.data.held.length, 1, "agents can't confirm");
  assert.ok(![...stored.keys()].some((k) => k.endsWith(sha(secret))), "the bytes were never stored");
  assert.equal((await finishIt(agent, a.cs)).json.errorCode, "CONTENT_MISSING");
  const p = await draft(cli, workspace, [{ op: "add", path: "/config2.txt", text: secret }]);
  assert.equal((await finishIt(cli, p.cs)).json.errorCode, "CONTENT_MISSING", "held for people too until they confirm");
  const ok = await call(content.POST, cli, "POST", `/api/v1/change-sets/${p.cs}/content`, { files: [{ hash: sha(secret), base64: b64 }], confirmSecrets: true }, csCtx(p.cs));
  assert.deepEqual(ok.json.data.stored, [sha(secret)]);
  assert.equal((await finishIt(cli, p.cs)).json.errorCode, "SECRET_DETECTED");
  assert.equal((await finishIt(cli, p.cs, { confirmSecrets: true })).status, 200);
});

test("an agent applies a small set with an undo token; a big one waits for the person's yes, bound to its items", async () => {
  const { owner, workspace } = await setup();
  const agent = await token(owner, "agent", workspace, ["file:read", "file:write"]);
  const small = await draft(agent, workspace, [{ op: "change", path: "/a.txt", text: "agent a\n" }]);
  const finished = await finishIt(agent, small.cs);
  assert.equal(finished.json.data.decision, "apply_now");
  const applied = await applyIt(agent, small.cs);
  assert.equal(applied.status, 200, JSON.stringify(applied.json));
  assert.ok(applied.json.data.undoToken);
  const undone = await call(undoToken.POST, agent, "POST", `/api/v1/undo/${applied.json.data.undoToken}`, {}, { params: Promise.resolve({ id: applied.json.data.undoToken }) });
  assert.equal(undone.status, 200, JSON.stringify(undone.json));
  assert.equal(await textOf(workspace, "/a.txt"), "a one\n");

  const big = await draft(agent, workspace, [{ op: "delete", path: "/c.txt" }]);
  const bigFinish = await finishIt(agent, big.cs);
  assert.equal(bigFinish.json.data.decision, "needs_confirmation");
  const confirmToken = bigFinish.json.data.confirmToken;
  assert.ok(confirmToken);
  const held = await applyIt(agent, big.cs);
  assert.equal(held.status, 428);
  // The yes covers exactly these items: adding one more needs a new yes.
  await call(items.PUT, agent, "PUT", `/api/v1/change-sets/${big.cs}/items`, { items: [{ op: "delete", path: "/d.txt" }] }, csCtx(big.cs));
  await finishIt(agent, big.cs);
  assert.equal((await applyIt(agent, big.cs, { confirmToken })).status, 428);
  const fresh = (await finishIt(agent, big.cs)).json.data.confirmToken;
  const ok = await applyIt(agent, big.cs, { confirmToken: fresh });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.deepEqual(await fileState(workspace), { "/a.txt": "v1", "/b.txt": "v1", "/c.txt": "trash", "/d.txt": "trash" });
});

test("a read-only agent can't start a change set; agents can't touch other people's sets", async () => {
  const { owner, workspace, cli } = await setup();
  const reader = await token(owner, "agent", workspace, ["file:read"]);
  const res = await call(ws.POST, reader, "POST", `/api/v1/workspaces/${workspace}/change-sets`, { title: "nope" }, { params: Promise.resolve({ id: workspace }) });
  assert.equal(res.status, 403);
  const teammate = await sql.begin((tx) => createUser(tx));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${workspace}, ${teammate}, 'member')`;
  const theirs = await draft(await token(teammate, "device", null), workspace, [{ op: "change", path: "/a.txt", text: "teammate\n" }]);
  const agent = await token(owner, "agent", workspace, ["file:read", "file:write"]);
  assert.equal((await call(discard.POST, agent, "POST", `/api/v1/change-sets/${theirs.cs}/discard`, {}, csCtx(theirs.cs))).status, 403, "an agent never acts on someone else's set");
  assert.equal((await call(discard.POST, cli, "POST", `/api/v1/change-sets/${theirs.cs}/discard`, {}, csCtx(theirs.cs))).status, 200, "the owner can discard it");
});

test("paused agents can't add to or apply a change set", async () => {
  const { owner, workspace } = await setup();
  const agent = await token(owner, "agent", workspace, ["file:read", "file:write"]);
  const { cs } = await draft(agent, workspace, [{ op: "change", path: "/a.txt", text: "x\n" }]);
  await finishIt(agent, cs);
  await sql`UPDATE workspaces SET agents_paused_at = now() WHERE id = ${workspace}`;
  const res = await applyIt(agent, cs);
  assert.equal(res.status, 403);
  assert.equal(res.json.errorCode, "AGENTS_PAUSED");
});

test("apply only some files: the chosen ones apply as their own set, the rest stay a draft", async () => {
  const { workspace, cli } = await setup();
  const { cs } = await draft(cli, workspace, [{ op: "change", path: "/a.txt", text: "safe\n" }, { op: "change", path: "/b.txt", text: "later\n" }]);
  await finishIt(cli, cs);
  const res = await applyIt(cli, cs, { only: ["/a.txt"] });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.notEqual(res.json.data.changeSet.id, cs);
  assert.deepEqual(await fileState(workspace), { "/a.txt": "v2", "/b.txt": "v1", "/c.txt": "v1", "/d.txt": "v1" });
  const rest = await call(one.GET, cli, "GET", `/api/v1/change-sets/${cs}`, undefined, csCtx(cs));
  assert.deepEqual(rest.json.data.items.map((i: { path: string }) => i.path), ["/b.txt"]);
});

test("discard, then Copy as new draft brings the same files back as a new open set", async () => {
  const { workspace, cli } = await setup();
  const { cs } = await draft(cli, workspace, [{ op: "change", path: "/a.txt", text: "idea\n" }]);
  assert.equal((await call(discard.POST, cli, "POST", `/api/v1/change-sets/${cs}/discard`, {}, csCtx(cs))).status, 200);
  const copied = await call(copy.POST, cli, "POST", `/api/v1/change-sets/${cs}/copy`, {}, csCtx(cs));
  assert.equal(copied.status, 201, JSON.stringify(copied.json));
  const view = await call(one.GET, cli, "GET", `/api/v1/change-sets/${copied.json.data.changeSet.id}`, undefined, csCtx(copied.json.data.changeSet.id));
  assert.deepEqual(view.json.data.items.map((i: { path: string; state: string }) => [i.path, i.state]), [["/a.txt", "ready"]]);
  const list = await call(ws.GET, cli, "GET", `/api/v1/workspaces/${workspace}/change-sets?status=open`, undefined, { params: Promise.resolve({ id: workspace }) });
  assert.equal(list.json.data.changeSets.length, 1);
});

test("sizes come from the uploaded bytes, not the declared size; only people split a finished set", async () => {
  const { owner, workspace, cli } = await setup([]);
  const started = await call(ws.POST, cli, "POST", `/api/v1/workspaces/${workspace}/change-sets`, { title: "sizes" }, { params: Promise.resolve({ id: workspace }) });
  const cs = started.json.data.changeSet.id;
  const text = "twelve bytes";
  await call(items.PUT, cli, "PUT", `/api/v1/change-sets/${cs}/items`, { items: [{ op: "add", path: "/x.txt", contentHash: sha(text), size: 1, mimeType: "text/plain" }] }, csCtx(cs));
  await call(content.POST, cli, "POST", `/api/v1/change-sets/${cs}/content`, { files: [{ hash: sha(text), base64: Buffer.from(text).toString("base64") }] }, csCtx(cs));
  const [row] = await sql`SELECT i.size, s.bytes FROM change_set_items i JOIN change_sets s ON s.id = i.change_set_id WHERE i.change_set_id = ${cs}`;
  assert.equal(Number(row!.size), 12);
  assert.equal(Number(row!.bytes), 12);
  const open = await applyIt(cli, cs, { only: ["/x.txt"] });
  assert.equal(open.json.errorCode, "CHANGE_SET_NOT_READY", "an unfinished set can't be split into a ready one");
  await finishIt(cli, cs);
  const agent = await token(owner, "agent", workspace, ["file:read", "file:write"]);
  assert.equal((await applyIt(agent, cs, { only: ["/x.txt"] })).status, 403);
});

test("large uploads: wrong bytes are refused and removed; content already stored is never touched", async () => {
  const { workspace, cli } = await setup(["a"]);
  const started = await call(ws.POST, cli, "POST", `/api/v1/workspaces/${workspace}/change-sets`, { title: "large" }, { params: Promise.resolve({ id: workspace }) });
  const cs = started.json.data.changeSet.id;
  const text = "a big file\n";
  await call(items.PUT, cli, "PUT", `/api/v1/change-sets/${cs}/items`, { items: [{ op: "add", path: "/big.bin", contentHash: sha(text), size: text.length }] }, csCtx(cs));
  const first = await call(content.POST, cli, "POST", `/api/v1/change-sets/${cs}/content`, { hash: sha(text) }, csCtx(cs));
  assert.ok(first.json.data.upload.url, "a signed upload URL for the large file");
  const key = `${workspace}/.changes/${sha(text)}`;
  stored.set(key, Buffer.from("not the same bytes"));
  const bad = await call(content.POST, cli, "POST", `/api/v1/change-sets/${cs}/content`, { hash: sha(text) }, csCtx(cs));
  assert.equal(bad.json.errorCode, "CONTENT_HASH_MISMATCH");
  assert.ok(!stored.has(key), "the wrong upload is gone");
  stored.set(key, Buffer.from(text));
  assert.equal((await call(content.POST, cli, "POST", `/api/v1/change-sets/${cs}/content`, { hash: sha(text) }, csCtx(cs))).status, 200);
  // Verified now: a later wrong upload over the key isn't read, checked or removed.
  stored.set(key, Buffer.from("tampered"));
  await call(items.PUT, cli, "PUT", `/api/v1/change-sets/${cs}/items`, { items: [{ op: "add", path: "/big2.bin", contentHash: sha(text), size: text.length }] }, csCtx(cs));
  const again = await call(content.POST, cli, "POST", `/api/v1/change-sets/${cs}/content`, { hash: sha(text) }, csCtx(cs));
  assert.equal(again.status, 200);
  assert.ok(stored.has(key), "stored content is never removed by a later request");
});

const TEN = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join("\n") + "\n";

test("a teammate's edit elsewhere in the file merges automatically, and both changes land", async () => {
  const { owner, workspace, cli } = await setup([]);
  await addVersion(workspace, owner, "/page.txt", TEN);
  const { cs } = await draft(cli, workspace, [{ op: "change", path: "/page.txt", text: TEN.replace("line 9", "mine 9") }]);
  await finishIt(cli, cs);
  await addVersion(workspace, owner, "/page.txt", TEN.replace("line 2", "theirs 2"));
  const res = await applyIt(cli, cs);
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.equal(await textOf(workspace, "/page.txt"), TEN.replace("line 2", "theirs 2").replace("line 9", "mine 9"));
  const [item] = await sql`SELECT state, conflict FROM change_set_items WHERE change_set_id = ${cs}`;
  assert.equal(item!.conflict.kind, "merged", "marked as merged automatically for review");
});

test("update the draft merges now; resolve mine, theirs and new content", async () => {
  const { owner, workspace, cli } = await setup([]);
  await addVersion(workspace, owner, "/x.txt", TEN);
  await addVersion(workspace, owner, "/y.txt", TEN);
  await addVersion(workspace, owner, "/z.txt", TEN);
  const { cs } = await draft(cli, workspace, [
    { op: "change", path: "/x.txt", text: TEN.replace("line 5", "mine 5") },
    { op: "change", path: "/y.txt", text: TEN.replace("line 5", "mine 5") },
    { op: "change", path: "/z.txt", text: TEN.replace("line 8", "mine 8") },
  ]);
  for (const f of ["/x.txt", "/y.txt"]) await addVersion(workspace, owner, f, TEN.replace("line 5", "theirs 5"));
  await addVersion(workspace, owner, "/z.txt", TEN.replace("line 1", "theirs 1"));
  const up = await call(update.POST, cli, "POST", `/api/v1/change-sets/${cs}/update`, {}, csCtx(cs));
  assert.equal(up.status, 200, JSON.stringify(up.json));
  assert.deepEqual(up.json.data.merged.map((m: { path: string }) => m.path), ["/z.txt"]);
  assert.deepEqual(up.json.data.conflicts.map((c: { path: string }) => c.path).sort(), ["/x.txt", "/y.txt"]);
  const r = (path: string, choice: string, extra = {}) => call(resolve.POST, cli, "POST", `/api/v1/change-sets/${cs}/resolve`, { path, choice, ...extra }, csCtx(cs));
  assert.equal((await r("/x.txt", "mine")).status, 200);
  assert.equal((await r("/y.txt", "content", { text: TEN.replace("line 5", "both 5") })).status, 200);
  assert.equal((await finishIt(cli, cs)).status, 200);
  assert.equal((await applyIt(cli, cs)).status, 200);
  assert.equal(await textOf(workspace, "/x.txt"), TEN.replace("line 5", "mine 5"));
  assert.equal(await textOf(workspace, "/y.txt"), TEN.replace("line 5", "both 5"));
  assert.equal(await textOf(workspace, "/z.txt"), TEN.replace("line 1", "theirs 1").replace("line 8", "mine 8"));
  const { cs: other } = await draft(cli, workspace, [{ op: "change", path: "/x.txt", text: "dropped\n" }], "Other");
  await addVersion(workspace, owner, "/x.txt", "newer\n");
  await call(update.POST, cli, "POST", `/api/v1/change-sets/${other}/update`, {}, csCtx(other));
  assert.equal((await call(resolve.POST, cli, "POST", `/api/v1/change-sets/${other}/resolve`, { path: "/x.txt", choice: "theirs" }, csCtx(other))).status, 200);
  const view = await call(one.GET, cli, "GET", `/api/v1/change-sets/${other}`, undefined, csCtx(other));
  assert.deepEqual(view.json.data.items, [], "theirs drops the item");
});

test("other conflicts: deleted since (recreate), exists (make it a change), moved (follow it)", async () => {
  const { owner, workspace, cli } = await setup(["a", "b"]);
  const { cs } = await draft(cli, workspace, [
    { op: "change", path: "/a.txt", text: "edited a\n" },
    { op: "add", path: "/new.txt", text: "new one\n" },
    { op: "change", path: "/b.txt", text: "edited b\n" },
  ]);
  await finishIt(cli, cs);
  await sql`UPDATE workspace_nodes SET deleted_at = now() WHERE workspace_id = ${workspace} AND path = '/a.txt'`;
  await addVersion(workspace, owner, "/new.txt", "someone else's\n");
  await sql`UPDATE workspace_nodes SET path = '/docs/b.txt' WHERE workspace_id = ${workspace} AND path = '/b.txt'`;
  const res = await applyIt(cli, cs);
  assert.equal(res.status, 409);
  assert.deepEqual(res.json.details.conflicts.map((c: { path: string; kind: string }) => `${c.path}:${c.kind}`).sort(), ["/a.txt:deleted", "/b.txt:moved", "/new.txt:exists"]);
  for (const path of ["/a.txt", "/new.txt", "/b.txt"]) assert.equal((await call(resolve.POST, cli, "POST", `/api/v1/change-sets/${cs}/resolve`, { path, choice: "mine" }, csCtx(cs))).status, 200, path);
  assert.equal((await finishIt(cli, cs)).status, 200);
  const ok = await applyIt(cli, cs);
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(await textOf(workspace, "/a.txt"), "edited a\n", "recreated");
  assert.equal(await textOf(workspace, "/new.txt"), "new one\n", "a new version of the file that appeared");
  assert.equal(await textOf(workspace, "/docs/b.txt"), "edited b\n", "the edit followed the move");
});

test("two change sets on the same file in either order: the second merges onto the first", async () => {
  for (const order of [[0, 1], [1, 0]]) {
    const { owner, workspace, cli } = await setup([]);
    await addVersion(workspace, owner, "/s.txt", TEN);
    const sets = [
      await draft(cli, workspace, [{ op: "change", path: "/s.txt", text: TEN.replace("line 2", "first 2") }], "One"),
      await draft(cli, workspace, [{ op: "change", path: "/s.txt", text: TEN.replace("line 9", "second 9") }], "Two"),
    ];
    for (const s of sets) await finishIt(cli, s.cs);
    for (const i of order) assert.equal((await applyIt(cli, sets[i]!.cs)).status, 200);
    assert.equal(await textOf(workspace, "/s.txt"), TEN.replace("line 2", "first 2").replace("line 9", "second 9"));
  }
});

test("resolve only settles conflicts, and a resolved set must be finished again before it applies", async () => {
  const { owner, workspace, cli } = await setup([]);
  await addVersion(workspace, owner, "/k.txt", TEN);
  const { cs } = await draft(cli, workspace, [{ op: "change", path: "/k.txt", text: TEN.replace("line 4", "mine 4") }, { op: "add", path: "/n.txt", text: "n\n" }]);
  await finishIt(cli, cs);
  const notConflicted = await call(resolve.POST, cli, "POST", `/api/v1/change-sets/${cs}/resolve`, { path: "/n.txt", choice: "content", text: "sneaky\n" }, csCtx(cs));
  assert.equal(notConflicted.json.errorCode, "CONFLICT");
  await addVersion(workspace, owner, "/k.txt", TEN.replace("line 4", "theirs 4"));
  assert.equal((await applyIt(cli, cs)).json.errorCode, "CHANGE_SET_CONFLICT");
  await call(resolve.POST, cli, "POST", `/api/v1/change-sets/${cs}/resolve`, { path: "/k.txt", choice: "content", text: "AKIAIOSFODNN7EXAMPLE\n" }, csCtx(cs));
  assert.equal((await applyIt(cli, cs)).json.errorCode, "CHANGE_SET_NOT_READY", "back to a draft");
  assert.equal((await finishIt(cli, cs)).json.errorCode, "SECRET_DETECTED", "finish checks the resolved text");
});


test("'with Claude Code' follows the workspace owner's label setting; raw agent fields never leave the server", async () => {
  const { owner, workspace, cli } = await setup(["a"]);
  const agent = await token(owner, "agent", workspace, ["file:read", "file:write"]);
  await draft(agent, workspace, [{ op: "change", path: "/a.txt", text: "by the agent\n" }]);
  const teammate = await sql.begin((tx) => createUser(tx));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${workspace}, ${teammate}, 'member')`;
  const list = (t: string) => call(ws.GET, t, "GET", `/api/v1/workspaces/${workspace}/change-sets`, undefined, { params: Promise.resolve({ id: workspace }) });
  const mine = (await list(cli)).json.data.changeSets[0];
  assert.equal(mine.madeWith, "with Claude Code");
  assert.ok(!("agentName" in mine) && !("agentSessionId" in mine));
  await sql`UPDATE workspaces SET agent_label_visibility = 'person' WHERE id = ${workspace}`;
  const theirs = (await list(await token(teammate, "device", null))).json.data.changeSets[0];
  assert.equal(theirs.madeWith, null, "only the person sees their own agent's label");
});

test("speed (G22): a 50-file set finishes and applies quickly; 2,000 files apply in one transaction", async () => {
  const { workspace, cli } = await setup([]);
  const many = (n: number, tag: string) => Array.from({ length: n }, (_, i) => ({ op: "add", path: `/${tag}/f${String(i).padStart(4, "0")}.ts`, text: `export const v${i} = "${tag}";\n` }));
  const fifty = await draftMany(cli, workspace, many(50, "fifty"));
  let t = Date.now();
  assert.equal((await finishIt(cli, fifty)).status, 200);
  const finishMs = Date.now() - t;
  t = Date.now();
  assert.equal((await applyIt(cli, fifty)).status, 200);
  const applyMs = Date.now() - t;
  const big = await draftMany(cli, workspace, many(2000, "big"));
  assert.equal((await finishIt(cli, big)).status, 200);
  t = Date.now();
  const res = await applyIt(cli, big);
  const bigMs = Date.now() - t;
  assert.equal(res.status, 200, JSON.stringify(res.json).slice(0, 300));
  console.log(`speed: 50-file finish ${finishMs} ms, apply ${applyMs} ms; 2,000-file apply ${bigMs} ms`);
  assert.ok(finishMs < 10_000 && applyMs < 2_000 && bigMs < 30_000, `${finishMs} / ${applyMs} / ${bigMs}`);
});

/** A set with many files, sent 200 at a time with their content. */
async function draftMany(t: string, workspace: string, list: Array<{ op: string; path: string; text: string }>) {
  const started = await call(ws.POST, t, "POST", `/api/v1/workspaces/${workspace}/change-sets`, { title: `Many ${list.length}` }, { params: Promise.resolve({ id: workspace }) });
  const cs = started.json.data.changeSet.id as string;
  for (let i = 0; i < list.length; i += 200) {
    const chunk = list.slice(i, i + 200);
    const put = await call(items.PUT, t, "PUT", `/api/v1/change-sets/${cs}/items`, { items: chunk.map((f) => ({ op: f.op, path: f.path, contentHash: sha(f.text), size: Buffer.byteLength(f.text), mimeType: "text/plain" })) }, csCtx(cs));
    assert.equal(put.status, 200, JSON.stringify(put.json));
    await call(content.POST, t, "POST", `/api/v1/change-sets/${cs}/content`, { files: chunk.map((f) => ({ hash: sha(f.text), base64: Buffer.from(f.text).toString("base64") })) }, csCtx(cs));
  }
  return cs;
}

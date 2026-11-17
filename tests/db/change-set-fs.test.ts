import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// Report G14 (M6): a cloud agent lists, reads, searches and edits a workspace through a change set's draft, with no
// computer of its own. Writes are change set items, so the same locks, limits and key checks apply.
let headerValues: Record<string, string> = {};
moduleStubs.set("next/headers", { headers: async () => ({ get: (name: string) => headerValues[name.toLowerCase()] ?? null }), cookies: async () => ({ getAll: () => [], get: () => undefined, set: () => undefined }) });
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("@/lib/security/csrf", { validateCsrf: () => null });
const stored = new Map<string, Buffer>();
let downloads = 0;
moduleStubs.set("@/lib/supabase/server", {
  createAdminClient: async () => ({ storage: { from: () => ({
    upload: async (key: string, body: Buffer) => { stored.set(key, Buffer.from(body)); return { error: null }; },
    download: async (key: string) => { downloads++; return stored.has(key) ? { data: new Blob([stored.get(key)!]), error: null } : { data: null, error: new Error("not found") }; },
    remove: async (keys: string[]) => { for (const k of keys) stored.delete(k); return { error: null }; },
    createSignedUploadUrl: async (key: string) => ({ data: { signedUrl: `https://storage.test/${key}`, token: "t" }, error: null }),
  }) } }),
});

type Route = (r: Request, c?: any) => Promise<Response>;
let ws: { POST: Route };
let fsRead: { GET: Route };
let fsWrite: { POST: Route };
let items: { PUT: Route };
let one: { GET: Route };
before(async () => {
  ws = await loadAppModule(() => import("../../src/app/api/v1/workspaces/[id]/change-sets/route"));
  fsRead = await loadAppModule(() => import("../../src/app/api/v1/workspaces/[id]/fs/[op]/route"));
  fsWrite = await loadAppModule(() => import("../../src/app/api/v1/change-sets/[cs]/fs/[op]/route"));
  items = await loadAppModule(() => import("../../src/app/api/v1/change-sets/[cs]/items/route"));
  one = await loadAppModule(() => import("../../src/app/api/v1/change-sets/[cs]/route"));
});
after(async () => { await sql.end(); await closeAppDb(); });

const sha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
async function token(userId: string, kind: "device" | "agent", workspaceId: string | null, scopes: string[] = []) {
  const t = `nb_${kind === "agent" ? "agt" : "dev"}_${randomUUID().replace(/-/g, "")}`;
  await sql`INSERT INTO extension_device_sessions (user_id, token_hash, token_prefix, device_name, client_version, expires_at, token_type, agent_name, workspace_id, scopes)
            VALUES (${userId}, ${sha(t)}, ${t.slice(0, 11)}, 'cloud', '2.3.0', now() + interval '1 day', ${kind}, ${kind === "agent" ? "Cloud agent" : null}, ${workspaceId}, ${sql.json(scopes)})`;
  return t;
}
async function call(handler: Route, t: string, method: string, path: string, body?: unknown, ctx?: unknown) {
  headerValues = { authorization: `Bearer ${t}`, "x-networkbase-request-method": method, "x-networkbase-request-target": path.split("?")[0]! };
  const res = await handler(new Request(`https://app.test${path}`, { method, headers: { "content-type": "application/json", "idempotency-key": randomUUID() }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), ctx);
  return { status: res.status, json: await res.json() as any };
}
async function addFile(workspace: string, userId: string, path: string, text: string | Buffer, opts: { taskId?: string; mime?: string } = {}) {
  const bytes = Buffer.from(text);
  const key = `${workspace}/test/${sha(bytes)}-${randomUUID()}`;
  stored.set(key, bytes);
  const mime = opts.mime ?? "text/plain";
  const [asset] = await sql`INSERT INTO storage_assets (owner_user_id, workspace_id, bucket, storage_key, purpose, state, declared_mime_type, declared_size, content_hash, expires_at, verified_at, verified_size, verified_mime_type)
    VALUES (${userId}, ${workspace}, 'project-files', ${key}, 'workspace_file:file', 'verified', ${mime}, ${bytes.byteLength}, ${sha(bytes)}, now(), now(), ${bytes.byteLength}, ${mime}) RETURNING id`;
  let parent: string | null = null;
  let folder = "";
  for (const name of path.split("/").filter(Boolean).slice(0, -1)) {
    folder += `/${name}`;
    const [f] = await sql`SELECT id FROM workspace_nodes WHERE workspace_id = ${workspace} AND path = ${folder} AND type = 'folder' AND deleted_at IS NULL`;
    parent = f ? (f.id as string) : ((await sql`INSERT INTO workspace_nodes (workspace_id, parent_id, type, name, path, created_by, current_version, task_id) VALUES (${workspace}, ${parent}, 'folder', ${name}, ${folder}, ${userId}, 1, ${opts.taskId ?? null}) RETURNING id`)[0]!.id as string);
  }
  const [node] = await sql`INSERT INTO workspace_nodes (workspace_id, parent_id, type, name, path, created_by, size, current_version, s3_key, asset_id, mime_type, task_id)
    VALUES (${workspace}, ${parent}, 'file', ${path.split("/").pop()!}, ${path}, ${userId}, ${bytes.byteLength}, 1, ${key}, ${asset!.id}, ${mime}, ${opts.taskId ?? null}) RETURNING id`;
  await sql`INSERT INTO file_versions (node_id, version, s3_key, asset_id, size, mime_type, content_hash, uploaded_by) VALUES (${node!.id}, 1, ${key}, ${asset!.id}, ${bytes.byteLength}, ${mime}, ${sha(bytes)}, ${userId})`;
}

const PROJECT: Record<string, string> = {
  "/src/api/client.ts": "export async function get(path: string) {\n  const res = await fetch(path);\n  return res.json();\n}\n",
  "/src/auth/LoginForm.tsx": "export function LoginForm() {\n  return <form><Button>Sign in</Button></form>;\n}\n",
  "/src/pages/Signup.tsx": "export default function Signup() {\n  return <Button>Create account</Button>;\n}\n",
  "/README.md": "# Demo\nSign in with your email.\n",
};
async function setup() {
  const owner = await sql.begin((tx) => createUser(tx));
  const workspace = await sql.begin((tx) => createProject(tx, owner));
  await sql`UPDATE workspaces SET change_sets_enabled = true WHERE id = ${workspace}`;
  for (const [p, t] of Object.entries(PROJECT)) await addFile(workspace, owner, p, t);
  const agent = await token(owner, "agent", workspace, ["file:read", "file:write"]);
  const started = await call(ws.POST, agent, "POST", `/api/v1/workspaces/${workspace}/change-sets`, { title: "Cloud work" }, { params: Promise.resolve({ id: workspace }) });
  assert.equal(started.status, 201, JSON.stringify(started.json));
  return { owner, workspace, agent, cs: started.json.data.changeSet.id as string };
}
const get = (t: string, workspace: string, op: string, query: Record<string, string | string[]> = {}) => {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) for (const x of [v].flat()) qs.append(k, x);
  return call(fsRead.GET, t, "GET", `/api/v1/workspaces/${workspace}/fs/${op}?${qs}`, undefined, { params: Promise.resolve({ id: workspace, op }) });
};
const post = (t: string, cs: string, op: string, body: unknown) => call(fsWrite.POST, t, "POST", `/api/v1/change-sets/${cs}/fs/${op}`, body, { params: Promise.resolve({ cs, op }) });

test("an agent edits, writes, moves and deletes in a draft, and list, read and search see the draft", async () => {
  const { workspace, agent, cs } = await setup();
  const edit = await post(agent, cs, "edit", { path: "/src/api/client.ts", oldText: "fetch(path)", newText: "fetch(path, { credentials: 'include' })" });
  assert.equal(edit.status, 200, JSON.stringify(edit.json));
  assert.equal((await post(agent, cs, "write", { path: "/src/auth/login.css", text: ".card { gap: 12px; }\n" })).status, 200);
  assert.equal((await post(agent, cs, "move", { from: "/src/pages/Signup.tsx", to: "/src/pages/Register.tsx" })).status, 200);
  assert.equal((await post(agent, cs, "delete", { path: "/README.md" })).status, 200);

  const draft = await get(agent, workspace, "list", { changeSet: cs });
  assert.deepEqual(draft.json.data.files.map((f: any) => f.path), ["/src/api/client.ts", "/src/auth/LoginForm.tsx", "/src/auth/login.css", "/src/pages/Register.tsx"]);
  const live = await get(agent, workspace, "list", { glob: "*.tsx" });
  assert.deepEqual(live.json.data.files.map((f: any) => f.path), ["/src/auth/LoginForm.tsx", "/src/pages/Signup.tsx"], "the workspace itself is unchanged");

  const read = await get(agent, workspace, "read", { changeSet: cs, path: ["/src/api/client.ts", "/nope.txt"] });
  assert.match(read.json.data.files[0].text, /credentials: 'include'/);
  assert.equal(read.json.data.files[1].error, "NOT_FOUND");

  const found = await get(agent, workspace, "search", { changeSet: cs, query: "credentials" });
  assert.deepEqual(found.json.data.matches, [{ path: "/src/api/client.ts", line: 2, text: "  const res = await fetch(path, { credentials: 'include' });" }]);
  const sign = await get(agent, workspace, "search", { query: "sign in" });
  assert.deepEqual(sign.json.data.matches.map((m: any) => `${m.path}:${m.line}`), ["/README.md:2", "/src/auth/LoginForm.tsx:2"], "case-insensitive by default");
  const re = await get(agent, workspace, "search", { query: "Button>[A-Z]", regex: "true", caseSensitive: "true", glob: "src/**" });
  assert.equal(re.json.data.matches.length, 2);

  const view = await call(one.GET, agent, "GET", `/api/v1/change-sets/${cs}`, undefined, { params: Promise.resolve({ cs }) });
  assert.deepEqual(view.json.data.items.map((i: any) => `${i.op} ${i.path}`).sort(), ["add /src/auth/login.css", "change /src/api/client.ts", "delete /README.md", "rename /src/pages/Register.tsx"]);
});

test("an edit that matches nowhere or more than once is refused with the count", async () => {
  const { agent, cs } = await setup();
  const none = await post(agent, cs, "edit", { path: "/src/api/client.ts", oldText: "axios", newText: "x" });
  assert.equal(none.json.errorCode, "EDIT_NOT_FOUND");
  const many = await post(agent, cs, "edit", { path: "/src/api/client.ts", oldText: "path", newText: "url" });
  assert.equal(many.json.errorCode, "EDIT_NOT_UNIQUE");
  assert.equal(many.json.details?.count ?? many.json.count, 2);
  const all = await post(agent, cs, "edit", { path: "/src/api/client.ts", oldText: "path", newText: "url", all: true });
  assert.equal(all.json.data.replaced, 2);
  // Several in one call, in order, all or none.
  const bad = await post(agent, cs, "edit", { path: "/src/api/client.ts", edits: [{ oldText: "async", newText: "" }, { oldText: "nowhere", newText: "x" }] });
  assert.equal(bad.json.errorCode, "EDIT_NOT_FOUND");
  assert.equal(bad.json.details?.edit ?? bad.json.edit, 1);
  const two = await post(agent, cs, "edit", { path: "/src/api/client.ts", edits: [{ oldText: "async ", newText: "" }, { oldText: "res.json()", newText: "await res.json()" }] });
  assert.equal(two.status, 200, JSON.stringify(two.json));
  assert.equal(two.json.data.replaced, 2);
});

test("a draft's own moves and deletes stay one item each: moving twice is one rename, deleting a moved file deletes the original", async () => {
  const { agent, cs, workspace } = await setup();
  await post(agent, cs, "move", { from: "/src/pages/Signup.tsx", to: "/src/pages/Register.tsx" });
  await post(agent, cs, "move", { from: "/src/pages/Register.tsx", to: "/src/Join.tsx" });
  let view = await call(one.GET, agent, "GET", `/api/v1/change-sets/${cs}`, undefined, { params: Promise.resolve({ cs }) });
  assert.deepEqual(view.json.data.items.map((i: any) => `${i.op} ${i.fromPath ?? ""}→${i.path}`), ["rename /src/pages/Signup.tsx→/src/Join.tsx"]);
  await post(agent, cs, "delete", { path: "/src/Join.tsx" });
  view = await call(one.GET, agent, "GET", `/api/v1/change-sets/${cs}`, undefined, { params: Promise.resolve({ cs }) });
  assert.deepEqual(view.json.data.items.map((i: any) => `${i.op} ${i.path}`), ["delete /src/pages/Signup.tsx"]);
  // A file only the draft added just leaves it.
  await post(agent, cs, "write", { path: "/tmp.txt", text: "x" });
  await post(agent, cs, "delete", { path: "/tmp.txt" });
  view = await call(one.GET, agent, "GET", `/api/v1/change-sets/${cs}`, undefined, { params: Promise.resolve({ cs }) });
  assert.equal(view.json.data.items.length, 1);
  assert.equal((await get(agent, workspace, "read", { changeSet: cs, path: "/tmp.txt" })).json.data.files[0].error, "NOT_FOUND");
});

test("a key in a written file is held, not stored, and the agent is told", async () => {
  const { agent, cs } = await setup();
  const res = await post(agent, cs, "write", { path: "/.env", text: "AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY\n" });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.equal(res.json.data.held, true);
});

test("the index fills once per content: a second search downloads nothing, binaries are skipped", async () => {
  const { workspace, owner, agent } = await setup();
  // Entries are by content, shared by every workspace with that content: these two are new to the index.
  const run = randomUUID();
  await addFile(workspace, owner, "/notes/a.md", `export one ${run}\n`);
  await addFile(workspace, owner, "/notes/b.md", `export two ${run}\n`);
  await addFile(workspace, owner, "/logo.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, ...Buffer.from(run)]), { mime: "image/png" });
  downloads = 0;
  await get(agent, workspace, "search", { query: run });
  assert.equal(downloads, 2, "the two new text files, not the image");
  downloads = 0;
  const again = await get(agent, workspace, "search", { query: run });
  assert.equal(downloads, 0);
  assert.equal(again.json.data.matches.length, 2);
  assert.equal(again.json.data.notIndexed, 0);
});

test("task files stay out for a viewer who can't see tasks, and another workspace's token is refused", async () => {
  const { workspace, owner, agent } = await setup();
  const otherOwner = await sql.begin((tx) => createUser(tx));
  const other = await sql.begin((tx) => createProject(tx, otherOwner));
  const outside = await get(agent, other, "list");
  assert.ok([403, 404].includes(outside.status), String(outside.status));
  await addFile(workspace, owner, "/.system/tasks/1/notes.md", "secret task notes\n");
  const listed = await get(agent, workspace, "list");
  assert.ok(!listed.json.data.files.some((f: any) => f.path.startsWith("/.system")));
  const bad = await get(agent, workspace, "search", { query: "(", regex: "true" });
  assert.equal(bad.json.errorCode, "BAD_REQUEST");
});

test("someone who can only read the workspace can't write into a change set or see drafts", async () => {
  const { workspace, owner, cs } = await setup();
  const viewer = await sql.begin((tx) => createUser(tx));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${workspace}, ${viewer}, 'viewer')`;
  const t = await token(viewer, "device", null);
  assert.equal((await get(t, workspace, "list", { changeSet: cs })).status, 404);
  assert.equal((await get(t, workspace, "list")).status, 200);
  const write = await post(t, cs, "write", { path: "/x.txt", text: "x" });
  assert.equal(write.status, 403);
  void owner;
});

test("the daily clean-up drops index entries nothing refers to, and keeps the rest", async () => {
  const { workspace, agent } = await setup();
  await get(agent, workspace, "search", { query: "export" });
  const orphan = sha(`orphan ${randomUUID()}`);
  await sql`INSERT INTO file_text_index (content_hash, content, bytes, indexed_at) VALUES (${orphan}, 'gone', 4, now() - interval '8 days')`;
  await sql`UPDATE file_text_index SET indexed_at = now() - interval '8 days' WHERE content_hash = ${sha(PROJECT["/README.md"]!)}`;
  const { pruneTextIndex } = await loadAppModule(() => import("../../src/lib/domain/change-set-fs"));
  assert.ok(await pruneTextIndex() >= 1);
  assert.equal((await sql`SELECT 1 FROM file_text_index WHERE content_hash = ${orphan}`).length, 0);
  assert.equal((await sql`SELECT 1 FROM file_text_index WHERE content_hash = ${sha(PROJECT["/README.md"]!)}`).length, 1);
});

test("speed: a 2,000-file workspace fills its index over a few searches, then a search takes well under a second", async () => {
  const { workspace, owner, agent } = await setup();
  const run = randomUUID().slice(0, 8);
  const files = Array.from({ length: 2000 }, (_, i) => {
    const text = Array.from({ length: 60 }, (_, l) => `export const value${l} = "${run}-${i}-${l}"; // line ${l} of file ${i}`).join("\n") + (i === 1234 ? `\nconst needle${run} = 1;\n` : "\n");
    const bytes = Buffer.from(text);
    const key = `${workspace}/bench/${i}`;
    stored.set(key, bytes);
    return { path: `/bench/f${String(i).padStart(4, "0")}.ts`, key, size: bytes.byteLength, hash: sha(bytes) };
  });
  const [folder] = await sql`INSERT INTO workspace_nodes (workspace_id, type, name, path, created_by, current_version) VALUES (${workspace}, 'folder', 'bench', '/bench', ${owner}, 1) RETURNING id`;
  for (let i = 0; i < files.length; i += 500) {
    const chunk = files.slice(i, i + 500);
    const nodes = await sql`INSERT INTO workspace_nodes ${sql(chunk.map((f) => ({ workspace_id: workspace, parent_id: folder!.id, type: "file", name: f.path.split("/").pop()!, path: f.path, created_by: owner, size: f.size, current_version: 1, s3_key: f.key, mime_type: "text/typescript" })))} RETURNING id, path`;
    const byPath = new Map(nodes.map((n) => [n.path as string, n.id as string]));
    await sql`INSERT INTO file_versions ${sql(chunk.map((f) => ({ node_id: byPath.get(f.path)!, version: 1, s3_key: f.key, size: f.size, mime_type: "text/typescript", content_hash: f.hash, uploaded_by: owner })))}`;
  }
  const timed = async () => { const t = performance.now(); const r = await get(agent, workspace, "search", { query: `needle${run}` }); return { ms: performance.now() - t, data: r.json.data }; };
  const first = await timed();
  let searches = 1;
  let last = first;
  while (last.data.notIndexed > 0 && searches < 10) { last = await timed(); searches++; }
  const warm = await timed();
  console.log(`[bench] 2,000 files: first search ${first.ms.toFixed(0)} ms (indexes 300), fully indexed after ${searches} searches, then ${warm.ms.toFixed(0)} ms`);
  assert.equal(last.data.notIndexed, 0);
  assert.deepEqual(warm.data.matches.map((m: any) => m.path), ["/bench/f1234.ts"]);
  assert.ok(warm.ms < 1000, `${warm.ms} ms`);
});

test("security review: a declared but unsent hash never searches another workspace's content; edits and globs are bounded", async () => {
  // Another workspace's private file, indexed by its own search.
  const victim = await setup();
  const secret = `password for the vault: ${randomUUID()}\n`;
  await addFile(victim.workspace, victim.owner, "/private/notes.txt", secret);
  await get(victim.agent, victim.workspace, "search", { query: "vault" });
  assert.equal((await sql`SELECT 1 FROM file_text_index WHERE content_hash = ${sha(secret)}`).length, 1);
  // The attacker declares an item with that hash (and a binary type) but never sends the bytes.
  const { workspace, agent, cs } = await setup();
  const put = await call(items.PUT, agent, "PUT", `/api/v1/change-sets/${cs}/items`, { items: [{ op: "add", path: "/x.png", contentHash: sha(secret), size: Buffer.byteLength(secret), mimeType: "image/png" }] }, { params: Promise.resolve({ cs }) });
  assert.equal(put.status, 200, JSON.stringify(put.json));
  const found = await get(agent, workspace, "search", { changeSet: cs, query: ".", regex: "true" });
  assert.ok(!found.json.data.matches.some((m: any) => m.path === "/x.png"), "no lines from content it never proved it has");
  assert.equal((await get(agent, workspace, "read", { changeSet: cs, path: "/x.png" })).json.data.files[0].error, "CONTENT_UNAVAILABLE");
  // Binary-typed or unread content never gets an entry decided for everyone.
  assert.notEqual((await sql`SELECT content FROM file_text_index WHERE content_hash = ${sha(secret)}`)[0]?.content, null);

  const grow = await post(agent, cs, "edit", { path: "/src/api/client.ts", edits: [{ oldText: "a", newText: "x".repeat(400_000), all: true }] });
  assert.equal(grow.status, 413);
  assert.equal(grow.json.errorCode, "FILE_TOO_LARGE");
  const glob = await get(agent, workspace, "list", { glob: "{a,b}{c,d}{e,f}{g,h}/**/*.ts" });
  assert.equal(glob.status, 400);
});

test("H8: on a branch, list, read and search see the branch's files; a change set on a branch builds on them", async () => {
  const { owner, workspace } = await setup();
  const { unprotect } = await import("./_helpers");
  const saves = await loadAppModule(() => import("../../src/lib/domain/saves"));
  const branches = await loadAppModule(() => import("../../src/lib/domain/branches"));
  await saves.setBranchesEnabled({ user: { id: owner } }, workspace, true);
  await unprotect(workspace);
  const { branch } = await branches.createBranch({ user: { id: owner } }, workspace, { name: "feature-x" });
  await branches.saveTextOnBranch({ user: { id: owner } }, branch.id, { path: "/README.md", text: "# Demo\nOnly on the branch: hello there.\n", expectedHash: sha(PROJECT["/README.md"]!) });
  const reader = await token(owner, "device", null, ["file:read"]);
  const onBranch = await get(reader, workspace, "search", { query: "hello there", branch: "feature-x" });
  assert.equal(onBranch.status, 200, JSON.stringify(onBranch.json));
  assert.deepEqual(onBranch.json.data.matches.map((m: any) => `${m.path}:${m.line}`), ["/README.md:2"]);
  assert.deepEqual((await get(reader, workspace, "search", { query: "hello there" })).json.data.matches, [], "main doesn't have it");
  const read = await get(reader, workspace, "read", { branch: branch.id, path: "/README.md" });
  assert.match(read.json.data.files[0].text, /Only on the branch/);
  // A change set on the branch edits the branch's text, not main's.
  const agent = await token(owner, "agent", workspace, ["file:read", "file:write"]);
  const started = await call(ws.POST, agent, "POST", `/api/v1/workspaces/${workspace}/change-sets`, { title: "On the branch", branchId: branch.id }, { params: Promise.resolve({ id: workspace }) });
  assert.equal(started.status, 201, JSON.stringify(started.json));
  const edit = await post(agent, started.json.data.changeSet.id, "edit", { path: "/README.md", oldText: "hello there", newText: "hello again" });
  assert.equal(edit.status, 200, JSON.stringify(edit.json));
  const outsider = await sql.begin((tx) => createUser(tx));
  const stranger = await token(outsider, "device", null, ["file:read"]);
  assert.notEqual((await get(stranger, workspace, "search", { query: "hello", branch: "feature-x" })).status, 200);
});

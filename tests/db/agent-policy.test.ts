import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// Report §26.6, A2.8, A2.9: agents make small changes at once with an undo; big ones need the person's yes, bound
// to the exact request and usable once; a workspace can ask for everything or pause agents; undo refuses when
// something changed since.
let headerValues: Record<string, string> = {};
moduleStubs.set("next/headers", { headers: async () => ({ get: (name: string) => headerValues[name.toLowerCase()] ?? null }), cookies: async () => ({ getAll: () => [], get: () => undefined, set: () => undefined }) });
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("@/lib/security/csrf", { validateCsrf: () => null });

let createTask: typeof import("../../src/app/api/v1/extension/create-task/route");
let taskUpdate: typeof import("../../src/app/api/v1/extension/task-update/route");
let place: typeof import("../../src/app/api/v1/files/place/route");
let undo: typeof import("../../src/app/api/v1/undo/[id]/route");
before(async () => {
  const server = await loadAppModule(() => import("../../src/lib/supabase/server"));
  // Storage in memory: uploads are kept, and a signed URL is a data: URL of them, so reading old text works (D4).
  const stored = new Map<string, Buffer>();
  moduleStubs.set("@/lib/supabase/server", { ...server, createAdminClient: async () => ({ storage: { from: () => ({
    upload: async (key: string, body: Buffer | Uint8Array | string) => { stored.set(key, Buffer.from(body as Buffer)); return { error: null }; },
    createSignedUrl: async (key: string) => (stored.has(key) ? { data: { signedUrl: `data:application/octet-stream;base64,${stored.get(key)!.toString("base64")}` }, error: null } : { data: null, error: new Error("not found") }),
  }) } }) });
  createTask = await loadAppModule(() => import("../../src/app/api/v1/extension/create-task/route"));
  taskUpdate = await loadAppModule(() => import("../../src/app/api/v1/extension/task-update/route"));
  place = await loadAppModule(() => import("../../src/app/api/v1/files/place/route"));
  undo = await loadAppModule(() => import("../../src/app/api/v1/undo/[id]/route"));
});
after(async () => { await sql.end(); await closeAppDb(); });

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
async function agentToken(userId: string, workspaceId: string, scopes: string[] = []) {
  const token = `nb_agt_${randomUUID().replace(/-/g, "")}`;
  await sql`INSERT INTO extension_device_sessions (user_id, token_hash, token_prefix, device_name, client_version, expires_at, token_type, agent_name, workspace_id, scopes)
            VALUES (${userId}, ${hash(token)}, ${token.slice(0, 11)}, 'laptop', '2.0.0', now() + interval '1 day', 'agent', 'Claude Code', ${workspaceId}, ${sql.json(scopes)})`;
  return token;
}
const call = async (handler: (r: Request, c?: any) => Promise<Response>, token: string, method: string, path: string, body: unknown, extra: Record<string, string> = {}, ctx?: unknown) => {
  headerValues = { authorization: `Bearer ${token}`, "x-networkbase-request-method": method, "x-networkbase-request-target": path };
  const res = await handler(new Request(`https://app.test${path}`, { method, headers: { "content-type": "application/json", "idempotency-key": randomUUID(), ...extra }, body: JSON.stringify(body) }), ctx);
  return { status: res.status, json: await res.json() };
};
const undoCall = (token: string, id: string) => call(undo.POST, token, "POST", `/api/v1/undo/${id}`, {}, {}, { params: Promise.resolve({ id }) });

test("a small change runs with an undo token, and undo removes it", async () => {
  const userId = await sql.begin((tx) => createUser(tx));
  const projectId = await sql.begin((tx) => createProject(tx, userId));
  const token = await agentToken(userId, projectId);
  const created = await call(createTask.POST, token, "POST", "/api/v1/extension/create-task", { projectId, title: "Update the logo" });
  assert.equal(created.status, 200, JSON.stringify(created.json));
  assert.ok(created.json.data.undoToken);
  const undone = await undoCall(token, created.json.data.undoToken);
  assert.equal(undone.status, 200, JSON.stringify(undone.json));
  const [task] = await sql`SELECT deleted_at FROM tasks WHERE workspace_id = ${projectId} AND title = 'Update the logo'`;
  assert.ok(task!.deleted_at, "the task is gone");
  assert.equal((await undoCall(token, created.json.data.undoToken)).status, 410, "undo works once");
});

test("finishing a task needs a yes bound to the exact request, usable once", async () => {
  const userId = await sql.begin((tx) => createUser(tx));
  const projectId = await sql.begin((tx) => createProject(tx, userId));
  const token = await agentToken(userId, projectId, ["workspace:read", "task:read", "task:write", "task:complete"]);
  const [task] = await sql`INSERT INTO tasks (workspace_id, title, status, assignee_id) VALUES (${projectId}, 'Ship', 'in_progress', ${userId}) RETURNING id, updated_at`;
  const body = { kind: "status", projectId, taskId: task!.id, status: "done", expectedUpdatedAt: new Date(task!.updated_at).toISOString() };
  const held = await call(taskUpdate.PATCH, token, "PATCH", "/api/v1/extension/task-update", body);
  assert.equal(held.status, 428, JSON.stringify(held.json));
  assert.equal(held.json.errorCode, "NEEDS_CONFIRMATION");
  const yes = held.json.details.confirmToken as string;
  const [still] = await sql`SELECT status FROM tasks WHERE id = ${task!.id}`;
  assert.equal(still!.status, "in_progress", "nothing changed yet");
  const other = await call(taskUpdate.PATCH, token, "PATCH", "/api/v1/extension/task-update", { ...body, expectedUpdatedAt: new Date(new Date(task!.updated_at).getTime() + 1).toISOString() }, { "x-nb-confirm": yes });
  assert.equal(other.status, 428, "a yes for one change doesn't cover another");
  const done = await call(taskUpdate.PATCH, token, "PATCH", "/api/v1/extension/task-update", body, { "x-nb-confirm": yes });
  assert.equal(done.status, 200, JSON.stringify(done.json));
  assert.ok(done.json.data.undoToken);
  const [after1] = await sql`SELECT status FROM tasks WHERE id = ${task!.id}`;
  assert.equal(after1!.status, "done");
  const back = await undoCall(token, done.json.data.undoToken);
  assert.equal(back.status, 200, JSON.stringify(back.json));
  const [after2] = await sql`SELECT status FROM tasks WHERE id = ${task!.id}`;
  assert.equal(after2!.status, "in_progress", "undo moved it back through the task rules");
});

// Found approving an agent's "finish" from the terminal (2026-11-10): `nb task done -m … --check …` gives each check a
// fresh id and time on every run, so the yes for the first run never matched the second.
test("a yes for finishing a task still matches when the checks get new ids and times, not when the report changes", async () => {
  const userId = await sql.begin((tx) => createUser(tx));
  const projectId = await sql.begin((tx) => createProject(tx, userId));
  const token = await agentToken(userId, projectId, ["workspace:read", "task:read", "task:write", "task:complete"]);
  const [task] = await sql`INSERT INTO tasks (workspace_id, title, status, assignee_id) VALUES (${projectId}, 'Ship', 'in_progress', ${userId}) RETURNING id, updated_at`;
  const run = (summary: string) => {
    const now = Date.now() + Math.floor(Math.random() * 1000);
    return {
      kind: "status", projectId, taskId: task!.id, status: "done", expectedUpdatedAt: new Date(task!.updated_at).toISOString(),
      evidence: { summary, issues: "", fingerprint: "f".repeat(64), receipts: [],
        checks: [{ id: crypto.randomUUID(), taskName: "spelling", fingerprint: "a".repeat(64), startedAt: now, endedAt: now, exitCode: 0 }] },
    };
  };
  const held = await call(taskUpdate.PATCH, token, "PATCH", "/api/v1/extension/task-update", run("Drafted the note"));
  assert.equal(held.status, 428, JSON.stringify(held.json));
  const yes = held.json.details.confirmToken as string;
  const changed = await call(taskUpdate.PATCH, token, "PATCH", "/api/v1/extension/task-update", run("Something else"), { "x-nb-confirm": yes });
  assert.equal(changed.status, 428, "a different report is a different change");
  const again = await call(taskUpdate.PATCH, token, "PATCH", "/api/v1/extension/task-update", run("Drafted the note"));
  const yes2 = again.json.details.confirmToken as string;
  const done = await call(taskUpdate.PATCH, token, "PATCH", "/api/v1/extension/task-update", run("Drafted the note"), { "x-nb-confirm": yes2 });
  assert.equal(done.status, 200, JSON.stringify(done.json));
});

test("'Ask for everything' holds even a comment-sized change; 'Pause agents' stops all agent requests", async () => {
  const userId = await sql.begin((tx) => createUser(tx));
  const projectId = await sql.begin((tx) => createProject(tx, userId));
  const token = await agentToken(userId, projectId);
  await sql`UPDATE workspaces SET agent_policy = 'ask_all' WHERE id = ${projectId}`;
  assert.equal((await call(createTask.POST, token, "POST", "/api/v1/extension/create-task", { projectId, title: "x" })).status, 428);
  await sql`UPDATE workspaces SET agents_paused_at = now() WHERE id = ${projectId}`;
  const paused = await call(createTask.POST, token, "POST", "/api/v1/extension/create-task", { projectId, title: "x" });
  assert.equal(paused.status, 403);
  assert.equal(paused.json.errorCode, "AGENTS_PAUSED");
});

test("pushing a new version undoes back to the old one, and refuses if someone saved since", async () => {
  const userId = await sql.begin((tx) => createUser(tx));
  const projectId = await sql.begin((tx) => createProject(tx, userId));
  const token = await agentToken(userId, projectId);
  const file = (text: string, baseVersion?: number) => ({ path: "/notes.md", contentHash: hash(text), size: text.length, mimeType: "text/markdown", contentBase64: Buffer.from(text).toString("base64"), ...(baseVersion ? { baseVersion } : {}) });
  const v1 = await call(place.POST, token, "POST", "/api/v1/files/place", { projectId, message: "v1", files: [file("one")] });
  assert.equal(v1.status, 200, JSON.stringify(v1.json));
  const v2 = await call(place.POST, token, "POST", "/api/v1/files/place", { projectId, message: "v2", files: [file("two", 1)] });
  assert.equal(v2.status, 200, JSON.stringify(v2.json));
  const back = await undoCall(token, v2.json.data.undoToken);
  assert.equal(back.status, 200, JSON.stringify(back.json));
  const [node] = await sql`SELECT n.current_version, v.content_hash, (SELECT count(*)::int FROM file_versions h WHERE h.node_id = n.id) AS versions FROM workspace_nodes n JOIN file_versions v ON v.node_id = n.id AND v.version = n.current_version WHERE n.workspace_id = ${projectId} AND n.path = '/notes.md'`;
  assert.deepEqual([node!.current_version, node!.content_hash, node!.versions], [1, hash("one"), 2], "v1 is active again; v2 stays in the history");
  const v3 = await call(place.POST, token, "POST", "/api/v1/files/place", { projectId, message: "v3", files: [file("three", 1)] });
  assert.equal(v3.json.data.files[0].version, 3, "the next save is numbered after the whole history");
  assert.equal((await undoCall(token, v1.json.data.undoToken)).status, 409, "v1's push can't be undone: a newer version is active");

  const finals = await agentToken(userId, projectId, ["workspace:read", "file:read", "file:write", "file:final"]);
  const final = await call(place.POST, finals, "POST", "/api/v1/files/place", { projectId, message: "final", role: "final", files: [{ ...file("report"), path: "/report.md" }] });
  assert.equal(final.status, 428, "final files need a yes");
});

test("an agent's README edit asks 'Change the README (+1 −1 lines)' with the diff, not 'Push 1 file' (report D4, 0.8 #13)", async () => {
  const userId = await sql.begin((tx) => createUser(tx));
  const projectId = await sql.begin((tx) => createProject(tx, userId));
  const docs = await agentToken(userId, projectId, ["workspace:read", "file:read", "file:write", "doc:write"]);
  const file = (text: string, baseVersion?: number) => ({ path: "/README.md", contentHash: hash(text), size: text.length, mimeType: "text/markdown", contentBase64: Buffer.from(text).toString("base64"), ...(baseVersion ? { baseVersion } : {}) });
  const v1 = await call(place.POST, docs, "POST", "/api/v1/files/place", { projectId, message: "v1", files: [file("# App\nOld line\n")] });
  assert.equal(v1.status, 200, JSON.stringify(v1.json));
  const [node] = await sql`SELECT id FROM workspace_nodes WHERE workspace_id = ${projectId} AND path = '/README.md'`;
  await sql`INSERT INTO workspace_documents (workspace_id, linked_node_id) VALUES (${projectId}, ${node!.id})`;
  const held = await call(place.POST, docs, "POST", "/api/v1/files/place", { projectId, message: "v2", files: [file("# App\nNew line\n", 1)] });
  assert.equal(held.status, 428, JSON.stringify(held.json));
  assert.equal(held.json.details?.summary ?? held.json.summary, "Change the README (+1 −1 lines)", JSON.stringify(held.json));
  assert.match(JSON.stringify(held.json), /-Old line.*\+New line/);
});

test("finishing names the task by number and title (report D4)", async () => {
  const userId = await sql.begin((tx) => createUser(tx));
  const projectId = await sql.begin((tx) => createProject(tx, userId));
  const token = await agentToken(userId, projectId, ["workspace:read", "task:read", "task:write", "task:complete"]);
  const [task] = await sql`INSERT INTO tasks (workspace_id, title, status, assignee_id, task_number) VALUES (${projectId}, 'Logo', 'in_progress', ${userId}, 4) RETURNING id, updated_at`;
  const held = await call(taskUpdate.PATCH, token, "PATCH", "/api/v1/extension/task-update", { kind: "status", projectId, taskId: task!.id, status: "done", expectedUpdatedAt: new Date(task!.updated_at).toISOString() });
  assert.equal(held.status, 428, JSON.stringify(held.json));
  assert.match(held.json.message, /Finish #4 "Logo"/);
});

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

let actingUser = "";
let route: typeof import("../../src/app/api/v1/extension/task-push/route");
before(async () => {
  const shared = await loadAppModule(() => import("../../src/app/api/v1/_shared"));
  moduleStubs.set("@/app/api/v1/_shared", {
    ...shared,
    requireAuthenticatedUser: async () => ({ user: { id: actingUser }, extensionSessionId: "ext", response: null }),
  });
  moduleStubs.set("@/lib/security/csrf", { validateCsrf: () => null });
  moduleStubs.set("@/lib/security/rate-limit", { consumeRateLimit: async () => ({ allowed: true }) });
  route = await loadAppModule(() => import("../../src/app/api/v1/extension/task-push/route"));
});
after(async () => { await sql.end(); await closeAppDb(); });

const HASH = "a".repeat(64);
const push = (body: unknown, key: string | null = randomUUID()) =>
  route.POST(new Request("https://app.test/api/v1/extension/task-push", {
    method: "POST",
    headers: { "content-type": "application/json", ...(key ? { "idempotency-key": key } : {}) },
    body: JSON.stringify(body),
  }));

async function fixture() {
  const owner = await sql.begin((tx) => createUser(tx));
  const projectId = await sql.begin((tx) => createProject(tx, owner));
  const [task] = await sql`INSERT INTO tasks (project_id, title) VALUES (${projectId}, 't') RETURNING id`;
  const [node] = await sql`INSERT INTO project_nodes (project_id, type, name, path, created_by, current_version)
    VALUES (${projectId}, 'file', 'real-name.ts', '/real-name.ts', ${owner}, 1) RETURNING id`;
  await sql`INSERT INTO file_versions (node_id, version, s3_key, size, mime_type, uploaded_by, content_hash)
    VALUES (${node!.id}, 1, ${`projects/${projectId}/files/real-name.ts`}, 1, 'text/plain', ${owner}, ${HASH})`;
  const cleanup = async () => {
    await sql`DELETE FROM task_pushes WHERE project_id = ${projectId}`;
    await sql`DELETE FROM task_node_links WHERE task_id = ${task!.id}`;
    await sql`DELETE FROM node_events WHERE project_id = ${projectId}`.catch(() => undefined);
    await sql`DELETE FROM file_versions WHERE node_id = ${node!.id}`;
    await sql`DELETE FROM project_nodes WHERE project_id = ${projectId}`;
    await sql`DELETE FROM tasks WHERE project_id = ${projectId}`;
  };
  return { owner, projectId, taskId: task!.id as string, nodeId: node!.id as string, cleanup };
}

// VALID-002: one bounded schema; node metadata comes from the server, never from the client.
test("the push is bounded and validated before any work", async () => {
  const f = await fixture();
  try {
    actingUser = f.owner;
    const base = { taskId: f.taskId, projectId: f.projectId, taskAction: "upload_to_task", files: [{ nodeId: f.nodeId, version: 1, contentHash: HASH }] };
    assert.equal((await push({ ...base, files: Array.from({ length: 101 }, () => base.files[0]) })).status, 400);
    assert.equal((await push({ ...base, taskAction: "delete_everything" })).status, 400);
    assert.equal((await push({ ...base, files: [{ nodeId: "not-a-uuid", version: 1, contentHash: HASH }] })).status, 400);
    assert.equal((await push({ ...base, message: "x".repeat(501) })).status, 400);
    assert.equal((await push(base, null)).status, 400, "a stable operation id is required");
  } finally { await f.cleanup(); }
});

test("a receipt records server-derived metadata, links the file, and replays by operation id", async () => {
  const f = await fixture();
  try {
    actingUser = f.owner;
    const key = randomUUID();
    const body = { taskId: f.taskId, projectId: f.projectId, taskAction: "upload_to_task", files: [{ nodeId: f.nodeId, version: 1, contentHash: HASH, name: "client-lie.exe", path: "/evil" }] };
    const first = await push(body, key);
    assert.equal(first.status, 200);
    const [recorded] = await sql`SELECT files_json FROM task_pushes WHERE task_id = ${f.taskId}`;
    assert.equal(recorded!.files_json[0].name, "real-name.ts");
    assert.equal(recorded!.files_json[0].path, "/real-name.ts");
    assert.equal((await sql`SELECT 1 FROM task_node_links WHERE task_id = ${f.taskId} AND node_id = ${f.nodeId}`).length, 1);

    assert.equal((await push(body, key)).status, 200);
    assert.equal((await sql`SELECT 1 FROM task_pushes WHERE task_id = ${f.taskId}`).length, 1);
  } finally { await f.cleanup(); }
});

test("a stale hash, another project's file, or a non-writer is refused with nothing recorded", async () => {
  const f = await fixture();
  const other = await fixture();
  try {
    actingUser = f.owner;
    const base = { taskId: f.taskId, projectId: f.projectId, taskAction: "replace_task_version" };
    assert.notEqual((await push({ ...base, files: [{ nodeId: f.nodeId, version: 1, contentHash: "b".repeat(64) }] })).status, 200);
    assert.notEqual((await push({ ...base, files: [{ nodeId: other.nodeId, version: 1, contentHash: HASH }] })).status, 200);
    actingUser = other.owner;
    assert.notEqual((await push({ ...base, files: [{ nodeId: f.nodeId, version: 1, contentHash: HASH }] })).status, 200);
    assert.equal((await sql`SELECT 1 FROM task_pushes WHERE project_id = ${f.projectId}`).length, 0);
    assert.equal((await sql`SELECT 1 FROM task_node_links WHERE task_id = ${f.taskId}`).length, 0);
  } finally { await f.cleanup(); await other.cleanup(); }
});

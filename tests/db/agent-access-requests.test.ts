import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// Report A5 "Asking for more", A6 #3, A10: a missing permission becomes a request in the person's inbox, answered
// Allow once (the same method and path, once, within an hour), Always (adds the permission) or No (24 hours quiet).
let headerValues: Record<string, string> = {};
moduleStubs.set("next/headers", { headers: async () => ({ get: (name: string) => headerValues[name.toLowerCase()] ?? null }), cookies: async () => ({ getAll: () => [], get: () => undefined, set: () => undefined }) });
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("@/lib/security/csrf", { validateCsrf: () => null });

let taskUpdate: typeof import("../../src/app/api/v1/extension/task-update/route");
let requests: typeof import("../../src/lib/agents/access-requests");
before(async () => {
  taskUpdate = await loadAppModule(() => import("../../src/app/api/v1/extension/task-update/route"));
  requests = await loadAppModule(() => import("../../src/lib/agents/access-requests"));
});
after(async () => { await sql.end(); await closeAppDb(); });

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
async function smallAgent(userId: string, workspaceId: string) {
  const token = `nb_agt_${randomUUID().replace(/-/g, "")}`;
  const [row] = await sql`INSERT INTO extension_device_sessions (user_id, token_hash, token_prefix, device_name, client_version, expires_at, token_type, agent_name, workspace_id, scopes)
            VALUES (${userId}, ${hash(token)}, ${token.slice(0, 11)}, 'laptop', '2.0.4', now() + interval '1 day', 'agent', 'Claude Code', ${workspaceId}, ${sql.json(["workspace:read", "task:read", "task:write", "file:read", "file:write"])}) RETURNING id`;
  return { token, sessionId: row!.id as string };
}
async function finish(token: string, projectId: string, taskId: string, extra: Record<string, string> = {}) {
  headerValues = { authorization: `Bearer ${token}`, "x-networkbase-request-method": "PATCH", "x-networkbase-request-target": "/api/v1/extension/task-update", ...extra };
  const [task] = await sql`SELECT updated_at FROM tasks WHERE id = ${taskId}`;
  const body = { kind: "status", projectId, taskId, status: "done", expectedUpdatedAt: new Date(task!.updated_at).toISOString() };
  const res = await taskUpdate.PATCH(new Request("https://app.test/api/v1/extension/task-update", { method: "PATCH", headers: { "content-type": "application/json", "idempotency-key": randomUUID(), ...extra }, body: JSON.stringify(body) }));
  return { status: res.status, json: await res.json() };
}
async function world() {
  const userId = await sql.begin((tx) => createUser(tx));
  const projectId = await sql.begin((tx) => createProject(tx, userId));
  const [task] = await sql`INSERT INTO tasks (workspace_id, title, status, assignee_id) VALUES (${projectId}, 'Fix login', 'in_progress', ${userId}) RETURNING id`;
  return { userId, projectId, taskId: task!.id as string };
}

test("a missing permission asks the person, and the inbox gets one item", async () => {
  const w = await world();
  const agent = await smallAgent(w.userId, w.projectId);
  const asked = await finish(agent.token, w.projectId, w.taskId);
  assert.equal(asked.status, 403);
  assert.equal(asked.json.errorCode, "ACCESS_REQUESTED");
  assert.equal(asked.json.details.scope, "task:complete");
  const again = await finish(agent.token, w.projectId, w.taskId);
  assert.equal(again.json.details.requestId, asked.json.details.requestId, "the same ask is not repeated");
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM agent_access_requests WHERE session_id = ${agent.sessionId}`;
  assert.equal(n, 1);
  const notes = await sql`SELECT title FROM user_notifications WHERE user_id = ${w.userId} AND kind = 'agent_access_request'`;
  assert.deepEqual(notes.map((r) => r.title), ["Claude Code asks to also finish tasks"]);
});

test("Allow once lets the same request through one time", async () => {
  const w = await world();
  const agent = await smallAgent(w.userId, w.projectId);
  const { requestId } = (await finish(agent.token, w.projectId, w.taskId)).json.details;
  await requests.decideAgentAccessRequest(w.userId, requestId, "once");
  const allowed = await finish(agent.token, w.projectId, w.taskId, { "x-nb-access-request": requestId });
  assert.notEqual(allowed.json.errorCode, "ACCESS_REQUESTED");
  assert.notEqual(allowed.json.errorCode, "SCOPE_MISSING");
  assert.equal(allowed.status, 200, "Allow once is the person's yes, so no second confirmation");
  const [done] = await sql`SELECT status FROM tasks WHERE id = ${w.taskId}`;
  assert.equal(done!.status, "done");
  await sql`UPDATE tasks SET status = 'in_progress' WHERE id = ${w.taskId}`;
  const twice = await finish(agent.token, w.projectId, w.taskId, { "x-nb-access-request": requestId });
  assert.equal(twice.status, 403, "once means once");
});

test("Allow once also covers a plain retry of the same request, as the hosted MCP sends it", async () => {
  const w = await world();
  const agent = await smallAgent(w.userId, w.projectId);
  const { requestId } = (await finish(agent.token, w.projectId, w.taskId)).json.details;
  await requests.decideAgentAccessRequest(w.userId, requestId, "once");
  assert.equal((await finish(agent.token, w.projectId, w.taskId)).status, 200);
});

test("Always adds the permission; No keeps quiet for 24 hours", async () => {
  const w = await world();
  const yes = await smallAgent(w.userId, w.projectId);
  const { requestId } = (await finish(yes.token, w.projectId, w.taskId)).json.details;
  await requests.decideAgentAccessRequest(w.userId, requestId, "always");
  const [session] = await sql`SELECT scopes FROM extension_device_sessions WHERE id = ${yes.sessionId}`;
  assert.ok((session!.scopes as string[]).includes("task:complete"));

  // A sign-in stored with no scopes has the base ones; Always adds to them, never replaces them.
  const bare = await smallAgent(w.userId, w.projectId);
  await sql`UPDATE extension_device_sessions SET scopes = '[]'::jsonb WHERE id = ${bare.sessionId}`;
  const ask = await requests.requestAccess({ sessionId: bare.sessionId, userId: w.userId, scope: "task:complete", method: "PATCH", path: "/x", agentName: "Claude Code" });
  await requests.decideAgentAccessRequest(w.userId, (ask as { requestId: string }).requestId, "always");
  const [b] = await sql`SELECT scopes FROM extension_device_sessions WHERE id = ${bare.sessionId}`;
  assert.ok(["task:write", "file:write", "task:complete"].every((s) => (b!.scopes as string[]).includes(s)), JSON.stringify(b!.scopes));

  const no = await smallAgent(w.userId, w.projectId);
  const asked = (await finish(no.token, w.projectId, w.taskId)).json.details;
  await requests.decideAgentAccessRequest(w.userId, asked.requestId, "no");
  const after = await finish(no.token, w.projectId, w.taskId);
  assert.equal(after.json.errorCode, "ACCESS_DENIED_BY_PERSON");
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM agent_access_requests WHERE session_id = ${no.sessionId}`;
  assert.equal(n, 1, "no new request after No");
});

test("at most 3 open requests per sign-in, and only the owner answers", async () => {
  const w = await world();
  const agent = await smallAgent(w.userId, w.projectId);
  for (const scope of ["task:complete", "file:final", "doc:write"]) {
    assert.ok("requestId" in (await requests.requestAccess({ sessionId: agent.sessionId, userId: w.userId, scope, method: "POST", path: `/x/${scope}`, agentName: "Claude Code" })));
  }
  assert.deepEqual(await requests.requestAccess({ sessionId: agent.sessionId, userId: w.userId, scope: "task:review", method: "POST", path: "/y", agentName: "Claude Code" }), { blocked: "limit" });
  const stranger = await sql.begin((tx) => createUser(tx));
  const [open] = await sql`SELECT id FROM agent_access_requests WHERE session_id = ${agent.sessionId} LIMIT 1`;
  await assert.rejects(requests.decideAgentAccessRequest(stranger, open!.id, "always"), /not found/i);
});

test("a request runs out after 24 hours: no answer, and the agent may ask again", async () => {
  const w = await world();
  const agent = await smallAgent(w.userId, w.projectId);
  const ask = { sessionId: agent.sessionId, userId: w.userId, scope: "task:complete", method: "PATCH", path: "/api/v1/extension/task-update", agentName: "Claude Code" };
  const first = await requests.requestAccess(ask);
  assert.ok("requestId" in first);
  const later = new Date(Date.now() + 25 * 60 * 60_000);
  assert.deepEqual(await requests.openAccessRequests(w.userId, agent.sessionId, later), []);
  await assert.rejects(requests.decideAgentAccessRequest(w.userId, first.requestId, "always", later), /not found/i);
  const again = await requests.requestAccess(ask, later);
  assert.ok("requestId" in again && again.requestId !== first.requestId);
  const [old] = await sql`SELECT status FROM agent_access_requests WHERE id = ${first.requestId}`;
  assert.equal(old!.status, "expired");
});

test("only what a preset could allow can be asked for: approving a review stays a plain refusal", async () => {
  const w = await world();
  const agent = await smallAgent(w.userId, w.projectId);
  headerValues = { authorization: `Bearer ${agent.token}`, "x-networkbase-request-method": "PATCH", "x-networkbase-request-target": "/api/v1/extension/task-update" };
  const [task] = await sql`SELECT updated_at FROM tasks WHERE id = ${w.taskId}`;
  const res = await taskUpdate.PATCH(new Request("https://app.test/api/v1/extension/task-update", { method: "PATCH", headers: { "content-type": "application/json", "idempotency-key": randomUUID() }, body: JSON.stringify({ kind: "approve", projectId: w.projectId, taskId: w.taskId, expectedUpdatedAt: new Date(task!.updated_at).toISOString() }) }));
  assert.equal((await res.json()).errorCode, "SCOPE_MISSING");
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM agent_access_requests WHERE session_id = ${agent.sessionId}`;
  assert.equal(n, 0);
});

test("a Read only agent can ask to change tasks (report A10 live check)", async () => {
  const w = await world();
  const agent = await smallAgent(w.userId, w.projectId);
  await sql`UPDATE extension_device_sessions SET scopes = ${sql.json(["workspace:read", "task:read", "file:read"])} WHERE id = ${agent.sessionId}`;
  const asked = await finish(agent.token, w.projectId, w.taskId);
  assert.equal(asked.json.errorCode, "ACCESS_REQUESTED");
  assert.equal(asked.json.details.scope, "task:write");
  const notes = await sql`SELECT title FROM user_notifications WHERE user_id = ${w.userId} AND kind = 'agent_access_request'`;
  assert.deepEqual(notes.map((r) => r.title), ["Claude Code asks to also change tasks"]);
});

test("Allow once covers every token check inside the same request, not the next request (found live)", async () => {
  const w = await world();
  const agent = await smallAgent(w.userId, w.projectId);
  await sql`UPDATE extension_device_sessions SET scopes = ${sql.json(["workspace:read", "task:read", "file:read"])} WHERE id = ${agent.sessionId}`;
  const shared = await loadAppModule(() => import("../../src/app/api/v1/_shared"));
  const as = (rid: string) => { headerValues = { authorization: `Bearer ${agent.token}`, "x-networkbase-request-method": "POST", "x-networkbase-request-target": "/api/v1/extension/create-task", "x-networkbase-request-id": rid }; };
  as("r1");
  const asked = await shared.requireAuthenticatedUser();
  const { requestId } = await asked.response!.json().then((b: { details: { requestId: string } }) => b.details);
  await requests.decideAgentAccessRequest(w.userId, requestId, "once");
  as("r2");
  assert.ok((await shared.requireAuthenticatedUser()).user, "the route's own check");
  assert.ok((await shared.requireAuthenticatedUser()).user, "the action's check in the same request");
  as("r3");
  assert.equal((await shared.requireAuthenticatedUser()).user, null, "a new request needs a new answer");
});

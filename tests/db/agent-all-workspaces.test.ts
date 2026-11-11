import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// Report A5, A7: an agent approved for "All my workspaces" (workspace_id NULL) is checked on every request against
// the workspace that request touches: paused workspaces and organizations that turned agents off refuse it, routes
// with no agent mode refuse it, and the lists leave those workspaces out. One-workspace tokens behave as before.
let headerValues: Record<string, string> = {};
moduleStubs.set("next/headers", { headers: async () => ({ get: (name: string) => headerValues[name.toLowerCase()] ?? null }), cookies: async () => ({ getAll: () => [], get: () => undefined, set: () => undefined }) });
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("@/lib/security/csrf", { validateCsrf: () => null });

let workspace: typeof import("../../src/app/api/v1/workspaces/[id]/route");
let createTask: typeof import("../../src/app/api/v1/extension/create-task/route");
let projectTasks: typeof import("../../src/app/api/v1/extension/project-tasks/route");
let workspaces: typeof import("../../src/app/api/v1/extension/workspaces/route");
let count: typeof import("../../src/app/api/v1/tasks/count/route");
before(async () => {
  workspace = await loadAppModule(() => import("../../src/app/api/v1/workspaces/[id]/route"));
  createTask = await loadAppModule(() => import("../../src/app/api/v1/extension/create-task/route"));
  projectTasks = await loadAppModule(() => import("../../src/app/api/v1/extension/project-tasks/route"));
  workspaces = await loadAppModule(() => import("../../src/app/api/v1/extension/workspaces/route"));
  count = await loadAppModule(() => import("../../src/app/api/v1/tasks/count/route"));
});
after(async () => { await sql.end(); await closeAppDb(); });

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
async function agentToken(userId: string, workspaceId: string | null, scopes: string[] = []) {
  const token = `nb_agt_${randomUUID().replace(/-/g, "")}`;
  await sql`INSERT INTO extension_device_sessions (user_id, token_hash, token_prefix, device_name, client_version, expires_at, token_type, agent_name, workspace_id, all_workspaces, scopes)
            VALUES (${userId}, ${hash(token)}, ${token.slice(0, 11)}, 'laptop', '2.0.4', now() + interval '1 day', 'agent', 'Claude Code', ${workspaceId}, ${workspaceId === null}, ${sql.json(scopes)})`;
  return token;
}
const call = async (handler: (r: Request, c?: any) => Promise<Response>, token: string, method: string, path: string, body?: unknown, ctx?: unknown) => {
  headerValues = { authorization: `Bearer ${token}`, "x-networkbase-request-method": method, "x-networkbase-request-target": path };
  const res = await handler(new Request(`https://app.test${path}`, { method, headers: { "content-type": "application/json", "idempotency-key": randomUUID() }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), ctx);
  return { status: res.status, json: await res.json() };
};
const view = (token: string, id: string) => call(workspace.GET, token, "GET", `/api/v1/workspaces/${id}`, undefined, { params: Promise.resolve({ id }) });
const create = (token: string, projectId: string) => call(createTask.POST, token, "POST", "/api/v1/extension/create-task", { projectId, title: "From an agent" });

async function world() {
  const userId = await sql.begin((tx) => createUser(tx));
  const a = await sql.begin((tx) => createProject(tx, userId));
  const b = await sql.begin((tx) => createProject(tx, userId));
  const paused = await sql.begin((tx) => createProject(tx, userId));
  await sql`UPDATE workspaces SET agents_paused_at = now() WHERE id = ${paused}`;
  const org = await sql.begin((tx) => createProject(tx, userId));
  await sql`UPDATE workspaces SET kind = 'organization', org_settings = ${sql.json({ allowAgentTokens: false })} WHERE id = ${org}`;
  const inOrg = await sql.begin((tx) => createProject(tx, userId));
  await sql`UPDATE workspaces SET parent_id = ${org} WHERE id = ${inOrg}`;
  return { userId, a, b, paused, inOrg };
}

test("an all-workspaces agent reads and writes in any workspace it may reach", async () => {
  const w = await world();
  const token = await agentToken(w.userId, null);
  assert.equal((await view(token, w.a)).status, 200);
  assert.equal((await view(token, w.b)).status, 200);
  assert.equal((await create(token, w.a)).status, 200);
  assert.equal((await create(token, w.b)).status, 200);
});

test("paused workspaces and organizations that turned agents off refuse it, on path and body routes alike", async () => {
  const w = await world();
  const token = await agentToken(w.userId, null);
  assert.equal((await view(token, w.paused)).json.errorCode, "AGENTS_PAUSED");
  assert.equal((await create(token, w.paused)).json.errorCode, "AGENTS_PAUSED");
  assert.equal((await view(token, w.inOrg)).json.errorCode, "AGENT_NOT_ALLOWED");
  assert.equal((await create(token, w.inOrg)).json.errorCode, "AGENT_NOT_ALLOWED");
});

test("routes with no agent mode refuse it", async () => {
  const w = await world();
  const token = await agentToken(w.userId, null);
  const res = await call(projectTasks.GET, token, "GET", `/api/v1/extension/project-tasks?projectId=${w.a}`);
  assert.equal(res.status, 403);
  assert.equal(res.json.errorCode, "WORKSPACE_NOT_ALLOWED");
});

test("lists leave out paused and agents-off workspaces", async () => {
  const w = await world();
  const token = await agentToken(w.userId, null);
  const listed = (await call(workspaces.GET, token, "GET", "/api/v1/extension/workspaces")).json.data.workspaces.map((x: { id: string }) => x.id).sort();
  assert.deepEqual(listed, [w.a, w.b].sort());
  await sql`INSERT INTO tasks (workspace_id, title, status, assignee_id) VALUES (${w.a}, 'mine', 'todo', ${w.userId}), (${w.paused}, 'paused', 'todo', ${w.userId}), (${w.inOrg}, 'org', 'todo', ${w.userId})`;
  assert.equal((await call(count.GET, token, "GET", "/api/v1/tasks/count")).json.data.open, 1);
});

test("one-workspace agents behave exactly as before; Read only can't write", async () => {
  const w = await world();
  const bound = await agentToken(w.userId, w.a);
  assert.equal((await view(bound, w.a)).status, 200);
  assert.equal((await view(bound, w.b)).json.errorCode, "WORKSPACE_NOT_ALLOWED");
  assert.equal((await create(bound, w.b)).json.errorCode, "WORKSPACE_NOT_ALLOWED");
  const readOnly = await agentToken(w.userId, null, ["workspace:read", "task:read", "file:read"]);
  assert.equal((await view(readOnly, w.a)).status, 200);
  const refused = await create(readOnly, w.a);
  assert.equal(refused.status, 403);
  assert.match(refused.json.errorCode, /SCOPE_MISSING|ACCESS_REQUESTED/);
});

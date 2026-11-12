import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// Report A3.1–A3.3: sign-in with a code (pending → approved → token once), and agent tokens that stay inside the
// workspace they were approved for, whether the workspace comes from the query, the body or a task.
let headerValues: Record<string, string> = {};
moduleStubs.set("next/headers", { headers: async () => ({ get: (name: string) => headerValues[name.toLowerCase()] ?? null }), cookies: async () => ({ getAll: () => [], get: () => undefined, set: () => undefined }) });
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("@/lib/security/csrf", { validateCsrf: () => null });

let codeRoute: typeof import("../../src/app/api/v1/device/code/route");
let tokenRoute: typeof import("../../src/app/api/v1/device/token/route");
let lib: typeof import("../../src/lib/extension/device-codes");
let workspaceTasks: typeof import("../../src/app/api/v1/extension/workspace-tasks/route");
let createTask: typeof import("../../src/app/api/v1/extension/create-task/route");
let subtask: typeof import("../../src/app/api/v1/extension/task-subtask/route");
let workspacesList: typeof import("../../src/app/api/v1/extension/workspaces/route");
before(async () => {
  codeRoute = await loadAppModule(() => import("../../src/app/api/v1/device/code/route"));
  tokenRoute = await loadAppModule(() => import("../../src/app/api/v1/device/token/route"));
  lib = await loadAppModule(() => import("../../src/lib/extension/device-codes"));
  workspaceTasks = await loadAppModule(() => import("../../src/app/api/v1/extension/workspace-tasks/route"));
  createTask = await loadAppModule(() => import("../../src/app/api/v1/extension/create-task/route"));
  subtask = await loadAppModule(() => import("../../src/app/api/v1/extension/task-subtask/route"));
  workspacesList = await loadAppModule(() => import("../../src/app/api/v1/extension/workspaces/route"));
});
after(async () => { await sql.end(); await closeAppDb(); });

const post = (url: string, body: unknown) => new Request(`https://app.test${url}`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": randomUUID() }, body: JSON.stringify(body) });
const as = (token: string, method: string, target: string) => {
  headerValues = { authorization: `Bearer ${token}`, "x-networkbase-request-method": method, "x-networkbase-request-target": target };
};

async function startCode(type: "device" | "agent" = "agent") {
  headerValues = {};
  const res = await codeRoute.POST(post("/api/v1/device/code", { clientName: "NetworkBase CLI", deviceName: "build-box", clientVersion: "2.0.0", platform: "linux", type, agentName: type === "agent" ? "Claude Code" : null }));
  const json = await res.json();
  assert.equal(res.status, 200, JSON.stringify(json));
  assert.match(json.data.userCode, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.match(json.data.verificationUriComplete, /\/device\?code=/);
  return json.data as { deviceCode: string; userCode: string };
}
const poll = async (deviceCode: string, renew?: string) => {
  const res = await tokenRoute.POST(post("/api/v1/device/token", { deviceCode, ...(renew ? { renew } : {}) }));
  return { status: res.status, json: await res.json() };
};

test("a code goes pending → approved → token once, then it's used up", async () => {
  const userId = await sql.begin((tx) => createUser(tx));
  const projectId = await sql.begin((tx) => createProject(tx, userId));
  const { deviceCode, userCode } = await startCode();
  assert.equal((await poll(deviceCode)).json.data.status, "pending");
  assert.equal((await poll(deviceCode)).json.data.status, "slow_down", "polling faster than every 5 s");
  assert.ok(await lib.findPendingDeviceCode(userCode.toLowerCase().replace("-", " ")), "the page finds it however it's typed");
  assert.equal(await lib.decideDeviceCode(userId, userCode, { decision: "approve", type: "agent", access: "custom", workspace: projectId, expiryDays: 30, extraScopes: ["doc:write"] }), true);
  const approved = await poll(deviceCode);
  assert.equal(approved.json.data.status, "approved", JSON.stringify(approved.json));
  assert.match(approved.json.data.token, /^nb_agt_[0-9a-f]{48}$/);
  const [session] = await sql`SELECT token_type, workspace_id, scopes, agent_name, token_hash FROM extension_device_sessions WHERE user_id = ${userId}`;
  assert.equal(session!.token_type, "agent");
  assert.equal(session!.workspace_id, projectId);
  assert.deepEqual([...session!.scopes].sort(), ["doc:write", "file:read", "file:write", "task:read", "task:write", "workspace:read"]);
  assert.ok(!JSON.stringify(await sql`SELECT * FROM device_codes WHERE user_code = ${userCode}`).includes(approved.json.data.token), "the token isn't stored");
  assert.equal((await poll(deviceCode)).status, 410, "a second poll gets nothing");
  assert.equal(await lib.decideDeviceCode(userId, userCode, { decision: "deny" }), false, "can't be decided again");
});

test("nb login on the same computer renews its sign-in: the old one closes, never someone else's (C6)", async () => {
  const [userId, other] = await Promise.all([1, 2].map(() => sql.begin((tx) => createUser(tx))));
  const signIn = async (who: string, renew?: string) => {
    const { deviceCode, userCode } = await startCode("device");
    await lib.decideDeviceCode(who, userCode, { decision: "approve", type: "device" });
    await new Promise((r) => setTimeout(r, 0));
    const res = await poll(deviceCode, renew);
    assert.equal(res.json.data.status, "approved", JSON.stringify(res.json));
    return res.json.data.token as string;
  };
  const first = await signIn(userId!);
  const second = await signIn(userId!, first);
  const open = await sql`SELECT token_prefix FROM extension_device_sessions WHERE user_id = ${userId!} AND revoked_at IS NULL`;
  assert.deepEqual(open.map((r) => r.token_prefix), [second.slice(0, 11)], "one sign-in for this computer");
  const theirs = await signIn(other!);
  await signIn(userId!, theirs);
  const [still] = await sql`SELECT revoked_at FROM extension_device_sessions WHERE user_id = ${other!}`;
  assert.equal(still!.revoked_at, null, "a token of another person's is never closed");
});

test("denied and expired codes say so", async () => {
  const userId = await sql.begin((tx) => createUser(tx));
  const denied = await startCode("device");
  assert.equal(await lib.decideDeviceCode(userId, denied.userCode, { decision: "deny" }), true);
  assert.equal((await poll(denied.deviceCode)).status, 403);
  const old = await lib.createDeviceCode({ clientName: "CLI", deviceName: "x" }, new Date(Date.now() - 11 * 60_000));
  assert.equal((await poll(old.deviceCode)).status, 410);
  assert.equal(await lib.findPendingDeviceCode(old.userCode), null);
  assert.equal(await lib.decideDeviceCode(userId, old.userCode, { decision: "approve", type: "device" }), false);
});

test("an agent token stays in its workspace: query, body and task ids, and the workspace list", async () => {
  const userId = await sql.begin((tx) => createUser(tx));
  const mine = await sql.begin((tx) => createProject(tx, userId));
  const other = await sql.begin((tx) => createProject(tx, userId));
  const { deviceCode, userCode } = await startCode();
  await lib.decideDeviceCode(userId, userCode, { decision: "approve", type: "agent", access: "small", workspace: mine, expiryDays: 7 });
  const token = (await poll(deviceCode)).json.data.token as string;

  as(token, "GET", `/api/v1/extension/workspace-tasks?projectId=${other}`);
  const queryOther = await workspaceTasks.GET(new Request(`https://app.test/api/v1/extension/workspace-tasks?projectId=${other}`));
  assert.equal(queryOther.status, 403);
  assert.equal((await queryOther.json()).errorCode, "WORKSPACE_NOT_ALLOWED");
  as(token, "GET", `/api/v1/extension/workspace-tasks?projectId=${mine}`);
  assert.equal((await workspaceTasks.GET(new Request(`https://app.test/api/v1/extension/workspace-tasks?projectId=${mine}`))).status, 200);

  as(token, "POST", "/api/v1/extension/create-task");
  const bodyOther = await createTask.POST(post("/api/v1/extension/create-task", { projectId: other, title: "Sneaky" }));
  assert.equal(bodyOther.status, 403);
  as(token, "POST", "/api/v1/extension/create-task");
  const bodyMine = await createTask.POST(post("/api/v1/extension/create-task", { projectId: mine, title: "Fine" }));
  assert.equal(bodyMine.status, 200, JSON.stringify(await bodyMine.clone().json()));

  const [elsewhere] = await sql`INSERT INTO tasks (workspace_id, title, status, assignee_id) VALUES (${other}, 'Elsewhere', 'todo', ${userId}) RETURNING id`;
  as(token, "POST", "/api/v1/extension/task-subtask");
  const taskOther = await subtask.POST(post("/api/v1/extension/task-subtask", { projectId: mine, taskId: elsewhere!.id, title: "x" }));
  assert.equal(taskOther.status, 403, "a task from another workspace, even with this workspace's id");

  as(token, "GET", "/api/v1/extension/workspaces");
  const listed = await (await workspacesList.GET(new Request("https://app.test/api/v1/extension/workspaces"))).json();
  assert.deepEqual(listed.data.workspaces.map((w: { id: string }) => w.id), [mine]);

  as(token.replace("nb_agt_", "nb_dev_"), "GET", "/api/v1/extension/workspaces");
  assert.equal((await workspacesList.GET(new Request("https://app.test/api/v1/extension/workspaces"))).status, 401, "the prefix must match the token's type");
});

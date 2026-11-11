import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, sql } from "./_helpers";

// Report A2 (pre-fill order), A3, A5 (approval, what the CLI asks for, remembered choices), A10 routes 1–4.
let devices: typeof import("../../src/lib/extension/device-codes");
let decision: typeof import("../../src/lib/extension/device-decision");
before(async () => {
  devices = await loadAppModule(() => import("../../src/lib/extension/device-codes"));
  decision = await loadAppModule(() => import("../../src/lib/extension/device-decision"));
});
after(async () => { await sql.end(); await closeAppDb(); });

const start = (extra: Partial<Parameters<typeof devices.createDeviceCode>[0]> = {}) =>
  devices.createDeviceCode({ clientName: "NetworkBase CLI", deviceName: "laptop", type: "agent", agentName: "Claude Code", ...extra });

test("the page pre-fills what the CLI asked for, then the remembered choice, then Full · All · 30", async () => {
  const userId = await sql.begin((tx) => createUser(tx));
  const workspaceId = await sql.begin((tx) => createProject(tx, userId));

  const plain = await start();
  assert.deepEqual((await devices.findPendingDeviceCode(plain.userCode, userId))!.prefill, { access: "full", workspace: "all", expiryDays: 30, source: "default" });

  const asked = await start({ requestedAccess: "read", requestedWorkspace: workspaceId, country: "IN" });
  const pending = (await devices.findPendingDeviceCode(asked.userCode, userId))!;
  assert.deepEqual(pending.prefill, { access: "read", workspace: workspaceId, expiryDays: 30, source: "cli" });
  assert.equal(pending.country, "IN");

  assert.ok(await devices.decideDeviceCode(userId, plain.userCode, { decision: "approve", type: "agent", access: "small", workspace: workspaceId, expiryDays: 7 }));
  const next = await start();
  assert.deepEqual((await devices.findPendingDeviceCode(next.userCode, userId))!.prefill, { access: "small", workspace: workspaceId, expiryDays: 7, source: "remembered" });
});

test("approving All makes an all-workspaces agent with the preset's scopes", async () => {
  const userId = await sql.begin((tx) => createUser(tx));
  const code = await start();
  assert.ok(await devices.decideDeviceCode(userId, code.userCode, { decision: "approve", type: "agent", access: "full", workspace: "all", expiryDays: 30 }));
  const polled = await devices.pollDeviceCode(code.deviceCode);
  assert.equal(polled.status, "approved");
  const [session] = await sql`SELECT workspace_id, all_workspaces, scopes FROM extension_device_sessions WHERE token_hash = encode(sha256(${(polled as { token: string }).token}::bytea), 'hex')`;
  assert.equal(session!.workspace_id, null);
  assert.equal(session!.all_workspaces, true);
  assert.deepEqual([...session!.scopes].sort(), ["doc:write", "file:final", "file:read", "file:write", "task:complete", "task:read", "task:write", "workspace:read"]);
});

test("Custom keeps exactly the ticked extras; Read only stores read scopes explicitly", async () => {
  const userId = await sql.begin((tx) => createUser(tx));
  const workspaceId = await sql.begin((tx) => createProject(tx, userId));
  const custom = await start();
  await devices.decideDeviceCode(userId, custom.userCode, { decision: "approve", type: "agent", access: "custom", workspace: workspaceId, expiryDays: 30, extraScopes: ["file:final"] });
  const read = await start();
  await devices.decideDeviceCode(userId, read.userCode, { decision: "approve", type: "agent", access: "read", workspace: workspaceId, expiryDays: 30 });
  const [c] = await sql`SELECT scopes FROM device_codes WHERE user_code = ${custom.userCode}`;
  const [r] = await sql`SELECT scopes FROM device_codes WHERE user_code = ${read.userCode}`;
  assert.deepEqual([...c!.scopes].sort(), ["file:final", "file:read", "file:write", "task:read", "task:write", "workspace:read"]);
  assert.deepEqual([...r!.scopes].sort(), ["file:read", "task:read", "workspace:read"]);
});

test("the decision schema takes presets and all, and refuses the old shape", () => {
  const ok = decision.deviceDecisionSchema.safeParse({ decision: "approve", type: "agent", access: "full", workspace: "all", expiryDays: 30 });
  assert.equal(ok.success, true);
  const old = decision.deviceDecisionSchema.safeParse({ decision: "approve", type: "agent", workspaceId: "00000000-0000-4000-8000-000000000000", expiryDays: 30, extraScopes: [] });
  assert.equal(old.success, false);
  assert.equal(decision.deviceDecisionSchema.safeParse({ decision: "approve", type: "agent", access: "everything", workspace: "all", expiryDays: 30 }).success, false);
});

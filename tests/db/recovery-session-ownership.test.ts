import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { closeAppDb, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

let actingUser = "";
let route: typeof import("../../src/app/api/v1/extension/recovery-sessions/route");
before(async () => {
  const shared = await loadAppModule(() => import("../../src/app/api/v1/_shared"));
  moduleStubs.set("@/app/api/v1/_shared", {
    ...shared,
    requireAuthenticatedUser: async () => ({ user: { id: actingUser }, extensionSessionId: "ext-session", response: null }),
    enforceRouteLimit: async () => null,
  });
  moduleStubs.set("@/lib/security/csrf", { validateCsrf: () => null });
  route = await loadAppModule(() => import("../../src/app/api/v1/extension/recovery-sessions/route"));
});
after(async () => { await sql.end(); await closeAppDb(); });

const call = (body: Record<string, unknown>) =>
  route.POST(new Request("https://app.test/api/v1/extension/recovery-sessions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

// AUTH-003: a session id is an identifier, not authority.
test("another user's session id cannot be restarted, ended or hijacked", async () => {
  const owner = await sql.begin((tx) => createUser(tx));
  const intruder = await sql.begin((tx) => createUser(tx));
  const sessionId = randomUUID();
  const deviceId = randomUUID();
  try {
    actingUser = owner;
    assert.equal((await call({ action: "start", sessionId, deviceId, extensionVersion: "1.0.0" })).status, 200);
    const before = (await sql`SELECT device_id, status, user_id FROM extension_recovery_sessions WHERE session_id = ${sessionId}`)[0]!;

    actingUser = intruder;
    const otherDevice = randomUUID();
    assert.equal((await call({ action: "start", sessionId, deviceId: otherDevice, extensionVersion: "6.6.6" })).status, 409);
    assert.equal((await call({ action: "clean", sessionId, deviceId: otherDevice })).status, 409);
    // Using it as someone else's "previous" session is ignored, not applied.
    assert.equal((await call({ action: "start", sessionId: randomUUID(), deviceId: otherDevice, previousSessionId: sessionId, previousDisposition: "interrupted" })).status, 200);

    const after2 = (await sql`SELECT device_id, status, user_id FROM extension_recovery_sessions WHERE session_id = ${sessionId}`)[0]!;
    assert.deepEqual({ ...after2 }, { ...before });

    // The owner can still restart it.
    actingUser = owner;
    assert.equal((await call({ action: "start", sessionId, deviceId, extensionVersion: "1.0.1" })).status, 200);
  } finally {
    await sql`DELETE FROM extension_recovery_sessions WHERE user_id = ANY(${[owner, intruder]}::uuid[])`;
  }
});

import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { closeAppDb, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// Report A3.6, A3.7 (findings 29, 30): tokens reach only listed routes, and only with the scope a route needs.
let headerValues: Record<string, string> = {};
moduleStubs.set("next/headers", { headers: async () => ({ get: (name: string) => headerValues[name.toLowerCase()] ?? null }), cookies: async () => ({ getAll: () => [], get: () => undefined, set: () => undefined }) });
moduleStubs.set("@/lib/supabase/server", { createClient: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }), createAdminClient: async () => { throw new Error("not used"); } });

let shared: typeof import("../../src/app/api/v1/_shared");
before(async () => { shared = await loadAppModule(() => import("../../src/app/api/v1/_shared")); });
after(async () => { await sql.end(); await closeAppDb(); });

const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const asRequest = (token: string, method: string, target: string | null) => {
  headerValues = { authorization: `Bearer ${token}`, "x-networkbase-request-method": method };
  if (target) headerValues["x-networkbase-request-target"] = target;
};
const body = async (response: Response | null | undefined) => (response ? await response.json() : null);

test("a read-only personal token can read tasks but not push files or finish tasks", async () => {
  const userId = await sql.begin((tx) => createUser(tx));
  const token = `nb_pat_${randomUUID().replace(/-/g, "")}`;
  try {
    await sql`INSERT INTO personal_access_tokens (user_id, label, token_hash, token_prefix, scopes)
              VALUES (${userId}, 'read only', ${hash(token)}, ${token.slice(0, 12)}, ${sql.json(["repo:read"])})`;

    asRequest(token, "GET", "/api/v1/extension/workspace-tasks?projectId=x");
    const read = await shared.requireAuthenticatedUser();
    assert.equal(read.user?.id, userId);
    assert.equal(read.response, null);

    // Second call is served from the 15 s cache and must still be checked.
    asRequest(token, "POST", "/api/v1/extension/fast-push");
    const push = await shared.requireAuthenticatedUser();
    assert.equal(push.user, null);
    assert.equal(push.response?.status, 403);
    const pushBody = await body(push.response);
    assert.equal(pushBody.errorCode, "SCOPE_MISSING");
    assert.equal(pushBody.details.scope, "file:write");

    asRequest(token, "GET", "/api/v1/extension/task-detail?taskId=1");
    assert.equal((await shared.requireAuthenticatedUser()).response, null);
    assert.equal(shared.requireTokenScope(read, "task:complete")?.status, 403);
  } finally {
    await sql`DELETE FROM personal_access_tokens WHERE user_id = ${userId}`;
  }
});

test("a device token is refused on account and token routes, and when the target is missing", async () => {
  const userId = await sql.begin((tx) => createUser(tx));
  const token = `nb_dev_${randomUUID()}`;
  try {
    await sql`INSERT INTO extension_device_sessions (user_id, token_hash, token_prefix, device_name, client_version, expires_at)
              VALUES (${userId}, ${hash(token)}, ${token.slice(0, 12)}, 'test device', '1.0.0', now() + interval '1 day')`;

    asRequest(token, "POST", "/api/v1/extension/fast-push");
    const push = await shared.requireAuthenticatedUser();
    assert.equal(push.user?.id, userId, "device tokens may push");
    assert.equal(shared.requireTokenScope(push, "task:complete"), null);

    for (const target of ["/api/v1/account/delete", "/api/v1/cli/tokens", "/api/v1/sessions", "/api/v1/auth/change-password"]) {
      asRequest(token, "POST", target);
      const denied = await shared.requireAuthenticatedUser();
      assert.equal(denied.user, null, target);
      assert.equal(denied.response?.status, 403, target);
      assert.equal((await body(denied.response)).errorCode, "FORBIDDEN", target);
    }

    asRequest(token, "GET", null);
    const noTarget = await shared.requireAuthenticatedUser();
    assert.equal(noTarget.response?.status, 403, "fails closed without the proxy's target header");
  } finally {
    await sql`DELETE FROM extension_device_sessions WHERE user_id = ${userId}`;
  }
});

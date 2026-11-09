import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { closeAppDb, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

let headerValues: Record<string, string> = {};
moduleStubs.set("next/headers", { headers: async () => ({ get: (name: string) => headerValues[name.toLowerCase()] ?? null }), cookies: async () => ({ getAll: () => [], get: () => undefined, set: () => undefined }) });
moduleStubs.set("@/lib/supabase/server", { createClient: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }), createAdminClient: async () => { throw new Error("not used"); } });

let shared: typeof import("../../src/app/api/v1/_shared");
before(async () => {
  shared = await loadAppModule(() => import("../../src/app/api/v1/_shared"));
});
after(async () => { await sql.end(); await closeAppDb(); });

const lastSeen = async (id: string) => (await sql`SELECT last_seen_at FROM extension_device_sessions WHERE id = ${id}`)[0]!.last_seen_at as Date;
const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

// API-009: the extension principal comes from one read; lastSeenAt is coalesced; revocation is immediate.
test("extension bearer auth coalesces last-seen writes but always honours revocation and metadata changes", async () => {
  const userId = await sql.begin((tx) => createUser(tx));
  const token = `nb_dev_${randomUUID()}`;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  try {
    const [row] = await sql`
      INSERT INTO extension_device_sessions (user_id, token_hash, token_prefix, device_name, expires_at, last_seen_at, client_version)
      VALUES (${userId}, ${tokenHash}, ${token.slice(0, 12)}, 'test device', now() + interval '1 day', now() - interval '5 seconds', '1.0.0') RETURNING id`;
    const id = row!.id as string;
    headerValues = { authorization: `Bearer ${token}`, "x-extension-version": "1.0.0", "x-networkbase-request-method": "GET", "x-networkbase-request-target": "/api/v1/extension/workspaces" };

    const before = await lastSeen(id);
    const first = await shared.requireAuthenticatedUser();
    assert.equal(first.user?.id, userId);
    assert.equal(first.extensionSessionId, id);
    await settle();
    assert.equal((await lastSeen(id)).getTime(), before.getTime(), "a recent session is not rewritten on every read");

    headerValues["x-extension-version"] = "1.1.0";
    await shared.requireAuthenticatedUser();
    await settle();
    const [changed] = await sql`SELECT client_version, last_seen_at FROM extension_device_sessions WHERE id = ${id}`;
    assert.equal(changed!.client_version, "1.1.0");
    assert.ok((changed!.last_seen_at as Date).getTime() > before.getTime());

    await sql`UPDATE extension_device_sessions SET last_seen_at = now() - interval '10 minutes' WHERE id = ${id}`;
    const stale = await lastSeen(id);
    await shared.requireAuthenticatedUser();
    await settle();
    assert.ok((await lastSeen(id)).getTime() > stale.getTime(), "a stale session is refreshed");

    await sql`UPDATE extension_device_sessions SET revoked_at = now() WHERE id = ${id}`;
    const revoked = await shared.requireAuthenticatedUser();
    assert.equal(revoked.user, null);
    assert.equal(revoked.response?.status, 401);
  } finally {
    await sql`DELETE FROM extension_device_sessions WHERE user_id = ${userId}`;
  }
});

import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";

import { closeAppDb, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

let authorization: string | null = null;
let cookieLookups = 0;
let shared: typeof import("../../src/app/api/v1/_shared");
before(async () => {
  // The proxy stamps every request with its method and path; token access is judged on them.
  const trusted = { "x-networkbase-request-method": "GET", "x-networkbase-request-target": "/api/v1/extension/workspaces" };
  moduleStubs.set("next/headers", { headers: async () => new Headers(authorization ? { authorization, ...trusted } : trusted) });
  moduleStubs.set("@/lib/supabase/server", {
    createClient: async () => ({
      auth: {
        getUser: async () => {
          cookieLookups += 1;
          return { data: { user: { id: "cookie-user" } } };
        },
      },
    }),
  });
  shared = await loadAppModule(() => import("../../src/app/api/v1/_shared"));
});
beforeEach(() => { cookieLookups = 0; authorization = null; });
after(async () => { await sql.end(); await closeAppDb(); });

// SEC-001: a request that offers a Bearer credential is judged on it alone.
test("an invalid bearer credential is rejected without trying the session cookie", async () => {
  for (const header of ["Bearer nb_dev_does-not-exist", "Bearer not-an-extension-token", "Bearer "]) {
    authorization = header;
    const result = await shared.requireAuthenticatedUser();
    assert.equal(result.user, null, header);
    assert.equal(result.response?.status, 401, header);
  }
  assert.equal(cookieLookups, 0);
});

test("a valid extension token authenticates, and no bearer falls back to the cookie", async () => {
  const user = await sql.begin((tx) => createUser(tx));
  const token = `nb_dev_${randomUUID()}`;
  try {
    await sql`INSERT INTO extension_device_sessions (user_id, token_hash, token_prefix, device_name, client_version, expires_at)
              VALUES (${user}, ${createHash("sha256").update(token).digest("hex")}, ${token.slice(0, 12)}, 'test device', '1.0.0', now() + interval '1 day')`;
    authorization = `Bearer ${token}`;
    const bearer = await shared.requireAuthenticatedUser();
    assert.equal(bearer.user?.id, user);
    assert.equal(cookieLookups, 0);

    authorization = null;
    const cookie = await shared.requireAuthenticatedUser();
    assert.equal(cookie.user?.id, "cookie-user");
    assert.equal(cookieLookups, 1);
  } finally {
    await sql`DELETE FROM extension_device_sessions WHERE user_id = ${user}`;
  }
});

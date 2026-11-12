import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { closeAppDb, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// Report A3.1, F37: a browser sign-in code issued with a PKCE challenge is only exchanged with the verifier
// the requesting CLI holds; codes without a challenge (the VS Code extension today) keep working.
moduleStubs.set("@/lib/security/rate-limit", { consumeRateLimit: async () => ({ allowed: true }), consumeRateLimitForRoute: async () => ({ allowed: true }) });
let route: typeof import("../../src/app/api/v1/extension/auth-code/route");
let codes: typeof import("../../src/lib/extension/auth-code");
before(async () => {
  route = await loadAppModule(() => import("../../src/app/api/v1/extension/auth-code/route"));
  codes = await loadAppModule(() => import("../../src/lib/extension/auth-code"));
});
after(async () => { await sql.end(); await closeAppDb(); });

async function issue(challenge: string | null, owner?: string) {
  const userId = owner ?? await sql.begin((tx) => createUser(tx));
  const rawToken = `nb_dev_${randomUUID()}`;
  const [session] = await sql`INSERT INTO extension_device_sessions (user_id, token_hash, token_prefix, device_name, client_version, expires_at)
    VALUES (${userId}, ${createHash("sha256").update(rawToken).digest("hex")}, ${rawToken.slice(0, 12)}, 'cli', '2.0.0', now() + interval '1 day') RETURNING id`;
  const issued = codes.issueExtensionAuthCode({ rawToken, sessionId: session!.id, userId });
  const state = randomBytes(16).toString("hex");
  await sql`INSERT INTO extension_device_session_events (session_id, event_type, metadata) VALUES (${session!.id}, 'auth_code_issued', ${sql.json({
    codeHash: issued.codeHash, codeId: issued.codeId, expiresAt: issued.expiresAt.toISOString(),
    requestStateHash: createHash("sha256").update(state).digest("hex"), ...(challenge ? { codeChallenge: challenge } : {}),
  })})`;
  return { code: issued.code, state, rawToken, userId, sessionId: session!.id as string };
}
const exchange = (body: unknown) => route.POST(new Request("https://app.test/api/v1/extension/auth-code", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

test("a challenged code needs its verifier", async () => {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const issued = await issue(challenge);
  assert.equal((await exchange({ code: issued.code, state: issued.state })).status, 401, "no verifier");
  assert.equal((await exchange({ code: issued.code, state: issued.state, codeVerifier: randomBytes(32).toString("base64url") })).status, 401, "wrong verifier");
  const ok = await exchange({ code: issued.code, state: issued.state, codeVerifier: verifier });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).data.token, issued.rawToken);
});

test("a code without a challenge still works for clients that don't send one", async () => {
  const issued = await issue(null);
  assert.equal((await exchange({ code: issued.code, state: issued.state })).status, 200);
});

test("signing in again through the browser closes this computer's old sign-in (C6)", async () => {
  const first = await issue(null);
  await exchange({ code: first.code, state: first.state });
  const second = await issue(null, first.userId);
  assert.equal((await exchange({ code: second.code, state: second.state, renew: first.rawToken })).status, 200);
  const rows = await sql`SELECT id, revoked_at FROM extension_device_sessions WHERE user_id = ${first.userId} ORDER BY created_at`;
  assert.deepEqual(rows.map((r) => [r.id, r.revoked_at !== null]), [[first.sessionId, true], [second.sessionId, false]]);
});

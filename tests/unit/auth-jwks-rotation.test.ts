import assert from "node:assert/strict";
import { afterEach, before, test } from "node:test";

type Snapshot = typeof import("../../src/lib/auth/snapshot");

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://jwks-rotation.test";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";

const b64 = (value: string | Uint8Array) => Buffer.from(value).toString("base64url");
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

async function newKey(kid: string) {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = { ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid, alg: "ES256", use: "sig" };
  return { jwk, pair };
}

async function sign(kid: string, privateKey: CryptoKey) {
  const now = Math.floor(Date.now() / 1000);
  const signingInput = `${b64(JSON.stringify({ alg: "ES256", kid, typ: "JWT" }))}.${b64(JSON.stringify({ sub: "u1", iat: now, exp: now + 60 }))}`;
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, new TextEncoder().encode(signingInput));
  return `${signingInput}.${b64(new Uint8Array(signature))}`;
}

let snapshot: Snapshot;
before(async () => { snapshot = await import("../../src/lib/auth/snapshot"); });

// AUTH-008: a signing-key rotation must not lock users out until the cache expires.
test("an unknown kid refreshes the key set once, concurrent callers share the fetch, and forged kids are throttled", async () => {
  const oldKey = await newKey("old");
  const newer = await newKey("new");
  let published = [oldKey.jwk];
  let fetches = 0;
  globalThis.fetch = (async () => {
    fetches += 1;
    return new Response(JSON.stringify({ keys: published }), { status: 200 });
  }) as typeof fetch;

  assert.equal((await snapshot.verifySupabaseAccessToken(await sign("old", oldKey.pair.privateKey))).sub, "u1");
  assert.equal(fetches, 1);

  published = [oldKey.jwk, newer.jwk];
  const token = await sign("new", newer.pair.privateKey);
  const forged = await sign("forged", newer.pair.privateKey);
  const clock = Date.now;
  Date.now = () => clock() + 11_000;
  try {
    const results = await Promise.all([1, 2, 3].map(() => snapshot.verifySupabaseAccessToken(token)));
    assert.ok(results.every((claims) => claims.sub === "u1"));
    assert.equal(fetches, 2, "one refresh for three concurrent callers");

    await assert.rejects(snapshot.verifySupabaseAccessToken(forged), /Unable to find JWKS key/);
    await assert.rejects(snapshot.verifySupabaseAccessToken(forged), /Unable to find JWKS key/);
    assert.equal(fetches, 2, "an unknown kid inside the cooldown does not fetch");
  } finally {
    Date.now = clock;
  }
});

test("an unreachable issuer is reported as unavailable, not as an invalid signature", async () => {
  const stranger = await newKey("never-published");
  globalThis.fetch = (async () => new Response("down", { status: 503 })) as typeof fetch;
  // A fresh module instance would be needed to empty the cache; an unpublished kid after the cooldown path suffices.
  const clock = Date.now;
  Date.now = () => clock() + 31 * 60 * 1000;
  try {
    await assert.rejects(snapshot.verifySupabaseAccessToken(await sign("never-published", stranger.pair.privateKey)), snapshot.JwksUnavailableError);
  } finally {
    Date.now = clock;
  }
});

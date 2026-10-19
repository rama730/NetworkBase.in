import assert from "node:assert/strict";
import { test } from "node:test";

import { createCsrfFetch } from "../../src/lib/security/csrf-client";
import { CSRF_HEADER_NAME, CSRF_REJECTED_HEADER } from "../../src/lib/security/csrf-constants";

// A scripted server: issues tokens from /api/v1/security/csrf and accepts only the current one.
function server() {
  let generation = 1;
  const seen: Array<{ url: string; token: string | null }> = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : String(input);
    if (url === "/api/v1/security/csrf") return Response.json({ data: { token: `tok${generation}.sig` } });
    const token = new Headers(init?.headers).get(CSRF_HEADER_NAME);
    seen.push({ url, token });
    if (token !== `tok${generation}.sig`) return new Response("{}", { status: 403, headers: { [CSRF_REJECTED_HEADER]: "1" } });
    return Response.json({ ok: true });
  }) as typeof fetch;
  return { fetchImpl, seen, rotate: () => { generation += 1; } };
}
const sameOrigin = () => true;

// API-012
test("a stale cached token is replaced and the rejected, replayable request is retried once", async () => {
  const s = server();
  const csrfFetch = createCsrfFetch(s.fetchImpl, sameOrigin);
  assert.equal((await csrfFetch("/api/v1/x", { method: "POST", body: "{}" })).status, 200);
  s.rotate(); // the cookie was reissued; the page still holds the old token
  const retried = await csrfFetch("/api/v1/x", { method: "POST", body: "{}" });
  assert.equal(retried.status, 200);
  assert.deepEqual(s.seen.slice(-2).map((entry) => entry.token), ["tok1.sig", "tok2.sig"]);
  // The next call uses the refreshed token without another rejection.
  assert.equal((await csrfFetch("/api/v1/y", { method: "PATCH", body: "{}" })).status, 200);
  assert.equal(s.seen.at(-1)!.token, "tok2.sig");
});

test("a non-replayable body is not resent, but the next request recovers", async () => {
  const s = server();
  const csrfFetch = createCsrfFetch(s.fetchImpl, sameOrigin);
  await csrfFetch("/api/v1/x", { method: "POST", body: "{}" });
  s.rotate();
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("x")); controller.close(); } });
  const rejected = await csrfFetch("/api/v1/x", { method: "POST", body: stream, duplex: "half" } as RequestInit);
  assert.equal(rejected.status, 403);
  assert.equal(s.seen.filter((entry) => entry.url === "/api/v1/x").length, 2, "sent once, not replayed");
  assert.equal((await csrfFetch("/api/v1/x", { method: "POST", body: "{}" })).status, 200);
});

test("other 403s and reads are never retried or decorated", async () => {
  let calls = 0;
  const fetchImpl = (async (input: RequestInfo | URL) => {
    if (String(input) === "/api/v1/security/csrf") return Response.json({ data: { token: "t.sig" } });
    calls += 1;
    return new Response("{}", { status: 403 });
  }) as typeof fetch;
  const csrfFetch = createCsrfFetch(fetchImpl, sameOrigin);
  assert.equal((await csrfFetch("/api/v1/x", { method: "DELETE" })).status, 403);
  assert.equal(calls, 1);
  await csrfFetch("/api/v1/x");
  assert.equal(calls, 2);
});

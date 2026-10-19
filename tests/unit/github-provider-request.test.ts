import assert from "node:assert/strict";
import { test } from "node:test";

import { fetchGithubJson } from "@/lib/github/provider-request";

const reply = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });
const scripted = (...responses: Array<Response | Error>) => {
  let calls = 0;
  const send = (async () => {
    const next = responses[Math.min(calls, responses.length - 1)]!;
    calls += 1;
    if (next instanceof Error) throw next;
    return next.clone();
  }) as never;
  return { send, calls: () => calls };
};

// PERF-010: deterministic answers are not retried, transient ones are, within a total budget.
test("a deterministic failure is asked once", async () => {
  for (const status of [400, 401, 404, 422]) {
    const s = scripted(reply(status, { message: "nope" }));
    await assert.rejects(fetchGithubJson("https://api.github.com/x", {}, { send: s.send }), new RegExp(`failed \\(${status}\\)`));
    assert.equal(s.calls(), 1, String(status));
  }
});

test("a plain 403 is final but a rate-limited 403 is retried", async () => {
  const forbidden = scripted(reply(403, { message: "Resource not accessible" }));
  await assert.rejects(fetchGithubJson("https://api.github.com/x", {}, { send: forbidden.send }));
  assert.equal(forbidden.calls(), 1);

  const limited = scripted(reply(403, { message: "API rate limit exceeded" }, { "retry-after": "0" }), reply(200, { ok: true }));
  const result = await fetchGithubJson<{ ok: boolean }>("https://api.github.com/x", {}, { send: limited.send });
  assert.equal(result.data.ok, true);
  assert.equal(limited.calls(), 2);
});

test("network errors and 5xx retry, then succeed", async () => {
  const s = scripted(new Error("socket hang up"), reply(503, { message: "busy" }), reply(200, { ok: 1 }));
  const result = await fetchGithubJson<{ ok: number }>("https://api.github.com/x", {}, { send: s.send, retries: 2, budgetMs: 20_000 });
  assert.equal(result.data.ok, 1);
  assert.equal(s.calls(), 3);
});

test("a Retry-After longer than the remaining budget fails now instead of sleeping", async () => {
  const s = scripted(reply(429, { message: "slow down" }, { "retry-after": "120" }));
  const started = Date.now();
  await assert.rejects(fetchGithubJson("https://api.github.com/x", {}, { send: s.send, budgetMs: 5_000 }), /failed \(429\)/);
  assert.equal(s.calls(), 1);
  assert.ok(Date.now() - started < 1_000);
});

import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

// Minimal in-memory Upstash stand-in: set NX/EX, get, and the two Lua scripts' compare-token semantics.
const store = new Map<string, string>();
const fakeRedis = {
  set: async (key: string, value: string, opts?: { nx?: boolean }) => {
    if (opts?.nx && store.has(key)) return null;
    store.set(key, value);
    return "OK";
  },
  get: async (key: string) => store.get(key) ?? null,
  eval: async (script: string, keys: string[], args: string[]) => {
    const current = store.get(keys[0]!);
    if (current !== args[0]) return 0;
    if (script.includes("'DEL'")) store.delete(keys[0]!);
    else store.set(keys[0]!, args[1]!);
    return 1;
  },
};

type Idem = typeof import("../../src/lib/security/idempotency");
let idem: Idem;
beforeEach(async () => {
  store.clear();
  (globalThis as { __redisClient?: unknown }).__redisClient = fakeRedis;
  idem = await import("../../src/lib/security/idempotency");
});
afterEach(() => { (globalThis as { __redisClient?: unknown }).__redisClient = undefined; });

const req = (key: string | null = "k1") => new Request("https://x.test/api", { method: "POST", headers: key ? { "idempotency-key": key } : {} });
const ok = () => Response.json({ success: true, message: "done" });
const run = (request: Request, handler: () => Promise<Response>) => idem.withIdempotentRoute(request, { namespace: "t", scopeId: "u1" }, handler);

test("a replay is the exact first response and does not rerun the handler (API-010)", async () => {
  let runs = 0;
  const first = await run(req(), async () => { runs += 1; return ok(); });
  const replay = await run(req(), async () => { runs += 1; return ok(); });
  assert.equal(runs, 1);
  assert.equal(await replay.text(), await first.text());
  assert.equal(replay.headers.get("idempotency-replayed"), "true");
});

test("a rejected (4xx) request releases the key so a corrected retry can run (API-011)", async () => {
  const rejected = await run(req(), async () => Response.json({ success: false }, { status: 400 }));
  assert.equal(rejected.status, 400);
  let ran = false;
  const retry = await run(req(), async () => { ran = true; return ok(); });
  assert.equal(ran, true);
  assert.equal(retry.status, 200);
});

test("an unknown outcome (5xx or throw) keeps the marker; a concurrent retry gets 409", async () => {
  await run(req("k2"), async () => Response.json({ success: false }, { status: 500 }));
  const concurrent = await run(req("k2"), async () => ok());
  assert.equal(concurrent.status, 409);
  await assert.rejects(run(req("k3"), async () => { throw new Error("boom"); }));
  assert.equal((await run(req("k3"), async () => ok())).status, 409);
});

test("without an Idempotency-Key the handler always runs and nothing is stored", async () => {
  let runs = 0;
  await run(req(null), async () => { runs += 1; return ok(); });
  await run(req(null), async () => { runs += 1; return ok(); });
  assert.equal(runs, 2);
  assert.equal(store.size, 0);
});

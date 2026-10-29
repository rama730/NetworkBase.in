import assert from "node:assert/strict";
import Module from "node:module";
import { afterEach, beforeEach, test } from "node:test";

// COR-015: a lost dispatch must not suppress refreshes forever.
let sendImpl: () => Promise<unknown> = async () => undefined;
let sent = 0;
const moduleWithLoad = Module as unknown as { _load: (request: string, parent: unknown, isMain: boolean) => unknown };
const originalLoad = moduleWithLoad._load;
moduleWithLoad._load = (request, parent, isMain) =>
  request === "@/inngest/client" ? { inngest: { send: () => { sent += 1; return sendImpl(); } } } : originalLoad(request, parent, isMain);

const store = new Map<string, string>();
const fakeRedis = {
  set: async (key: string, value: string, options?: { nx?: boolean }) => (options?.nx && store.has(key) ? null : (store.set(key, value), "OK")),
  del: async (...keys: string[]) => { for (const key of keys) store.delete(key); },
};
beforeEach(() => { store.clear(); sent = 0; sendImpl = async () => undefined; (globalThis as { __redisClient?: unknown }).__redisClient = fakeRedis; });
afterEach(() => { (globalThis as { __redisClient?: unknown }).__redisClient = undefined; });
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

test("one dispatch per window; a failed dispatch clears the marker so the next mutation retries", async () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { queueCounterRefresh, counterRefreshMarkerKey } = require("../../src/lib/my-work/counter-buffer") as typeof import("../../src/lib/my-work/counter-buffer");
  await queueCounterRefresh("u1");
  await queueCounterRefresh("u1");
  await settle();
  assert.equal(sent, 1, "a queued user is not dispatched twice");
  assert.ok(store.has(counterRefreshMarkerKey("u1")));

  store.clear(); sent = 0;
  sendImpl = async () => { throw new Error("inngest unreachable"); };
  await queueCounterRefresh("u2");
  await settle();
  assert.equal(store.has(counterRefreshMarkerKey("u2")), false, "the marker does not outlive a failed dispatch");
  sendImpl = async () => undefined;
  await queueCounterRefresh("u2");
  await settle();
  assert.equal(sent, 2, "the next mutation dispatches again");
});

test("markers expire by themselves", async () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { COUNTER_REFRESH_MARKER_TTL_SECONDS } = require("../../src/lib/my-work/counter-buffer") as typeof import("../../src/lib/my-work/counter-buffer");
  assert.ok(COUNTER_REFRESH_MARKER_TTL_SECONDS > 0 && COUNTER_REFRESH_MARKER_TTL_SECONDS <= 600);
});

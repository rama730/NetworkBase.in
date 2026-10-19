import assert from "node:assert/strict";
import { test } from "node:test";

function load(env: Record<string, string | undefined>) {
  const saved = { url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN };
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  (globalThis as { __redisClient?: unknown }).__redisClient = undefined;
  const path = require.resolve("../../src/lib/redis");
  delete require.cache[path];
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("../../src/lib/redis") as typeof import("../../src/lib/redis");
  } finally {
    if (saved.url === undefined) delete process.env.UPSTASH_REDIS_REST_URL; else process.env.UPSTASH_REDIS_REST_URL = saved.url;
    if (saved.token === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN; else process.env.UPSTASH_REDIS_REST_TOKEN = saved.token;
  }
}

// MAINT-001: unconfigured Redis is null, not a truthy object whose methods are undefined.
test("redis is null when it is not configured", () => {
  const mod = load({ UPSTASH_REDIS_REST_URL: undefined, UPSTASH_REDIS_REST_TOKEN: undefined });
  assert.equal(mod.redis, null);
  assert.equal(mod.getRedisClient(), null);
});

test("redis is a real client when configured", () => {
  const mod = load({ UPSTASH_REDIS_REST_URL: "https://redis.test", UPSTASH_REDIS_REST_TOKEN: "t" });
  assert.notEqual(mod.redis, null);
  assert.equal(typeof mod.redis!.get, "function");
  assert.equal(mod.redis, mod.getRedisClient());
});

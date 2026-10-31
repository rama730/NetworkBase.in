import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { closeAppDb, loadAppModule, sql } from "./_helpers";

// The real limiter with no Redis, which is exactly an outage. In tests the default policy counts locally.
let shared: typeof import("../../src/app/api/v1/_shared");

before(async () => {
  shared = await loadAppModule(() => import("../../src/app/api/v1/_shared"));
});
after(async () => { await sql.end(); await closeAppDb(); });

const request = (method: string, ip: string) => new Request("https://app.test/f", { method, headers: { "x-forwarded-for": ip } });
const uniqueIp = () => `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
const statusOf = (result: Response | null) => result?.status ?? 200;

test("the check runs out before the download, so the app says so instead of saving an error", async () => {
  const ip = uniqueIp();
  for (let index = 0; index < 60; index += 1) {
    assert.equal(statusOf(await shared.enforceDownloadLimit(request("HEAD", ip))), 200, `check ${index + 1}`);
  }
  assert.equal(statusOf(await shared.enforceDownloadLimit(request("HEAD", ip))), 429);
  // The saves that follow those 60 checks still go through, and a client skipping the check is capped too.
  for (let index = 0; index < 120; index += 1) {
    assert.equal(statusOf(await shared.enforceDownloadLimit(request("GET", ip))), 200, `save ${index + 1}`);
  }
  assert.equal(statusOf(await shared.enforceDownloadLimit(request("GET", ip))), 429);
});

test("one visitor using up a limit doesn't affect another", async () => {
  const [first, second] = [uniqueIp(), uniqueIp()];
  for (let index = 0; index < 61; index += 1) await shared.enforceDownloadLimit(request("HEAD", first));
  assert.equal(statusOf(await shared.enforceDownloadLimit(request("HEAD", first))), 429);
  assert.equal(statusOf(await shared.enforceDownloadLimit(request("HEAD", second))), 200);
});

test("a limiter outage: signed-in reads keep working, signed-out reads are blocked", async () => {
  const env = process.env as Record<string, string | undefined>;
  const original = env.NODE_ENV;
  env.NODE_ENV = "production";
  try {
    assert.equal(statusOf(await shared.enforceFileReadLimit(request("GET", uniqueIp()), "files:preview", 600, 60, randomUUID())), 200);
    assert.equal(statusOf(await shared.enforceFileReadLimit(request("GET", uniqueIp()), "files:preview", 600, 60, null)), 429);
  } finally {
    env.NODE_ENV = original;
  }
});

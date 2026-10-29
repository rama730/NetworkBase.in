import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, sql } from "./_helpers";

let flush: typeof import("../../src/lib/counters/redis-flush");
before(async () => {
  flush = await loadAppModule(() => import("../../src/lib/counters/redis-flush"));
});
after(async () => { await sql.end(); await closeAppDb(); });

// An in-memory Redis with hashes, RENAME (overwriting like the real one), SCAN and DEL.
function fakeRedis() {
  const hashes = new Map<string, Record<string, string>>();
  return {
    hashes,
    api: {
      async rename(source: string, destination: string) {
        const value = hashes.get(source);
        if (!value) throw new Error("ERR no such key");
        hashes.delete(source);
        hashes.set(destination, value);
      },
      async hgetall(key: string) { return hashes.get(key) ?? null; },
      async del(...keys: string[]) {
        for (const key of keys) {
          hashes.delete(key);
        }
      },
      async scan(_cursor: string | number, options: { match: string }) {
        const prefix = options.match.replace("*", "");
        return ["0", [...hashes.keys()].filter((key) => key.startsWith(prefix))] as [string, string[]];
      },
    },
  };
}
const applyViews = async (tx: Parameters<Parameters<typeof import("../../src/lib/db").db.transaction>[0]>[0], deltas: Array<{ id: string; delta: number }>) => {
  for (const { id, delta } of deltas) await tx.execute((await import("drizzle-orm")).sql`UPDATE workspaces SET view_count = view_count + ${delta} WHERE id = ${id}::uuid`);
};

test("a flush applies each buffered batch exactly once, even when the acknowledgement is lost", async () => {
  const owner = await sql.begin((tx) => createUser(tx));
  const projectId = await sql.begin((tx) => createProject(tx, owner));
  try {
    const views = async () => Number((await sql`SELECT view_count FROM workspaces WHERE id = ${projectId}`)[0]!.view_count);
    const before = await views();
    const redis = fakeRedis();
    redis.hashes.set("t:views", { [projectId]: "5", "not-a-uuid": "9", [owner]: "0" });

    // The first run's DEL fails after the SQL commits: the batch key is left behind, as in a crash.
    let deletions = 0;
    const flaky = {
      ...redis.api,
      async del(...keys: string[]) { deletions += 1; if (deletions === 1) throw new Error("connection reset"); return redis.api.del(...keys); },
    };
    await assert.rejects(flush.flushRedisCounterHash({ redis: flaky, liveKey: "t:views", kind: "test", apply: applyViews }), /connection reset/);
    assert.equal(await views(), before + 5, "applied once before the failure");
    assert.equal([...redis.hashes.keys()].filter((key) => key.startsWith("t:views:flush:")).length, 1, "the batch is recoverable");

    // New increments arrive meanwhile; the next run replays the stranded batch (skipped) and applies the new one.
    redis.hashes.set("t:views", { [projectId]: "2" });
    const second = await flush.flushRedisCounterHash({ redis: redis.api, liveKey: "t:views", kind: "test", apply: applyViews });
    assert.deepEqual({ applied: second.applied, replays: second.replays }, { applied: 1, replays: 1 });
    assert.equal(await views(), before + 7, "5 once, plus 2");
    assert.equal(redis.hashes.size, 0, "everything is cleaned up");

    const empty = await flush.flushRedisCounterHash({ redis: redis.api, liveKey: "t:views", kind: "test", apply: applyViews });
    assert.equal(empty.batches, 0);
  } finally {
    await sql`DELETE FROM counter_flush_batches WHERE kind = 'test'`;
    await sql`DELETE FROM workspace_members WHERE workspace_id = ${projectId}`;
    await sql`DELETE FROM workspaces WHERE id = ${projectId}`;
  }
});

test("a failed database transaction keeps the batch for the next run; nothing is dropped", async () => {
  const redis = fakeRedis();
  redis.hashes.set("t2:views", { "11111111-1111-4111-8111-111111111111": "3" });
  await assert.rejects(flush.flushRedisCounterHash({ redis: redis.api, liveKey: "t2:views", kind: "test", apply: async () => { throw new Error("database unavailable"); } }), /database unavailable/);
  assert.equal([...redis.hashes.keys()].filter((key) => key.startsWith("t2:views:flush:")).length, 1);
  assert.equal((await sql`SELECT count(*)::int AS n FROM counter_flush_batches WHERE kind = 'test'`)[0]!.n, 0, "a rolled-back batch is not marked applied");
  const retried = await flush.flushRedisCounterHash({ redis: redis.api, liveKey: "t2:views", kind: "test", apply: async () => undefined });
  assert.equal(retried.applied, 1);
  await sql`DELETE FROM counter_flush_batches WHERE kind = 'test'`;
});

import "server-only";

import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";

import { db } from "@/lib/db";

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** The slice of the Redis client this needs; satisfied by Upstash. */
export type FlushRedis = {
  rename(source: string, destination: string): Promise<unknown>;
  hgetall(key: string): Promise<Record<string, unknown> | null>;
  del(...keys: string[]): Promise<unknown>;
  scan(cursor: string | number, options: { match: string; count: number }): Promise<[string | number, string[]]>;
};

export type CounterDelta = { id: string; delta: number };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const APPLIED_RETENTION = "14 days";

function parseDeltas(hash: Record<string, unknown> | null): CounterDelta[] {
  const deltas: CounterDelta[] = [];
  for (const [id, raw] of Object.entries(hash ?? {})) {
    const delta = Number.parseInt(String(raw), 10);
    // A malformed id would make the batch's jsonb cast fail on every retry; it carries no usable count.
    if (UUID.test(id) && Number.isFinite(delta) && delta !== 0) deltas.push({ id, delta });
  }
  return deltas;
}

async function listStrandedBatches(redis: FlushRedis, liveKey: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | number = 0;
  do {
    const [next, found] = await redis.scan(cursor, { match: `${liveKey}:flush:*`, count: 100 });
    keys.push(...found);
    cursor = next;
  } while (String(cursor) !== "0");
  return keys;
}

/**
 * Applies a buffered Redis counter hash to PostgreSQL exactly once per batch (COR-009).
 *  1. Batches left behind by a crashed run (`<live>:flush:*`) are processed first.
 *  2. The live hash is renamed to a new batch key; the key is the batch identity. RENAME never
 *     targets an existing key because the name carries a fresh uuid, so nothing is overwritten.
 *  3. Per batch, one transaction records the batch id and applies the increments; the Redis key is
 *     deleted only after that commit. A replay after a lost acknowledgement finds the recorded id,
 *     skips the SQL and just deletes the key. A failed transaction leaves the key for the next run;
 *     there is no requeue path, so no increment can be dropped.
 */
export async function flushRedisCounterHash(options: {
  redis: FlushRedis;
  liveKey: string;
  kind: string;
  apply: (tx: DbTransaction, deltas: CounterDelta[]) => Promise<void>;
}) {
  const { redis, liveKey, kind, apply } = options;
  const batchKeys = await listStrandedBatches(redis, liveKey);

  const newKey = `${liveKey}:flush:${randomUUID()}`;
  try {
    await redis.rename(liveKey, newKey);
    batchKeys.push(newKey);
  } catch (error) {
    // Nothing buffered is the normal case; anything else is a real failure.
    if (!/no such key/i.test(error instanceof Error ? error.message : String(error))) throw error;
  }

  let applied = 0;
  let replays = 0;
  let entries = 0;
  for (const batchKey of batchKeys) {
    const deltas = parseDeltas(await redis.hgetall(batchKey));
    if (deltas.length === 0) {
      await redis.del(batchKey);
      continue;
    }
    const first = await db.transaction(async (tx) => {
      const inserted = await tx.execute<{ batch_id: string }>(sql`
        INSERT INTO counter_flush_batches (batch_id, kind, entry_count)
        VALUES (${batchKey}, ${kind}, ${deltas.length})
        ON CONFLICT (batch_id) DO NOTHING
        RETURNING batch_id
      `);
      if (Array.from(inserted).length === 0) return false;
      await apply(tx, deltas);
      return true;
    });
    await redis.del(batchKey);
    if (first) {
      applied += 1;
      entries += deltas.length;
    } else {
      replays += 1;
    }
  }

  await db.execute(sql`DELETE FROM counter_flush_batches WHERE applied_at < now() - ${APPLIED_RETENTION}::interval`);
  return { batches: batchKeys.length, applied, replays, entries };
}

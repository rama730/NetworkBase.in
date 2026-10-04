import "server-only";

import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, lt, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { storageLegacyCleanupTargets } from "@/lib/db/schema";
import { createAdminClient } from "@/lib/supabase/server";

const CLEANUP_BATCH_SIZE = 100;
const CLEANUP_LEASE_MS = 5 * 60 * 1000;

export async function deleteLegacyStorageCleanupTargets() {
  const now = new Date();
  const leaseToken = randomUUID();
  const leaseExpiresAt = new Date(now.getTime() + CLEANUP_LEASE_MS);
  const claimed = await db.transaction(async (tx) => {
    const expired = await tx
      .select({ id: storageLegacyCleanupTargets.id })
      .from(storageLegacyCleanupTargets)
      .where(and(
        eq(storageLegacyCleanupTargets.state, "deleting"),
        lt(storageLegacyCleanupTargets.leaseExpiresAt, now),
      ))
      .orderBy(asc(storageLegacyCleanupTargets.leaseExpiresAt), asc(storageLegacyCleanupTargets.id))
      .limit(CLEANUP_BATCH_SIZE)
      .for("update", { skipLocked: true });
    if (expired.length > 0) {
      await tx.update(storageLegacyCleanupTargets)
        .set({
          state: "retry",
          nextAttemptAt: now,
          leaseToken: null,
          leaseExpiresAt: null,
          lastError: "CLEANUP_LEASE_EXPIRED",
          updatedAt: now,
        })
        .where(and(
          inArray(storageLegacyCleanupTargets.id, expired.map((row) => row.id)),
          eq(storageLegacyCleanupTargets.state, "deleting"),
          lt(storageLegacyCleanupTargets.leaseExpiresAt, now),
        ));
    }

    const candidates = await tx
      .select({ id: storageLegacyCleanupTargets.id })
      .from(storageLegacyCleanupTargets)
      .where(and(
        inArray(storageLegacyCleanupTargets.state, ["pending", "retry"]),
        lt(storageLegacyCleanupTargets.nextAttemptAt, new Date(now.getTime() + 1)),
      ))
      .orderBy(asc(storageLegacyCleanupTargets.nextAttemptAt), asc(storageLegacyCleanupTargets.id))
      .limit(CLEANUP_BATCH_SIZE)
      .for("update", { skipLocked: true });
    if (candidates.length === 0) return [];
    return tx.update(storageLegacyCleanupTargets)
      .set({
        state: "deleting",
        leaseToken,
        leaseExpiresAt,
        fence: sql`${storageLegacyCleanupTargets.fence} + 1`,
        attempts: sql`${storageLegacyCleanupTargets.attempts} + 1`,
        updatedAt: now,
      })
      .where(inArray(storageLegacyCleanupTargets.id, candidates.map((row) => row.id)))
      .returning({
        id: storageLegacyCleanupTargets.id,
        bucket: storageLegacyCleanupTargets.bucket,
        storageKey: storageLegacyCleanupTargets.storageKey,
        fence: storageLegacyCleanupTargets.fence,
      });
  });

  if (claimed.length === 0) return { claimed: 0, deleted: 0, retryable: 0 };
  const admin = await createAdminClient();
  const byBucket = new Map<string, typeof claimed>();
  for (const target of claimed) {
    const targets = byBucket.get(target.bucket) ?? [];
    targets.push(target);
    byBucket.set(target.bucket, targets);
  }

  const deleted: typeof claimed = [];
  const retryable: Array<(typeof claimed)[number] & { error: string }> = [];
  for (const [bucket, targets] of byBucket) {
    const { error } = await admin.storage.from(bucket).remove(targets.map((target) => target.storageKey));
    if (error) {
      retryable.push(...targets.map((target) => ({ ...target, error: error.message })));
    } else {
      deleted.push(...targets);
    }
  }

  await db.transaction(async (tx) => {
    for (const target of deleted) {
      await tx.update(storageLegacyCleanupTargets)
        .set({
          state: "deleted",
          leaseToken: null,
          leaseExpiresAt: null,
          lastError: null,
          deletedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(
          eq(storageLegacyCleanupTargets.id, target.id),
          eq(storageLegacyCleanupTargets.state, "deleting"),
          eq(storageLegacyCleanupTargets.leaseToken, leaseToken),
          eq(storageLegacyCleanupTargets.fence, target.fence),
        ));
    }
    for (const target of retryable) {
      await tx.update(storageLegacyCleanupTargets)
        .set({
          state: "retry",
          nextAttemptAt: sql`now() + interval '5 minutes'`,
          leaseToken: null,
          leaseExpiresAt: null,
          lastError: target.error.slice(0, 1_000),
          updatedAt: new Date(),
        })
        .where(and(
          eq(storageLegacyCleanupTargets.id, target.id),
          eq(storageLegacyCleanupTargets.state, "deleting"),
          eq(storageLegacyCleanupTargets.leaseToken, leaseToken),
          eq(storageLegacyCleanupTargets.fence, target.fence),
        ));
    }
  });

  return { claimed: claimed.length, deleted: deleted.length, retryable: retryable.length };
}

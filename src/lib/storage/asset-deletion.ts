import "server-only";

import { randomUUID } from "node:crypto";
import { and, asc, eq, gt, inArray, lt, or, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  changeSetItems,
  changeSets,
  chatCanvases,
  chatAttachments,
  extensionRecoveryDrafts,
  fileVersions,
  githubSyncSnapshotAssets,
  importJobs,
  profiles,
  profileContributionMediaAssets,
  workspaceNodes,
  workspaceUpdateDraftMediaAssets,
  workspaceUpdateMediaAssets,
  workspaces,
  storageQuotaScopes,
  storageAssetPins,
  storageAssets,
  uploadIntents,
} from "@/lib/db/schema";
import { createAdminClient } from "@/lib/supabase/server";
import { getS3BackupConfig } from "@/lib/storage/s3-backup-client";

// Runs every 2 hours, so one run has to carry what used to be spread across 24.
export const DELETE_BATCH_SIZE = 500;
const DELETE_LEASE_MS = 5 * 60 * 1000;

export function hasNoLiveReference() {
  return and(
    sql`NOT EXISTS (
      SELECT 1 FROM ${profiles}
      WHERE ${profiles.avatarAssetId} = ${storageAssets.id}
         OR ${profiles.bannerAssetId} = ${storageAssets.id}
    )`,
    sql`NOT EXISTS (
      SELECT 1 FROM ${workspaces}
      WHERE ${workspaces.coverImageAssetId} = ${storageAssets.id}
         OR (
           ${workspaces.id} = ${storageAssets.projectId}
           AND ${workspaces.coverImageAssetId} IS NULL
           AND ${workspaces.coverImage} LIKE ('%' || ${storageAssets.storageKey} || '%')
         )
    )`,
    sql`NOT EXISTS (
      SELECT 1 FROM ${profileContributionMediaAssets}
      WHERE ${profileContributionMediaAssets.assetId} = ${storageAssets.id}
    )`,
    sql`NOT EXISTS (
      SELECT 1 FROM ${workspaceNodes}
      WHERE ${workspaceNodes.assetId} = ${storageAssets.id}
    )`,
    sql`NOT EXISTS (
      SELECT 1 FROM ${fileVersions}
      WHERE ${fileVersions.assetId} = ${storageAssets.id}
    )`,
    sql`NOT EXISTS (
      SELECT 1 FROM ${chatAttachments}
      WHERE ${chatAttachments.assetId} = ${storageAssets.id}
    )`,
    // Canvas images are referenced only by the canvas (GIN on asset_ids).
    sql`NOT EXISTS (
      SELECT 1 FROM ${chatCanvases}
      WHERE ${chatCanvases.assetIds} @> ARRAY[${storageAssets.id}]::uuid[]
    )`,
    // ponytail: an unsent chat upload stays for an hour (the old upload-session
    // TTL). ceiling: a draft attachment older than that must be re-uploaded.
    // upgrade: persist drafts server-side if users report lost attachments.
    sql`NOT (
      ${storageAssets.purpose} = 'chat_attachment:file'
      AND ${storageAssets.createdAt} > now() - interval '1 hour'
    )`,
    sql`NOT EXISTS (
      SELECT 1 FROM ${workspaceUpdateMediaAssets}
      WHERE ${workspaceUpdateMediaAssets.assetId} = ${storageAssets.id}
    )`,
    sql`NOT EXISTS (
      SELECT 1 FROM ${workspaceUpdateDraftMediaAssets}
      WHERE ${workspaceUpdateDraftMediaAssets.assetId} = ${storageAssets.id}
    )`,
    sql`NOT EXISTS (
      SELECT 1 FROM ${extensionRecoveryDrafts}
      WHERE ${extensionRecoveryDrafts.assetId} = ${storageAssets.id}
    )`,
    sql`NOT EXISTS (
      SELECT 1 FROM ${importJobs}
      WHERE ${importJobs.manifestAssetId} = ${storageAssets.id}
    )`,
    sql`NOT EXISTS (
      SELECT 1 FROM ${githubSyncSnapshotAssets}
      WHERE ${githubSyncSnapshotAssets.assetId} = ${storageAssets.id}
    )`,
    // Change set content (report G6, G19): kept while its set is open or ready, and for 7 days after a discard or undo
    // so Copy as new draft still works. Applied content is referenced by its file versions.
    sql`NOT EXISTS (
      SELECT 1 FROM ${changeSetItems}
      JOIN ${changeSets} ON ${changeSets.id} = ${changeSetItems.changeSetId}
      WHERE (${changeSetItems.assetId} = ${storageAssets.id} OR ${changeSetItems.mergedAssetId} = ${storageAssets.id})
        AND (${changeSets.status} IN ('open', 'ready', 'applying') OR ${changeSets.updatedAt} > now() - interval '7 days')
    )`,
    sql`NOT EXISTS (
      SELECT 1 FROM ${storageAssetPins}
      WHERE ${storageAssetPins.assetId} = ${storageAssets.id}
        AND ${storageAssetPins.expiresAt} > now()
    )`,
    sql`(
      ${storageAssets.purpose} IN ('profile_image:avatar', 'profile_image:banner')
      OR NOT EXISTS (
        SELECT 1 FROM ${storageAssets} derivative
        WHERE derivative.source_asset_id = ${storageAssets.id}
          AND derivative.state NOT IN ('deleted', 'missing')
      )
    )`,
  );
}

type AssetExecutor = Pick<typeof db, "update">;

/**
 * The one way to retire a detached verified asset: it moves to delete_pending
 * only when nothing else still references it (another update, a version, a
 * canvas, ...). Call it in the same transaction that removed the reference
 * (COR-045). Returns the ids actually scheduled.
 */
export async function scheduleAssetDeletionIfUnreferenced(
  executor: AssetExecutor,
  assetIds: ReadonlyArray<string | null | undefined>,
  options: { lastErrorCode?: string; deleteAfter?: Date } = {},
): Promise<string[]> {
  const ids = Array.from(new Set(assetIds.filter((id): id is string => Boolean(id))));
  if (ids.length === 0) return [];
  const scheduled = await executor.update(storageAssets)
    .set({
      state: "delete_pending",
      deleteAfter: options.deleteAfter ?? sql`GREATEST(${storageAssets.expiresAt} + interval '5 minutes', now())`,
      ...(options.lastErrorCode ? { lastErrorCode: options.lastErrorCode } : {}),
      updatedAt: new Date(),
    })
    .where(and(
      inArray(storageAssets.id, ids),
      eq(storageAssets.state, "verified"),
      hasNoLiveReference(),
    ))
    .returning({ id: storageAssets.id });
  return scheduled.map((row) => row.id);
}

export async function scheduleAbandonedStorageAssets() {
  const graceCutoff = new Date(Date.now() - 5 * 60 * 1000);
  return db.transaction(async (tx) => {
    const candidates = await tx
      .select({ id: storageAssets.id })
      .from(storageAssets)
      .where(and(
        inArray(storageAssets.state, ["pending", "verified"]),
        lt(storageAssets.expiresAt, graceCutoff),
        sql`NOT EXISTS (
          SELECT 1 FROM ${uploadIntents}
          WHERE ${uploadIntents.assetId} = ${storageAssets.id}
            AND ${uploadIntents.status} = 'pending'
            AND ${gt(uploadIntents.expiresAt, graceCutoff)}
        )`,
        hasNoLiveReference(),
      ))
      .orderBy(asc(storageAssets.expiresAt), asc(storageAssets.id))
      .limit(DELETE_BATCH_SIZE)
      .for("update", { skipLocked: true });
    if (candidates.length === 0) return { scheduled: 0 };
    const updated = await tx.update(storageAssets)
      .set({
        state: "delete_pending",
        deleteAfter: new Date(),
        lastErrorCode: "ABANDONED_UNATTACHED",
        updatedAt: new Date(),
      })
      .where(and(
        inArray(storageAssets.id, candidates.map((candidate) => candidate.id)),
        inArray(storageAssets.state, ["pending", "verified"]),
      ))
      .returning({ id: storageAssets.id });
    return { scheduled: updated.length };
  });
}

export async function cleanupExpiredStorageAssetPins() {
  const expired = await db
    .select({ id: storageAssetPins.id })
    .from(storageAssetPins)
    .where(lt(storageAssetPins.expiresAt, new Date()))
    .orderBy(asc(storageAssetPins.expiresAt), asc(storageAssetPins.id))
    .limit(1_000);
  if (expired.length === 0) return { expiredPins: 0 };
  const removed = await db
    .delete(storageAssetPins)
    .where(inArray(storageAssetPins.id, expired.map((pin) => pin.id)))
    .returning({ id: storageAssetPins.id });
  return { expiredPins: removed.length };
}

/**
 * Claims a bounded deletion batch, removes bytes outside the transaction, and
 * accepts completion only from the current fenced lease.
 */
export async function deleteEligibleStorageAssets() {
  const now = new Date();
  const leaseToken = randomUUID();
  const leaseExpiresAt = new Date(now.getTime() + DELETE_LEASE_MS);
  const claimed = await db.transaction(async (tx) => {
    const expiredLeases = await tx
      .select({ id: storageAssets.id })
      .from(storageAssets)
      .where(and(
        eq(storageAssets.state, "deleting"),
        lt(storageAssets.deletionLeaseExpiresAt, now),
      ))
      .orderBy(asc(storageAssets.deletionLeaseExpiresAt), asc(storageAssets.id))
      .limit(DELETE_BATCH_SIZE)
      .for("update", { skipLocked: true });
    if (expiredLeases.length > 0) {
      await tx.update(storageAssets)
        .set({
          state: "delete_pending",
          deleteAfter: now,
          deletionLeaseToken: null,
          deletionLeaseExpiresAt: null,
          lastErrorCode: "DELETION_LEASE_EXPIRED",
          updatedAt: now,
        })
        .where(and(
          inArray(storageAssets.id, expiredLeases.map((asset) => asset.id)),
          eq(storageAssets.state, "deleting"),
          lt(storageAssets.deletionLeaseExpiresAt, now),
        ));
    }
    // A pending deletion that something references again (or was scheduled
    // before the reference check existed) becomes servable again (COR-045).
    const restorable = await tx
      .select({ id: storageAssets.id })
      .from(storageAssets)
      .where(and(eq(storageAssets.state, "delete_pending"), sql`NOT (${hasNoLiveReference()})`))
      .limit(DELETE_BATCH_SIZE)
      .for("update", { skipLocked: true });
    if (restorable.length > 0) {
      await tx.update(storageAssets)
        .set({ state: "verified", deleteAfter: null, lastErrorCode: "LIVE_REFERENCE_RESTORED", updatedAt: now })
        .where(and(inArray(storageAssets.id, restorable.map((asset) => asset.id)), eq(storageAssets.state, "delete_pending")));
    }
    const candidates = await tx
      .select({ id: storageAssets.id })
      .from(storageAssets)
      .where(and(
        eq(storageAssets.state, "delete_pending"),
        lt(storageAssets.deleteAfter, now),
        or(
          eq(storageAssets.backupState, "verified"),
          eq(storageAssets.backupState, "not_required"),
          // Backups off (no STORAGE_BACKUP_AWS_*): no backup will ever come, so waiting
          // for one only keeps deleted files forever.
          getS3BackupConfig() ? undefined : eq(storageAssets.backupState, "pending"),
        ),
        hasNoLiveReference(),
      ))
      .orderBy(asc(storageAssets.deleteAfter), asc(storageAssets.id))
      .limit(DELETE_BATCH_SIZE)
      .for("update", { skipLocked: true });
    if (candidates.length === 0) return [];

    return tx
      .update(storageAssets)
      .set({
        state: "deleting",
        deletionLeaseToken: leaseToken,
        deletionLeaseExpiresAt: leaseExpiresAt,
        deletionFence: sql`${storageAssets.deletionFence} + 1`,
        updatedAt: now,
      })
      .where(and(
        inArray(storageAssets.id, candidates.map((candidate) => candidate.id)),
        eq(storageAssets.state, "delete_pending"),
      ))
      .returning({
        id: storageAssets.id,
        ownerUserId: storageAssets.ownerUserId,
        projectId: storageAssets.projectId,
        bucket: storageAssets.bucket,
        storageKey: storageAssets.storageKey,
        declaredSize: storageAssets.declaredSize,
        verifiedSize: storageAssets.verifiedSize,
        quotaTracked: storageAssets.quotaTracked,
        fence: storageAssets.deletionFence,
      });
  });

  if (claimed.length === 0) return { claimed: 0, deleted: 0, retryable: 0 };

  const admin = await createAdminClient();
  const byBucket = new Map<string, typeof claimed>();
  for (const asset of claimed) {
    const bucket = byBucket.get(asset.bucket) ?? [];
    bucket.push(asset);
    byBucket.set(asset.bucket, bucket);
  }

  const deleted: typeof claimed = [];
  const retryable: typeof claimed = [];
  for (const [bucket, assets] of byBucket) {
    const { error } = await admin.storage
      .from(bucket)
      .remove(assets.map((asset) => asset.storageKey));
    (error ? retryable : deleted).push(...assets);
  }

  await db.transaction(async (tx) => {
    const released: typeof deleted = [];
    for (const asset of deleted) {
      const transitioned = await tx.update(storageAssets)
        .set({
          state: "deleted",
          deletionLeaseToken: null,
          deletionLeaseExpiresAt: null,
          lastErrorCode: null,
          updatedAt: new Date(),
        })
        .where(and(
          eq(storageAssets.id, asset.id),
          eq(storageAssets.state, "deleting"),
          eq(storageAssets.deletionLeaseToken, leaseToken),
          eq(storageAssets.deletionFence, asset.fence),
          hasNoLiveReference(),
        ))
        .returning({ id: storageAssets.id });
      if (transitioned.length === 1) released.push(asset);
    }
    for (const asset of retryable) {
      await tx.update(storageAssets)
        .set({
          state: "delete_pending",
          deleteAfter: sql`now() + interval '5 minutes'`,
          deletionLeaseToken: null,
          deletionLeaseExpiresAt: null,
          lastErrorCode: "PROVIDER_UNAVAILABLE",
          updatedAt: new Date(),
        })
        .where(and(
          eq(storageAssets.id, asset.id),
          eq(storageAssets.state, "deleting"),
          eq(storageAssets.deletionLeaseToken, leaseToken),
          eq(storageAssets.deletionFence, asset.fence),
        ));
    }

    const releasedQuota = new Map<string, {
      scopeType: "user" | "project";
      scopeId: string;
      reserved: number;
      retained: number;
      outstanding: number;
    }>();
    const quotaItem = (scopeType: "user" | "project", scopeId: string) => {
      const key = `${scopeType}:${scopeId}`;
      const current = releasedQuota.get(key) ?? {
        scopeType,
        scopeId,
        reserved: 0,
        retained: 0,
        outstanding: 0,
      };
      releasedQuota.set(key, current);
      return current;
    };
    for (const asset of released) {
      if (!asset.quotaTracked) continue;
      if (asset.ownerUserId && asset.verifiedSize == null) {
        quotaItem("user", asset.ownerUserId).outstanding += 1;
      }
      const scopeType = asset.projectId ? "project" as const : "user" as const;
      const scopeId = asset.projectId ?? asset.ownerUserId;
      if (!scopeId) continue;
      const current = quotaItem(scopeType, scopeId);
      if (asset.verifiedSize == null) current.reserved += asset.declaredSize;
      else current.retained += asset.verifiedSize;
    }
    for (const item of Array.from(releasedQuota.values()).sort((left, right) => {
      if (left.scopeType !== right.scopeType) return left.scopeType === "user" ? -1 : 1;
      return left.scopeId.localeCompare(right.scopeId);
    })) {
      await tx.update(storageQuotaScopes)
        .set({
          reservedBytes: sql`greatest(${storageQuotaScopes.reservedBytes} - ${item.reserved}, 0)`,
          retainedBytes: sql`greatest(${storageQuotaScopes.retainedBytes} - ${item.retained}, 0)`,
          outstandingUploads: sql`greatest(${storageQuotaScopes.outstandingUploads} - ${item.outstanding}, 0)`,
          updatedAt: new Date(),
        })
        .where(and(
          eq(storageQuotaScopes.scopeType, item.scopeType),
          eq(storageQuotaScopes.scopeId, item.scopeId),
        ));
    }
  });

  return {
    claimed: claimed.length,
    deleted: deleted.length,
    retryable: retryable.length,
  };
}

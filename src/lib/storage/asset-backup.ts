import "server-only";

import { reportedContentLength } from "@/lib/http/content-length";
import { and, asc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { storageAssets } from "@/lib/db/schema";
import { createAdminClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import {
  getS3BackupConfig,
  putS3Backup,
  verifyS3Backup,
} from "@/lib/storage/s3-backup-client";

// Runs hourly, so one run has to carry what used to be spread across 60.
const BACKUP_BATCH_SIZE = 500;
const BACKUP_CONCURRENCY = 8;
const BACKUP_DEADLINE_MS = 30 * 60 * 1000;
// A failed asset waits this long before it is selected again, so permanent failures cannot fill the page.
const BACKUP_RETRY_AFTER = "1 hour";

export async function backupPendingStorageAssets() {
  // Backups are optional until STORAGE_BACKUP_AWS_* is set (see env.ts); assets wait as "pending" and the table is not read.
  const config = getS3BackupConfig();
  if (!config) {
    const result = { attempted: 0, verified: 0, failed: 0 };
    logger.metric("storage.asset_backup.batch", {
      module: "storage",
      action: "backup",
      outcome: "configuration_missing",
      ...result,
    });
    return result;
  }

  const assets = await db
    .select({
      id: storageAssets.id,
      bucket: storageAssets.bucket,
      storageKey: storageAssets.storageKey,
      size: storageAssets.verifiedSize,
      mimeType: storageAssets.verifiedMimeType,
      contentHash: storageAssets.contentHash,
    })
    .from(storageAssets)
    .where(and(
      eq(storageAssets.backupState, "pending"),
      inArray(storageAssets.state, ["verified", "delete_pending"]),
      or(
        isNull(storageAssets.lastErrorCode),
        lt(storageAssets.updatedAt, sql`now() - ${BACKUP_RETRY_AFTER}::interval`),
      ),
    ))
    // Never-attempted assets first; previously failed ones rotate by their last failure time (COR-018).
    // ponytail: failures are retried hourly without a cap; add an attempt counter + quarantine if poison assets accumulate.
    .orderBy(sql`(${storageAssets.lastErrorCode} IS NOT NULL)`, asc(storageAssets.updatedAt), asc(storageAssets.id))
    .limit(BACKUP_BATCH_SIZE);
  if (assets.length === 0) {
    const result = { attempted: 0, verified: 0, failed: 0 };
    logger.metric("storage.asset_backup.batch", {
      module: "storage",
      action: "backup",
      outcome: "idle",
      ...result,
    });
    return result;
  }

  const admin = await createAdminClient();
  let verified = 0;
  let failed = 0;

  const backupOne = async (asset: (typeof assets)[number]) => {
    if (asset.size == null || !asset.mimeType || !asset.contentHash) {
      throw new Error(`Asset ${asset.id} lacks verified backup metadata`);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), BACKUP_DEADLINE_MS);
    try {
      const { data, error } = await admin.storage
        .from(asset.bucket)
        .createSignedUrl(asset.storageKey, 60);
      if (error || !data?.signedUrl) throw new Error(error?.message || "Origin signing failed");
      const origin = await fetch(data.signedUrl, { signal: controller.signal, cache: "no-store" });
      if (!origin.ok || !origin.body) throw new Error(`Origin read failed with HTTP ${origin.status}`);
      const contentLength = reportedContentLength(origin.headers);
      if (contentLength !== null && contentLength !== asset.size) {
        throw new Error("Origin size changed before backup");
      }
      const key = await putS3Backup({
        config,
        object: {
          assetId: asset.id,
          sourceBucket: asset.bucket,
          sourceKey: asset.storageKey,
          contentLength: asset.size,
          contentType: asset.mimeType,
          sha256: asset.contentHash,
        },
        body: origin.body,
        signal: controller.signal,
      });
      await verifyS3Backup({
        config,
        key,
        contentLength: asset.size,
        sha256: asset.contentHash,
        signal: controller.signal,
      });
      const updated = await db.update(storageAssets)
        .set({ backupState: "verified", lastErrorCode: null, updatedAt: new Date() })
        .where(and(
          eq(storageAssets.id, asset.id),
          eq(storageAssets.backupState, "pending"),
          eq(storageAssets.contentHash, asset.contentHash),
          eq(storageAssets.verifiedSize, asset.size),
        ))
        .returning({ id: storageAssets.id });
      if (updated.length !== 1) throw new Error("Asset changed while backup was running");
    } finally {
      clearTimeout(timer);
    }
  };

  for (let offset = 0; offset < assets.length; offset += BACKUP_CONCURRENCY) {
    const results = await Promise.allSettled(
      assets.slice(offset, offset + BACKUP_CONCURRENCY).map(backupOne),
    );
    const batch = assets.slice(offset, offset + BACKUP_CONCURRENCY);
    for (const [index, result] of results.entries()) {
      if (result.status === "fulfilled") {
        verified += 1;
        continue;
      }
      failed += 1;
      // Stamp the failure so the next page starts with assets that have not failed yet.
      await db.update(storageAssets)
        .set({ lastErrorCode: "backup_failed", updatedAt: new Date() })
        .where(and(eq(storageAssets.id, batch[index]!.id), eq(storageAssets.backupState, "pending")))
        .catch(() => undefined);
    }
  }
  const result = { attempted: assets.length, verified, failed };
  logger.metric("storage.asset_backup.batch", {
    module: "storage",
    action: "backup",
    outcome: failed > 0 ? "partial_failure" : "success",
    ...result,
  });
  if (failed > 0) throw new Error(`S3 backup failed for ${failed} of ${assets.length} assets`);
  return result;
}

/**
 * One-off backfill: verify legacy file bytes, populate full content hashes,
 * register canonical storage assets, and attach each retained version.
 *
 * Strategy
 *   1. Keyset-page file_versions rows where content_hash IS NULL and s3_key != ''.
 *   2. For each, stream the entire blob through SHA-256 with an idle deadline.
 *   3. Compare-and-swap the digest only while key and revision remain unchanged.
 *
 * Safety
 *   • Runs in batches of 25, with a short inter-batch pause, to avoid storage
 *     throttling on large projects.
 *   • Idempotent: re-running skips already-hashed rows.
 *   • Successful rows are durable checkpoints. Any partial failure exits 1,
 *     while failed rows remain NULL and are retried on the next run.
 *
 * Usage
 *   npm run repair:file-hashes            # dry run: counts candidates, writes nothing
 *   npm run repair:file-hashes -- --apply
 */

import { config } from "dotenv";
config({ path: ".env.local" });
config();

if (process.env.DATABASE_URL) {
  process.env.DATABASE_URL = process.env.DATABASE_URL.replace("localhost", "127.0.0.1");
}

import { createHash } from "node:crypto";
import { and, asc, eq, gt, isNull, ne, or, sql } from "drizzle-orm";
import {
  fileVersions,
  workspaceNodes,
  storageAssets,
  storageRepairFailures,
} from "../../../src/lib/db/schema";
import { createAdminClient } from "../../../src/lib/supabase/server";

const BUCKET = "project-files";
const BATCH_SIZE = 25;
const requestedConcurrency = Number(process.env.STORAGE_REPAIR_CONCURRENCY ?? 8);
const VERIFY_CONCURRENCY = Number.isFinite(requestedConcurrency)
  ? Math.max(1, Math.min(16, Math.floor(requestedConcurrency)))
  : 8;
const BATCH_PAUSE_MS = 200;
const IDLE_TIMEOUT_MS = 30_000;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

type Row = {
  id: string;
  nodeId: string;
  s3Key: string;
  version: number;
  size: number;
  mimeType: string;
  projectId: string;
  contentHash: string | null;
  currentVersion: number;
  currentS3Key: string | null;
};

let db: (typeof import("../../../src/lib/db"))["db"];

async function fetchBatch(afterId: string | null): Promise<Row[]> {
  const rows = await db
    .select({
      id: fileVersions.id,
      nodeId: fileVersions.nodeId,
      s3Key: fileVersions.s3Key,
      version: fileVersions.version,
      size: fileVersions.size,
      mimeType: fileVersions.mimeType,
      projectId: workspaceNodes.projectId,
      contentHash: fileVersions.contentHash,
      currentVersion: workspaceNodes.currentVersion,
      currentS3Key: workspaceNodes.s3Key,
    })
    .from(fileVersions)
    .innerJoin(workspaceNodes, eq(workspaceNodes.id, fileVersions.nodeId))
    .where(
      and(
        or(
          isNull(fileVersions.assetId),
          and(
            isNull(fileVersions.contentHash),
            sql`NOT EXISTS (
              SELECT 1 FROM public.storage_assets missing_asset
              WHERE missing_asset.id = ${fileVersions.assetId}
                AND missing_asset.state = 'missing'
            )`,
          ),
        ),
        sql`NOT EXISTS (
          SELECT 1 FROM public.storage_repair_failures quarantined_failure
          WHERE quarantined_failure.repair_kind = 'file_hash_backfill'
            AND quarantined_failure.subject_id = ${fileVersions.id}::text
            AND quarantined_failure.error_code = 'HISTORICAL_BYTES_UNAVAILABLE'
            AND quarantined_failure.resolved_at IS NULL
        )`,
        ne(fileVersions.s3Key, ""),
        afterId ? gt(fileVersions.id, afterId) : undefined,
      ),
    )
    .orderBy(asc(fileVersions.id))
    .limit(BATCH_SIZE);
  return rows;
}

function isConfirmedMissingObject(error: unknown) {
  const detail = error instanceof Error ? error.message : String(error);
  return detail === "signing failed: Object not found" || detail === "read failed with HTTP 404";
}

function isHistoricalBytesUnavailable(error: unknown) {
  const detail = error instanceof Error ? error.message : String(error);
  return detail.startsWith("HISTORICAL_VERSION_BYTES_UNAVAILABLE:");
}

async function quarantineHistoricalVersion(row: Row, detail: string) {
  await db.insert(storageRepairFailures).values({
    repairKind: "file_hash_backfill",
    subjectId: row.id,
    errorCode: "HISTORICAL_BYTES_UNAVAILABLE",
    detail: detail.slice(0, 2_000),
    nextRetryAt: null,
  }).onConflictDoUpdate({
    target: [storageRepairFailures.repairKind, storageRepairFailures.subjectId],
    set: {
      errorCode: "HISTORICAL_BYTES_UNAVAILABLE",
      detail: detail.slice(0, 2_000),
      nextRetryAt: null,
      resolvedAt: null,
      updatedAt: new Date(),
    },
  });
}

async function quarantineMissingObject(row: Row, detail: string) {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.maintenance_operation', 'hash_backfill', true)`);
    const [insertedAsset] = await tx.insert(storageAssets).values({
      projectId: row.projectId,
      bucket: BUCKET,
      storageKey: row.s3Key,
      purpose: "workspace_file:file",
      state: "missing",
      declaredMimeType: row.mimeType || "application/octet-stream",
      declaredSize: Math.max(0, row.size),
      metadata: {
        source: "file_hash_backfill",
        versionId: row.id,
        provenance: "legacy_object_confirmed_missing",
      },
      expiresAt: new Date(),
      backupState: "not_required",
      lastErrorCode: "OBJECT_MISSING_QUARANTINED",
    }).onConflictDoNothing({
      target: [storageAssets.bucket, storageAssets.storageKey],
    }).returning({ id: storageAssets.id, projectId: storageAssets.projectId, state: storageAssets.state });
    const [asset] = insertedAsset
      ? [insertedAsset]
      : await tx.select({
          id: storageAssets.id,
          projectId: storageAssets.projectId,
          state: storageAssets.state,
        }).from(storageAssets).where(and(
          eq(storageAssets.bucket, BUCKET),
          eq(storageAssets.storageKey, row.s3Key),
        )).limit(1);
    if (!asset || asset.projectId !== row.projectId || asset.state !== "missing") {
      throw new Error("missing storage asset identity conflicts with the legacy file reference");
    }
    const attached = await tx.update(fileVersions)
      .set({ assetId: asset.id })
      .where(and(
        eq(fileVersions.id, row.id),
        eq(fileVersions.version, row.version),
        eq(fileVersions.s3Key, row.s3Key),
        isNull(fileVersions.assetId),
      ))
      .returning({ id: fileVersions.id });
    if (attached.length !== 1) throw new Error("file version changed while missing content was quarantined");
    if (row.version === row.currentVersion && row.s3Key === row.currentS3Key) {
      await tx.update(workspaceNodes)
        .set({ assetId: asset.id, updatedAt: new Date() })
        .where(and(
          eq(workspaceNodes.id, row.nodeId),
          eq(workspaceNodes.projectId, row.projectId),
          eq(workspaceNodes.currentVersion, row.version),
          eq(workspaceNodes.s3Key, row.s3Key),
          isNull(workspaceNodes.assetId),
        ));
    }
    await tx.insert(storageRepairFailures).values({
      repairKind: "file_hash_backfill",
      subjectId: row.id,
      errorCode: "OBJECT_MISSING_QUARANTINED",
      detail: detail.slice(0, 2_000),
      nextRetryAt: null,
    }).onConflictDoUpdate({
      target: [storageRepairFailures.repairKind, storageRepairFailures.subjectId],
      set: {
        errorCode: "OBJECT_MISSING_QUARANTINED",
        detail: detail.slice(0, 2_000),
        nextRetryAt: null,
        resolvedAt: null,
        updatedAt: new Date(),
      },
    });
  });
}

async function hashBlob(admin: Awaited<ReturnType<typeof createAdminClient>>, row: Row) {
  if (row.size < 0 || row.size > MAX_FILE_BYTES) {
    throw new Error(`declared size ${row.size} exceeds the maintained file contract`);
  }
  const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(row.s3Key, 60);
  if (error || !data?.signedUrl) throw new Error(`signing failed: ${error?.message ?? "no URL"}`);

  const controller = new AbortController();
  let timer = setTimeout(() => controller.abort(), IDLE_TIMEOUT_MS);
  try {
    const response = await fetch(data.signedUrl, { signal: controller.signal, cache: "no-store" });
    if (!response.ok || !response.body) throw new Error(`read failed with HTTP ${response.status}`);
    const digest = createHash("sha256");
    const reader = response.body.getReader();
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      clearTimeout(timer);
      timer = setTimeout(() => controller.abort(), IDLE_TIMEOUT_MS);
      received += value.byteLength;
      if (received > MAX_FILE_BYTES) {
        await reader.cancel("size limit exceeded");
        throw new Error("stored object exceeds the maintained file limit");
      }
      digest.update(value);
    }
    return {
      digest: digest.digest("hex"),
      size: received,
      mimeType: response.headers.get("content-type")?.split(";", 1)[0]?.trim() || row.mimeType,
    };
  } finally {
    clearTimeout(timer);
  }
}

const APPLY = process.argv.includes("--apply");

async function main() {
  ({ db } = await import("../../../src/lib/db"));
  if (!APPLY) {
    const firstBatch = await fetchBatch(null);
    console.log(`[backfill-file-hashes] dry run: ${firstBatch.length}${firstBatch.length === BATCH_SIZE ? "+" : ""} version(s) need hashing. Re-run with --apply to write.`);
    return;
  }
  console.log("[backfill-file-hashes] starting…");
  const admin = await createAdminClient();

  let processed = 0;
  let succeeded = 0;
  let quarantined = 0;
  let failed = 0;
  let cursor: string | null = null;

  for (let guard = 0; guard < 10_000; guard++) {
    const batch = await fetchBatch(cursor);
    if (batch.length === 0) break;
    cursor = batch.at(-1)!.id;

    let nextIndex = 0;
    await Promise.all(Array.from({ length: Math.min(VERIFY_CONCURRENCY, batch.length) }, async () => {
      while (nextIndex < batch.length) {
        const row = batch[nextIndex++]!;
        processed++;
        try {
          const verified = await hashBlob(admin, row);
          const isCurrentRevision = row.version === row.currentVersion && row.s3Key === row.currentS3Key;
          const metadataChanged = row.size !== verified.size
            || (row.contentHash != null && row.contentHash !== verified.digest);
          // A historical revision stored under the node's current (mutable) key
          // with no prior digest may now hold newer bytes: never certify it (COR-064).
          const sharesMutableKey = row.s3Key === row.currentS3Key && row.contentHash == null;
          if (!isCurrentRevision && (metadataChanged || sharesMutableKey)) {
            throw new Error(
              `HISTORICAL_VERSION_BYTES_UNAVAILABLE:stored=${verified.size}:recorded=${row.size}`,
            );
          }
          const updated = await db.transaction(async (tx) => {
          await tx.execute(sql`SELECT set_config('app.maintenance_operation', 'hash_backfill', true)`);
          const [insertedAsset] = await tx.insert(storageAssets).values({
            projectId: row.projectId,
            bucket: BUCKET,
            storageKey: row.s3Key,
            purpose: "workspace_file:file",
            state: "verified",
            declaredMimeType: verified.mimeType,
            declaredSize: verified.size,
            verifiedMimeType: verified.mimeType,
            verifiedSize: verified.size,
            contentHash: verified.digest,
            metadata: {
              source: "file_hash_backfill",
              versionId: row.id,
              provenance: metadataChanged ? "legacy_mutable_key_current_bytes" : "verified_legacy_bytes",
            },
            expiresAt: new Date(),
            verifiedAt: new Date(),
            backupState: "pending",
          }).onConflictDoNothing({
            target: [storageAssets.bucket, storageAssets.storageKey],
          }).returning({
            id: storageAssets.id,
            projectId: storageAssets.projectId,
            state: storageAssets.state,
            contentHash: storageAssets.contentHash,
            verifiedSize: storageAssets.verifiedSize,
          });
          const [asset] = insertedAsset
            ? [insertedAsset]
            : await tx.select({
                id: storageAssets.id,
                projectId: storageAssets.projectId,
                state: storageAssets.state,
                contentHash: storageAssets.contentHash,
                verifiedSize: storageAssets.verifiedSize,
              }).from(storageAssets).where(and(
                eq(storageAssets.bucket, BUCKET),
                eq(storageAssets.storageKey, row.s3Key),
              )).limit(1);
          if (
            !asset
            || asset.projectId !== row.projectId
            || asset.state !== "verified"
            || asset.contentHash !== verified.digest
            || asset.verifiedSize !== verified.size
          ) {
            throw new Error("existing storage asset does not match the verified legacy bytes");
          }
          const rows = await tx
            .update(fileVersions)
            .set({
              contentHash: verified.digest,
              assetId: asset.id,
              size: verified.size,
              mimeType: verified.mimeType,
              attribution: sql`coalesce(${fileVersions.attribution}, '{}'::jsonb) || ${JSON.stringify({
                source: "file_hash_backfill",
                provenance: metadataChanged ? "legacy_mutable_key_current_bytes" : "verified_legacy_bytes",
                repairedAt: new Date().toISOString(),
              })}::jsonb`,
            })
            .where(and(
              eq(fileVersions.id, row.id),
              eq(fileVersions.version, row.version),
              eq(fileVersions.s3Key, row.s3Key),
              or(isNull(fileVersions.contentHash), isNull(fileVersions.assetId)),
            ))
            .returning({ id: fileVersions.id });
          if (rows.length === 1) {
            if (isCurrentRevision) {
              await tx.update(workspaceNodes)
                .set({
                  assetId: asset.id,
                  size: verified.size,
                  mimeType: verified.mimeType,
                  updatedAt: new Date(),
                })
                .where(and(
                  eq(workspaceNodes.id, row.nodeId),
                  eq(workspaceNodes.projectId, row.projectId),
                  eq(workspaceNodes.currentVersion, row.version),
                  eq(workspaceNodes.s3Key, row.s3Key),
                ));
            }
            await tx.update(storageRepairFailures)
              .set({ resolvedAt: new Date(), updatedAt: new Date() })
              .where(and(
                eq(storageRepairFailures.repairKind, "file_hash_backfill"),
                eq(storageRepairFailures.subjectId, row.id),
              ));
          }
          return rows;
          });
          if (updated.length !== 1) throw new Error("row changed while the hash was streaming");
          succeeded++;
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err);
          if (isConfirmedMissingObject(err)) {
            try {
              await quarantineMissingObject(row, detail);
              quarantined++;
              console.warn(`[backfill-file-hashes] quarantined missing object id=${row.id} node=${row.nodeId}`);
              continue;
            } catch (quarantineError) {
              err = quarantineError;
            }
          }
          if (isHistoricalBytesUnavailable(err)) {
            await quarantineHistoricalVersion(row, detail);
            quarantined++;
            console.warn(`[backfill-file-hashes] quarantined unavailable historical bytes id=${row.id} node=${row.nodeId}`);
            continue;
          }
          failed++;
          const finalDetail = err instanceof Error ? err.message : String(err);
          await db.insert(storageRepairFailures).values({
          repairKind: "file_hash_backfill",
          subjectId: row.id,
          errorCode: "HASH_BACKFILL_FAILED",
          detail: finalDetail.slice(0, 2_000),
          nextRetryAt: new Date(Date.now() + 60 * 60 * 1000),
          }).onConflictDoUpdate({
          target: [storageRepairFailures.repairKind, storageRepairFailures.subjectId],
          set: {
            errorCode: "HASH_BACKFILL_FAILED",
            detail: finalDetail.slice(0, 2_000),
            attempts: sql`${storageRepairFailures.attempts} + 1`,
            nextRetryAt: new Date(Date.now() + 60 * 60 * 1000),
            resolvedAt: null,
            updatedAt: new Date(),
          },
          });
          console.warn(
            `[backfill-file-hashes] failed id=${row.id} node=${row.nodeId}: ${finalDetail}`,
          );
        }
      }
    }));

    await new Promise((r) => setTimeout(r, BATCH_PAUSE_MS));
    console.log(`[backfill-file-hashes] checkpoint=${cursor} processed=${processed} failed=${failed}`);
    if (batch.length < BATCH_SIZE) break;
  }

  console.log(
    `[backfill-file-hashes] done. processed=${processed} succeeded=${succeeded} quarantined=${quarantined} failed=${failed}`,
  );
  // Sanity probe — any stragglers left?
  const result = await db.execute<{ remaining: number }>(
    sql`SELECT COUNT(*)::int AS remaining FROM file_versions version
        WHERE version.s3_key <> ''
          AND NOT EXISTS (
            SELECT 1 FROM storage_repair_failures failure
            WHERE failure.repair_kind = 'file_hash_backfill'
              AND failure.subject_id = version.id::text
              AND failure.error_code = 'HISTORICAL_BYTES_UNAVAILABLE'
              AND failure.resolved_at IS NULL
          )
          AND (
            version.asset_id IS NULL
            OR (
              version.content_hash IS NULL
              AND NOT EXISTS (
                SELECT 1 FROM storage_assets asset
                WHERE asset.id = version.asset_id AND asset.state = 'missing'
              )
            )
          )`,
  );
  const remaining = result[0]?.remaining ?? 0;
  console.log(`[backfill-file-hashes] remaining unregistered or unhashed versions: ${remaining}`);

  process.exitCode = failed > 0 || remaining > 0 ? 1 : 0;
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    console.error("[backfill-file-hashes] fatal:", err);
    process.exit(1);
  });

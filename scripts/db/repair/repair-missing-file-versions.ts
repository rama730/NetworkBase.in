/**
 * Repair stored file nodes that lack their current file_versions row.
 *
 * Dry-run is the default. Pass --apply to verify the complete object and add
 * an honest version row. Missing, oversized, ambiguous, or changing objects
 * remain untouched and are recorded in storage_repair_failures.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { createHash } from "node:crypto";
import { and, asc, eq, gt, isNotNull, isNull, sql } from "drizzle-orm";

import {
  fileVersions,
  projectNodes,
  storageAssets,
  storageRepairFailures,
} from "../../../src/lib/db/schema";
import { parseProjectFileKey } from "../../../src/lib/storage/workspace-file-key";
import { createAdminClient } from "../../../src/lib/supabase/server";

const APPLY = process.argv.includes("--apply");
const BATCH_SIZE = 50;
const requestedConcurrency = Number(process.env.STORAGE_REPAIR_CONCURRENCY ?? 8);
const VERIFY_CONCURRENCY = Number.isFinite(requestedConcurrency)
  ? Math.max(1, Math.min(16, Math.floor(requestedConcurrency)))
  : 8;
const IDLE_TIMEOUT_MS = 30_000;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const limitArgument = process.argv.find((argument) => argument.startsWith("--limit="));
const RUN_LIMIT = Math.max(1, Math.min(100_000, Number(limitArgument?.split("=")[1] ?? 100_000)));

type Candidate = {
  id: string;
  projectId: string;
  s3Key: string | null;
  size: number | null;
  mimeType: string | null;
  currentVersion: number;
};

let db: (typeof import("../../../src/lib/db"))["db"];

async function fetchCandidates(afterId: string | null): Promise<Candidate[]> {
  return db.select({
    id: projectNodes.id,
    projectId: projectNodes.projectId,
    s3Key: projectNodes.s3Key,
    size: projectNodes.size,
    mimeType: projectNodes.mimeType,
    currentVersion: projectNodes.currentVersion,
  })
    .from(projectNodes)
    .where(and(
      eq(projectNodes.type, "file"),
      isNull(projectNodes.deletedAt),
      isNotNull(projectNodes.s3Key),
      afterId ? gt(projectNodes.id, afterId) : undefined,
      sql`NOT EXISTS (
        SELECT 1 FROM ${fileVersions}
        WHERE ${fileVersions.nodeId} = ${projectNodes.id}
          AND ${fileVersions.version} = ${projectNodes.currentVersion}
      )`,
    ))
    .orderBy(asc(projectNodes.id))
    .limit(BATCH_SIZE);
}

async function streamDigest(signedUrl: string, expectedSize: number) {
  const controller = new AbortController();
  let timer = setTimeout(() => controller.abort(), IDLE_TIMEOUT_MS);
  try {
    const response = await fetch(signedUrl, { signal: controller.signal, cache: "no-store" });
    if (!response.ok || !response.body) throw new Error(`OBJECT_READ_HTTP_${response.status}`);
    const lengthHeader = response.headers.get("content-length");
    if (lengthHeader != null && Number(lengthHeader) !== expectedSize) {
      throw new Error("OBJECT_SIZE_MISMATCH");
    }
    const digest = createHash("sha256");
    const reader = response.body.getReader();
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      clearTimeout(timer);
      timer = setTimeout(() => controller.abort(), IDLE_TIMEOUT_MS);
      received += value.byteLength;
      if (received > expectedSize || received > MAX_FILE_BYTES) {
        await reader.cancel("object exceeds maintained limit");
        throw new Error("OBJECT_SIZE_MISMATCH");
      }
      digest.update(value);
    }
    if (received !== expectedSize) throw new Error("OBJECT_SIZE_MISMATCH");
    return digest.digest("hex");
  } finally {
    clearTimeout(timer);
  }
}

async function recordFailure(candidate: Candidate, error: unknown) {
  const detail = error instanceof Error ? error.message : String(error);
  await db.insert(storageRepairFailures).values({
    repairKind: "missing_file_version",
    subjectId: candidate.id,
    errorCode: detail.slice(0, 120) || "VERSION_REPAIR_FAILED",
    detail: JSON.stringify({
      projectId: candidate.projectId,
      storageKey: candidate.s3Key,
      version: candidate.currentVersion,
      error: detail,
    }).slice(0, 2_000),
    nextRetryAt: new Date(Date.now() + 60 * 60 * 1000),
  }).onConflictDoUpdate({
    target: [storageRepairFailures.repairKind, storageRepairFailures.subjectId],
    set: {
      errorCode: detail.slice(0, 120) || "VERSION_REPAIR_FAILED",
      detail: JSON.stringify({
        projectId: candidate.projectId,
        storageKey: candidate.s3Key,
        version: candidate.currentVersion,
        error: detail,
      }).slice(0, 2_000),
      attempts: sql`${storageRepairFailures.attempts} + 1`,
      nextRetryAt: new Date(Date.now() + 60 * 60 * 1000),
      resolvedAt: null,
      updatedAt: new Date(),
    },
  });
}

async function repairCandidate(
  admin: Awaited<ReturnType<typeof createAdminClient>>,
  candidate: Candidate,
) {
  if (!candidate.s3Key || candidate.size == null || !candidate.mimeType) {
    throw new Error("INCOMPLETE_NODE_METADATA");
  }
  const storageKey = candidate.s3Key;
  const size = candidate.size;
  const mimeType = candidate.mimeType;
  if (!Number.isSafeInteger(size) || size < 0 || size > MAX_FILE_BYTES) {
    throw new Error("UNSUPPORTED_OBJECT_SIZE");
  }
  const parsed = parseProjectFileKey(storageKey);
  if (!parsed || parsed.projectId !== candidate.projectId) {
    throw new Error("AMBIGUOUS_STORAGE_KEY");
  }
  const { data, error } = await admin.storage.from("project-files").createSignedUrl(storageKey, 60);
  if (error || !data?.signedUrl) throw new Error(`OBJECT_SIGN_FAILED:${error?.message ?? "missing URL"}`);
  const contentHash = await streamDigest(data.signedUrl, size);

  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.maintenance_operation', 'version_repair', true)`);
    await tx.execute(sql`SELECT id FROM project_nodes WHERE id = ${candidate.id} FOR UPDATE`);
    const current = await tx.query.projectNodes.findFirst({
      where: eq(projectNodes.id, candidate.id),
      columns: {
        id: true,
        projectId: true,
        s3Key: true,
        size: true,
        mimeType: true,
        currentVersion: true,
        deletedAt: true,
      },
    });
    if (
      !current ||
      current.deletedAt ||
      current.projectId !== candidate.projectId ||
      current.s3Key !== storageKey ||
      current.currentVersion !== candidate.currentVersion ||
      current.size !== size ||
      current.mimeType !== mimeType
    ) {
      throw new Error("NODE_CHANGED_DURING_REPAIR");
    }
    const existingVersion = await tx.query.fileVersions.findFirst({
      where: and(
        eq(fileVersions.nodeId, candidate.id),
        eq(fileVersions.version, candidate.currentVersion),
      ),
      columns: { id: true },
    });
    if (existingVersion) return "already_repaired" as const;

    let [asset] = await tx.insert(storageAssets).values({
      projectId: candidate.projectId,
      bucket: "project-files",
      storageKey,
      purpose: "project_file:file",
      state: "verified",
      declaredMimeType: mimeType,
      declaredSize: size,
      verifiedMimeType: mimeType,
      verifiedSize: size,
      contentHash,
      metadata: { source: "missing_file_version_repair", provenance: "unknown" },
      expiresAt: new Date(),
      verifiedAt: new Date(),
      backupState: "pending",
    }).onConflictDoNothing({
      target: [storageAssets.bucket, storageAssets.storageKey],
    }).returning({
      id: storageAssets.id,
      projectId: storageAssets.projectId,
      contentHash: storageAssets.contentHash,
    });
    if (!asset) {
      [asset] = await tx.select({
        id: storageAssets.id,
        projectId: storageAssets.projectId,
        contentHash: storageAssets.contentHash,
      }).from(storageAssets).where(and(
        eq(storageAssets.bucket, "project-files"),
        eq(storageAssets.storageKey, storageKey),
      )).limit(1);
    }
    if (!asset || asset.projectId !== candidate.projectId || asset.contentHash !== contentHash) {
      throw new Error("ASSET_IDENTITY_CONFLICT");
    }

    await tx.insert(fileVersions).values({
      nodeId: candidate.id,
      version: candidate.currentVersion,
      s3Key: storageKey,
      assetId: asset.id,
      size,
      mimeType,
      contentHash,
      uploadedBy: null,
      attribution: {
        source: "missing_file_version_repair",
        provenance: "unknown",
        repairedAt: new Date().toISOString(),
      },
    });
    await tx.update(projectNodes)
      .set({ assetId: asset.id, updatedAt: new Date() })
      .where(and(
        eq(projectNodes.id, candidate.id),
        eq(projectNodes.s3Key, storageKey),
        eq(projectNodes.currentVersion, candidate.currentVersion),
      ));
    await tx.update(storageRepairFailures)
      .set({ resolvedAt: new Date(), updatedAt: new Date() })
      .where(and(
        eq(storageRepairFailures.repairKind, "missing_file_version"),
        eq(storageRepairFailures.subjectId, candidate.id),
      ));
    return "repaired" as const;
  });
}

async function main() {
  ({ db } = await import("../../../src/lib/db"));
  console.log(`[repair-missing-file-versions] mode=${APPLY ? "apply" : "dry-run"} limit=${RUN_LIMIT}`);
  const admin = APPLY ? await createAdminClient() : null;
  let cursor: string | null = null;
  let scanned = 0;
  let repaired = 0;
  let failed = 0;

  while (scanned < RUN_LIMIT) {
    const batch = await fetchCandidates(cursor);
    if (batch.length === 0) break;
    cursor = batch.at(-1)!.id;
    const selected = batch.slice(0, RUN_LIMIT - scanned);
    scanned += selected.length;
    if (APPLY) {
      let nextIndex = 0;
      await Promise.all(Array.from({ length: Math.min(VERIFY_CONCURRENCY, selected.length) }, async () => {
        while (nextIndex < selected.length) {
          const candidate = selected[nextIndex++]!;
          try {
            const result = await repairCandidate(admin!, candidate);
            if (result === "repaired") repaired += 1;
          } catch (error) {
            failed += 1;
            await recordFailure(candidate, error);
            console.error("[repair-missing-file-versions] failed", {
              nodeId: candidate.id,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }));
    }
    console.log(`[repair-missing-file-versions] checkpoint=${cursor} scanned=${scanned} repaired=${repaired} failed=${failed}`);
    if (selected.length < batch.length || batch.length < BATCH_SIZE) break;
  }

  console.log(`[repair-missing-file-versions] done scanned=${scanned} repaired=${repaired} failed=${failed}`);
  if (APPLY && failed > 0) process.exitCode = 1;
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((error) => {
    console.error("[repair-missing-file-versions] fatal", error);
    process.exit(1);
  });

import { normalizeMediaDimensions, type MediaDimensions } from "@/lib/messaging/media-metadata";
import { createHash, randomUUID } from "node:crypto";

import { reportedContentLength } from "@/lib/http/content-length";
import { and, asc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  importJobFiles,
  projects,
  storageAssetOperations,
  storageAssets,
  storageQuotaScopes,
  uploadIntents,
  type UploadIntent,
} from "@/lib/db/schema";
import { createAdminClient } from "@/lib/supabase/server";
import {
  assertUploadIntentBinding,
  classifyStorageVerificationError,
} from "@/lib/upload/storage-asset-contract";
import {
  normalizeAndValidateFileSize,
  normalizeAndValidateMimeType,
  validateUploadedBlobMagicBytes,
} from "@/lib/upload/security";
import {
  assertStorageQuotaAdmission,
  WORKSPACE_STORAGE_LIMIT_BYTES,
  USER_STORAGE_LIMIT_BYTES,
} from "@/lib/storage/storage-quota";
import { ORG_LIMITS } from "@/lib/organizations/config";

const DEFAULT_UPLOAD_INTENT_TTL_MS = 60 * 60 * 1000;
const VERIFICATION_LEASE_MS = 10 * 60 * 1000;
const VERIFICATION_IDLE_TIMEOUT_MS = 30 * 1000;
const VERIFICATION_MAX_DURATION_MS = 10 * 60 * 1000;
const INVALID_UPLOAD_DELETE_MARGIN_MS = 5 * 60 * 1000;
const MAX_INTENTS_PER_BATCH = 50;
const INTENT_CONCURRENCY = 8;

export type UploadIntentScope = "project_file" | "project_update_media" | "profile_image" | "project_cover" | "chat_attachment" | "recovery_draft" | "import_manifest" | "sync_snapshot" | "contribution_image";
export type UploadIntentKind = "file" | "avatar" | "banner" | "cover" | "draft" | "manifest" | "snapshot";

type CreateUploadIntentParams = {
  userId: string;
  projectId?: string | null;
  bucket: string;
  storageKey: string;
  scope: UploadIntentScope;
  kind: UploadIntentKind;
  expectedMimeType: string;
  expectedSize: number;
  metadata?: Record<string, unknown>;
  idempotencyKey?: string | null;
};

class StorageVerificationError extends Error {
  readonly code: string;
  readonly status?: number;

  constructor(message: string, code: string, status?: number) {
    super(message);
    this.name = "StorageVerificationError";
    this.code = code;
    this.status = status;
  }
}

function resolveUploadIntentExpiry() {
  return new Date(Date.now() + DEFAULT_UPLOAD_INTENT_TTL_MS);
}

function uploadPurpose(scope: UploadIntentScope, kind: UploadIntentKind) {
  return `${scope}:${kind}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

function requestFingerprint(params: {
  userId: string;
  projectId: string | null;
  bucket: string;
  storageKey: string;
  scope: UploadIntentScope;
  kind: UploadIntentKind;
  expectedMimeType: string;
  expectedSize: number;
  metadata: Record<string, unknown>;
}) {
  return createHash("sha256")
    .update(JSON.stringify([
      params.userId,
      params.projectId,
      params.bucket,
      params.storageKey,
      params.scope,
      params.kind,
      params.expectedMimeType,
      params.expectedSize,
      canonicalJson(params.metadata),
    ]))
    .digest("hex");
}

function assertPendingIntent(intent: UploadIntent) {
  if (intent.status === "finalized") return;
  if (intent.expiresAt.getTime() <= Date.now()) throw new Error("Upload intent expired");
  if (intent.status !== "pending") throw new Error("Upload intent is no longer usable");
}

function assertIntentMatchesRequest(
  intent: UploadIntent,
  request: {
    userId: string;
    projectId: string | null;
    bucket: string;
    storageKey: string;
    scope: UploadIntentScope;
    kind: UploadIntentKind;
    expectedMimeType: string;
    expectedSize: number;
    metadata: Record<string, unknown>;
  },
) {
  const matches = intent.userId === request.userId
    && intent.projectId === request.projectId
    && intent.bucket === request.bucket
    && intent.storageKey === request.storageKey
    && intent.scope === request.scope
    && intent.kind === request.kind
    && intent.expectedMimeType === request.expectedMimeType
    && intent.expectedSize === request.expectedSize
    && canonicalJson(intent.metadata) === canonicalJson(request.metadata);
  if (!matches) throw new Error("Upload key is already bound to a different request");
  assertPendingIntent(intent);
}

async function markIntentVerificationFailure(
  intent: UploadIntent,
  error: unknown,
  lease?: { token: string; fence: number },
) {
  const reason = error instanceof Error ? error.message : "Upload verification failed";
  const classification = classifyStorageVerificationError(
    error && typeof error === "object"
      ? error as { status?: number; statusCode?: number; code?: string }
      : undefined,
  );
  const now = new Date();

  await db.transaction(async (tx) => {
    await tx
      .update(uploadIntents)
      .set({
        status: classification === "terminal" ? "failed" : "pending",
        failureReason: reason,
        updatedAt: now,
      })
      .where(and(eq(uploadIntents.id, intent.id), eq(uploadIntents.status, "pending")));

    if (!intent.assetId || !lease) return;
    await tx
      .update(storageAssets)
      .set(classification === "terminal"
        ? {
            state: "delete_pending",
            deleteAfter: new Date(intent.expiresAt.getTime() + INVALID_UPLOAD_DELETE_MARGIN_MS),
            lastErrorCode: error instanceof StorageVerificationError ? error.code : "CONTENT_MISMATCH",
            verificationLeaseToken: null,
            verificationLeaseExpiresAt: null,
            updatedAt: now,
          }
        : {
            lastErrorCode: error instanceof StorageVerificationError ? error.code : "PROVIDER_UNAVAILABLE",
            verificationLeaseToken: null,
            verificationLeaseExpiresAt: null,
            updatedAt: now,
          })
      .where(and(
        eq(storageAssets.id, intent.assetId),
        eq(storageAssets.state, "pending"),
        eq(storageAssets.verificationLeaseToken, lease.token),
        eq(storageAssets.verificationFence, lease.fence),
      ));
  });
}

async function verifyStoredObjectBytes(params: {
  signedUrl: string;
  expectedSize: number;
  expectedMimeType: string;
  decodeImage: boolean;
}) {
  const controller = new AbortController();
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const absoluteTimer = setTimeout(() => controller.abort(), VERIFICATION_MAX_DURATION_MS);
  const resetIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => controller.abort(), VERIFICATION_IDLE_TIMEOUT_MS);
  };

  try {
    resetIdleTimer();
    let response: Response;
    try {
      response = await fetch(params.signedUrl, { cache: "no-store", signal: controller.signal });
    } catch (error) {
      throw new StorageVerificationError(
        error instanceof Error ? error.message : "Storage provider did not respond",
        error instanceof Error && error.name === "AbortError" ? "ETIMEDOUT" : "PROVIDER_UNAVAILABLE",
      );
    }
    if (!response.ok) {
      throw new StorageVerificationError(
        `Couldn’t verify uploaded object (${response.status})`,
        response.status >= 500 || response.status === 429 ? "PROVIDER_UNAVAILABLE" : "CONTENT_MISMATCH",
        response.status,
      );
    }
    if (!response.body) {
      throw new StorageVerificationError("Storage provider returned an unreadable body", "PROVIDER_UNAVAILABLE");
    }

    const reportedLength = reportedContentLength(response.headers);
    if (reportedLength !== null && reportedLength !== params.expectedSize) {
      throw new StorageVerificationError("Uploaded object size does not match the declared size", "CONTENT_MISMATCH");
    }

    const hash = createHash("sha256");
    const prefix: number[] = [];
    const imageChunks: Uint8Array[] = [];
    let totalBytes = 0;
    const reader = response.body.getReader();
    try {
      while (true) {
        resetIdleTimer();
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > params.expectedSize) {
          throw new StorageVerificationError("Uploaded object exceeds the declared size", "CONTENT_MISMATCH");
        }
        hash.update(value);
        if (params.decodeImage) imageChunks.push(value);
        for (let index = 0; index < value.byteLength && prefix.length < 32; index += 1) {
          prefix.push(value[index]!);
        }
      }
    } catch (error) {
      await reader.cancel().catch(() => undefined);
      if (controller.signal.aborted) {
        throw new StorageVerificationError("Upload verification timed out", "ETIMEDOUT");
      }
      throw error;
    } finally {
      reader.releaseLock();
    }

    if (totalBytes !== params.expectedSize) {
      throw new StorageVerificationError("Uploaded object size does not match the declared size", "CONTENT_MISMATCH");
    }
    if (totalBytes > 0) {
      const signature = new Blob([Uint8Array.from(prefix)], { type: params.expectedMimeType });
      try {
        await validateUploadedBlobMagicBytes(signature, params.expectedMimeType);
      } catch (error) {
        throw new StorageVerificationError(
          error instanceof Error ? error.message : "Uploaded content is invalid",
          "CONTENT_MISMATCH",
        );
      }
    }

    let dimensions: MediaDimensions | null = null;
    if (params.decodeImage) {
      try {
        const { default: sharp } = await import("sharp");
        const metadata = await sharp(Buffer.concat(imageChunks), {
          animated: true,
          failOn: "error",
          limitInputPixels: 16_000_000,
        }).metadata();
        const width = metadata.width ?? 0;
        const height = metadata.pageHeight ?? metadata.height ?? 0;
        const rotated = (metadata.orientation ?? 0) >= 5;
        dimensions = normalizeMediaDimensions(rotated ? height : width, rotated ? width : height);
        const pages = metadata.pages ?? 1;
        if (width < 1 || height < 1 || width * height * pages > 16_000_000) {
          throw new Error("Image exceeds the 16 megapixel decode limit");
        }
      } catch (error) {
        throw new StorageVerificationError(
          error instanceof Error ? error.message : "Uploaded image cannot be decoded safely",
          "CONTENT_MISMATCH",
        );
      }
    }

    return { contentHash: hash.digest("hex"), verifiedSize: totalBytes, dimensions };
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
    clearTimeout(absoluteTimer);
  }
}

async function acquireVerificationLease(assetId: string) {
  const now = new Date();
  const token = randomUUID();
  const [asset] = await db
    .update(storageAssets)
    .set({
      verificationLeaseToken: token,
      verificationLeaseExpiresAt: new Date(now.getTime() + VERIFICATION_LEASE_MS),
      verificationFence: sql`${storageAssets.verificationFence} + 1`,
      updatedAt: now,
    })
    .where(and(
      eq(storageAssets.id, assetId),
      eq(storageAssets.state, "pending"),
      or(
        isNull(storageAssets.verificationLeaseExpiresAt),
        lt(storageAssets.verificationLeaseExpiresAt, now),
      ),
    ))
    .returning({ fence: storageAssets.verificationFence });
  return asset ? { token, fence: asset.fence } : null;
}

export async function createUploadIntent(rawParams: CreateUploadIntentParams) {
  const expectedMimeType = normalizeAndValidateMimeType(rawParams.expectedMimeType);
  const expectedSize = normalizeAndValidateFileSize(rawParams.expectedSize, Number.MAX_SAFE_INTEGER, "Upload");
  const projectId = rawParams.projectId ?? null;
  const expiresAt = resolveUploadIntentExpiry();
  const purpose = uploadPurpose(rawParams.scope, rawParams.kind);
  const metadata = rawParams.metadata ?? {};
  const idempotencyKey = rawParams.idempotencyKey?.trim() || null;
  const fingerprint = requestFingerprint({
    ...rawParams,
    projectId,
    expectedMimeType,
    expectedSize,
    metadata,
  });
  const request = {
    userId: rawParams.userId,
    projectId,
    bucket: rawParams.bucket,
    storageKey: rawParams.storageKey,
    scope: rawParams.scope,
    kind: rawParams.kind,
    expectedMimeType,
    expectedSize,
    metadata,
  };

  return db.transaction(async (tx) => {
    let [existingIntent] = await tx
      .select()
      .from(uploadIntents)
      .where(and(
        eq(uploadIntents.bucket, rawParams.bucket),
        eq(uploadIntents.storageKey, rawParams.storageKey),
      ))
      .limit(1);
    if (existingIntent) {
      assertIntentMatchesRequest(existingIntent, request);
      if (existingIntent.assetId) return existingIntent;
    }

    const quotaRows: Array<{
      scopeType: "user" | "project";
      scopeId: string;
      limitBytes: number;
    }> = [{
      scopeType: "user",
      scopeId: rawParams.userId,
      limitBytes: USER_STORAGE_LIMIT_BYTES,
    }];
    if (projectId) {
      quotaRows.push({
        scopeType: "project" as const,
        scopeId: projectId,
        limitBytes: WORKSPACE_STORAGE_LIMIT_BYTES,
      });
    }
    await tx.insert(storageQuotaScopes).values(quotaRows).onConflictDoNothing();

    const [userQuota] = await tx
      .select()
      .from(storageQuotaScopes)
      .where(and(
        eq(storageQuotaScopes.scopeType, "user"),
        eq(storageQuotaScopes.scopeId, rawParams.userId),
      ))
      .limit(1)
      .for("update");
    if (!userQuota) throw new Error("Couldn’t lock user upload quota");

    const [projectQuota] = projectId
      ? await tx
          .select()
          .from(storageQuotaScopes)
          .where(and(
            eq(storageQuotaScopes.scopeType, "project"),
            eq(storageQuotaScopes.scopeId, projectId),
          ))
          .limit(1)
          .for("update")
      : [null];
    if (projectId && !projectQuota) throw new Error("Couldn’t lock workspace upload quota");

    // A same-key request can finish while this transaction waits on the user
    // quota row. Re-read after locking so retries never reserve twice.
    [existingIntent] = await tx
      .select()
      .from(uploadIntents)
      .where(and(
        eq(uploadIntents.bucket, rawParams.bucket),
        eq(uploadIntents.storageKey, rawParams.storageKey),
      ))
      .limit(1);
    if (existingIntent) {
      assertIntentMatchesRequest(existingIntent, request);
      if (existingIntent.assetId) return existingIntent;
    }

    const byteQuota = projectQuota ?? userQuota;
    // Organizations hold 5 GB (report §23, ORG_LIMITS.orgStorageBytes); copies of org files are counted once.
    const [scopeProject] = projectQuota
      ? await tx.select({ kind: projects.kind }).from(projects).where(eq(projects.id, projectQuota.scopeId)).limit(1)
      : [];
    assertStorageQuotaAdmission({
      limitBytes: scopeProject?.kind === "organization" ? Math.min(byteQuota.limitBytes, ORG_LIMITS.orgStorageBytes) : byteQuota.limitBytes,
      retainedBytes: byteQuota.retainedBytes,
      reservedBytes: byteQuota.reservedBytes,
      outstandingUploads: userQuota.outstandingUploads,
      incomingBytes: expectedSize,
    });

    if (projectQuota) {
      await tx.update(storageQuotaScopes)
        .set({
          outstandingUploads: sql`${storageQuotaScopes.outstandingUploads} + 1`,
          updatedAt: new Date(),
        })
        .where(and(
          eq(storageQuotaScopes.scopeType, "user"),
          eq(storageQuotaScopes.scopeId, rawParams.userId),
        ));
      await tx.update(storageQuotaScopes)
        .set({
          reservedBytes: sql`${storageQuotaScopes.reservedBytes} + ${expectedSize}`,
          updatedAt: new Date(),
        })
        .where(and(
          eq(storageQuotaScopes.scopeType, "project"),
          eq(storageQuotaScopes.scopeId, projectId!),
        ));
    } else {
      await tx.update(storageQuotaScopes)
        .set({
          reservedBytes: sql`${storageQuotaScopes.reservedBytes} + ${expectedSize}`,
          outstandingUploads: sql`${storageQuotaScopes.outstandingUploads} + 1`,
          updatedAt: new Date(),
        })
        .where(and(
          eq(storageQuotaScopes.scopeType, "user"),
          eq(storageQuotaScopes.scopeId, rawParams.userId),
        ));
    }

    const [insertedAsset] = await tx
      .insert(storageAssets)
      .values({
        ownerUserId: rawParams.userId,
        projectId,
        bucket: rawParams.bucket,
        storageKey: rawParams.storageKey,
        purpose,
        state: "pending",
        declaredMimeType: expectedMimeType,
        declaredSize: expectedSize,
        idempotencyKey,
        requestFingerprint: fingerprint,
        metadata,
        expiresAt,
      })
      .onConflictDoNothing()
      .returning();

    const [asset] = insertedAsset
      ? [insertedAsset]
      : await tx
          .select()
          .from(storageAssets)
          .where(or(
            and(
              eq(storageAssets.bucket, rawParams.bucket),
              eq(storageAssets.storageKey, rawParams.storageKey),
            ),
            idempotencyKey
              ? and(
                  eq(storageAssets.ownerUserId, rawParams.userId),
                  eq(storageAssets.purpose, purpose),
                  eq(storageAssets.idempotencyKey, idempotencyKey),
                )
              : undefined,
          ))
          .limit(1);

    if (!asset) throw new Error("Couldn’t reserve upload asset");
    if (
      asset.ownerUserId !== rawParams.userId
      || asset.projectId !== projectId
      || asset.bucket !== rawParams.bucket
      || asset.storageKey !== rawParams.storageKey
      || asset.purpose !== purpose
      || asset.declaredMimeType !== expectedMimeType
      || asset.declaredSize !== expectedSize
      || (asset.requestFingerprint && asset.requestFingerprint !== fingerprint)
      || asset.state !== "pending"
    ) {
      throw new Error("Upload idempotency identity is already bound to a different request");
    }

    if (existingIntent) {
      const [updated] = await tx
        .update(uploadIntents)
        .set({ assetId: asset.id, updatedAt: new Date() })
        .where(and(eq(uploadIntents.id, existingIntent.id), isNull(uploadIntents.assetId)))
        .returning();
      return updated ?? existingIntent;
    }

    const [intent] = await tx
      .insert(uploadIntents)
      .values({
        userId: rawParams.userId,
        projectId,
        assetId: asset.id,
        bucket: rawParams.bucket,
        storageKey: rawParams.storageKey,
        scope: rawParams.scope,
        kind: rawParams.kind,
        expectedMimeType,
        expectedSize,
        metadata,
        status: "pending",
        expiresAt,
      })
      .onConflictDoNothing()
      .returning();
    if (!intent) throw new Error("Upload key is already reserved");

    await tx
      .insert(storageAssetOperations)
      .values({
        assetId: asset.id,
        ownerUserId: rawParams.userId,
        operation: "upload",
        state: "pending",
        idempotencyKey: `upload:${asset.id}`,
        requestFingerprint: fingerprint,
      })
      .onConflictDoNothing();
    return intent;
  });
}

export async function createUploadIntents(paramsList: CreateUploadIntentParams[]) {
  if (paramsList.length === 0) return [];
  if (paramsList.length > MAX_INTENTS_PER_BATCH) {
    throw new Error(`Too many uploads in one batch. Max ${MAX_INTENTS_PER_BATCH}.`);
  }

  const results: UploadIntent[] = [];
  for (let index = 0; index < paramsList.length; index += INTENT_CONCURRENCY) {
    const chunk = paramsList.slice(index, index + INTENT_CONCURRENCY);
    results.push(...await Promise.all(chunk.map(createUploadIntent)));
  }
  return results;
}

export async function getUploadIntentById(params: { intentId: string; userId: string }) {
  return db.query.uploadIntents.findFirst({
    where: and(eq(uploadIntents.id, params.intentId), eq(uploadIntents.userId, params.userId)),
  });
}

export async function readUploadOperationStatus(params: { intentId: string; userId: string }) {
  const [row] = await db.select({
    intentId: uploadIntents.id,
    status: uploadIntents.status,
    failureReason: uploadIntents.failureReason,
    assetId: uploadIntents.assetId,
    assetState: storageAssets.state,
    expectedSize: uploadIntents.expectedSize,
    finalizedSize: uploadIntents.finalizedSize,
    expiresAt: uploadIntents.expiresAt,
    finalizedAt: uploadIntents.finalizedAt,
  }).from(uploadIntents)
    .leftJoin(storageAssets, eq(storageAssets.id, uploadIntents.assetId))
    .where(and(
      eq(uploadIntents.id, params.intentId),
      eq(uploadIntents.userId, params.userId),
    ))
    .limit(1);
  if (!row) return null;
  let published = false;
  if (row.status === "finalized" && row.assetId) {
    const [publication] = await db.select({
      published: sql<boolean>`
        exists(select 1 from project_nodes where asset_id = ${row.assetId})
        or exists(select 1 from file_versions where asset_id = ${row.assetId})
        or exists(select 1 from profiles where avatar_asset_id = ${row.assetId} or banner_asset_id = ${row.assetId})
        or exists(select 1 from projects where cover_image_asset_id = ${row.assetId})
        or exists(select 1 from message_attachments where asset_id = ${row.assetId})
        or exists(select 1 from project_update_media_assets where asset_id = ${row.assetId})
        or exists(select 1 from project_update_draft_media_assets where asset_id = ${row.assetId})
        or exists(select 1 from extension_recovery_drafts where asset_id = ${row.assetId})
        or exists(select 1 from github_sync_snapshot_assets where asset_id = ${row.assetId})
      `,
    }).from(storageAssets).where(eq(storageAssets.id, row.assetId)).limit(1);
    published = publication?.published === true;
  }
  return {
    ...row,
    phase: row.status === "finalized" && published
      ? "published"
      : row.status === "finalized"
        ? "verified"
      : row.status === "pending" && row.assetState === "pending"
        ? "verification_pending"
        : row.status === "pending"
          ? "transfer_pending"
          : row.failureReason === "Upload canceled by user"
            ? "cancelled"
          : "failed",
  } as const;
}

export async function cancelUploadOperation(params: { intentId: string; userId: string }) {
  return db.transaction(async (tx) => {
    const [intent] = await tx.select({
      id: uploadIntents.id,
      assetId: uploadIntents.assetId,
      status: uploadIntents.status,
      failureReason: uploadIntents.failureReason,
    }).from(uploadIntents).where(and(
      eq(uploadIntents.id, params.intentId),
      eq(uploadIntents.userId, params.userId),
    )).limit(1).for("update");
    if (!intent) return null;
    if (intent.status === "finalized") {
      return { cancelled: false as const, reason: "already_finalized" as const };
    }
    if (intent.status === "failed" && intent.failureReason === "Upload canceled by user") {
      return { cancelled: true as const, reason: "already_cancelled" as const };
    }
    if (intent.status !== "pending") {
      return { cancelled: false as const, reason: "terminal" as const };
    }

    await tx.update(uploadIntents).set({
      status: "failed",
      failureReason: "Upload canceled by user",
      updatedAt: new Date(),
    }).where(and(
      eq(uploadIntents.id, intent.id),
      eq(uploadIntents.status, "pending"),
    ));
    if (intent.assetId) {
      await tx.update(storageAssetOperations).set({
        state: "cancelled",
        errorCode: "USER_CANCELLED",
        completedAt: new Date(),
        updatedAt: new Date(),
      }).where(and(
        eq(storageAssetOperations.assetId, intent.assetId),
        eq(storageAssetOperations.operation, "upload"),
        inArray(storageAssetOperations.state, ["pending", "running"]),
      ));
    }
    // Bytes remain protected until the credential expires. The existing
    // abandoned-asset worker then detaches quota and removes the object.
    return { cancelled: true as const, reason: "cancelled" as const };
  });
}

export async function getUploadIntentByStorageKey(params: {
  bucket: string;
  storageKey: string;
  userId: string;
  projectId?: string | null;
}) {
  const projectFilter = params.projectId === undefined
    ? undefined
    : params.projectId === null
      ? isNull(uploadIntents.projectId)
      : eq(uploadIntents.projectId, params.projectId);
  return db.query.uploadIntents.findFirst({
    where: and(
      eq(uploadIntents.bucket, params.bucket),
      eq(uploadIntents.storageKey, params.storageKey),
      eq(uploadIntents.userId, params.userId),
      projectFilter,
    ),
  });
}

export async function finalizeUploadIntent(params: {
  intentId?: string;
  bucket: string;
  storageKey?: string;
  userId: string;
  projectId?: string | null;
  expectedScope?: UploadIntentScope;
  expectedKind?: UploadIntentKind;
}, preloadedIntent?: UploadIntent | null) {
  const intent = preloadedIntent !== undefined
    ? preloadedIntent
    : params.intentId
      ? await getUploadIntentById({ intentId: params.intentId, userId: params.userId })
      : params.storageKey
        ? await getUploadIntentByStorageKey({
            bucket: params.bucket,
            storageKey: params.storageKey,
            userId: params.userId,
            projectId: params.projectId,
          })
        : null;
  if (!intent) throw new Error("Upload intent not found");

  assertUploadIntentBinding(intent, {
    bucket: params.bucket,
    storageKey: params.storageKey ?? intent.storageKey,
  });
  if (params.expectedScope && intent.scope !== params.expectedScope) {
    throw new Error("Upload intent scope mismatch");
  }
  if (params.expectedKind && intent.kind !== params.expectedKind) {
    throw new Error("Upload intent kind mismatch");
  }
  if (params.projectId !== undefined && intent.projectId !== (params.projectId ?? null)) {
    throw new Error("Upload intent workspace mismatch");
  }
  if (intent.status === "finalized") return intent;
  assertPendingIntent(intent);

  const lease = intent.assetId ? await acquireVerificationLease(intent.assetId) : null;
  if (intent.assetId && !lease) {
    const [currentAsset] = await db
      .select({ state: storageAssets.state })
      .from(storageAssets)
      .where(eq(storageAssets.id, intent.assetId))
      .limit(1);
    if (currentAsset?.state === "verified") {
      const currentIntent = await getUploadIntentById({ intentId: intent.id, userId: intent.userId });
      if (currentIntent?.status === "finalized") return currentIntent;
    }
    throw new StorageVerificationError("Upload verification is already in progress", "VERIFICATION_IN_PROGRESS");
  }

  try {
    const admin = await createAdminClient();
    const bucket = admin.storage.from(intent.bucket);
    const { data: objectInfo, error: infoError } = await bucket.info(intent.storageKey);
    if (infoError || !objectInfo) {
      const status = infoError && "statusCode" in infoError ? Number(infoError.statusCode) : undefined;
      throw new StorageVerificationError(
        infoError?.message || "Uploaded object is missing",
        status && (status >= 500 || status === 429) ? "PROVIDER_UNAVAILABLE" : "CONTENT_MISMATCH",
        status,
      );
    }

    const objectSize = normalizeAndValidateFileSize(objectInfo.size, Number.MAX_SAFE_INTEGER, "Upload");
    if (objectSize !== intent.expectedSize) {
      throw new StorageVerificationError("Uploaded object size does not match the declared size", "CONTENT_MISMATCH");
    }

    let verifiedSize = 0;
    let verifiedDimensions: MediaDimensions | null = null;
    let contentHash = createHash("sha256").digest("hex");
    if (objectSize > 0) {
      const { data: signedData, error: signedError } = await bucket.createSignedUrl(intent.storageKey, 60);
      if (signedError || !signedData?.signedUrl) {
        throw new StorageVerificationError(
          signedError?.message || "Couldn’t obtain verification read capability",
          "PROVIDER_UNAVAILABLE",
        );
      }
      // ponytail: the whole object is streamed once to hash it (constant memory, S3-01).
      // ceiling: one storage egress per upload. upgrade: a ranged read of the magic
      // bytes plus provider checksums if storage egress shows up on the bill.
      ({ verifiedSize, contentHash, dimensions: verifiedDimensions } = await verifyStoredObjectBytes({
        signedUrl: signedData.signedUrl,
        expectedSize: intent.expectedSize,
        expectedMimeType: intent.expectedMimeType,
        decodeImage: (intent.scope === "chat_attachment" && intent.expectedMimeType.startsWith("image/"))
          || intent.scope === "profile_image"
          || intent.scope === "project_cover"
          || intent.scope === "project_update_media"
          || intent.scope === "contribution_image",
      }));
    }

    const finalizedAt = new Date();
    return await db.transaction(async (tx) => {
      const quotaRows: Array<{
        scopeType: "user" | "project";
        scopeId: string;
        limitBytes: number;
      }> = [{
        scopeType: "user",
        scopeId: intent.userId,
        limitBytes: USER_STORAGE_LIMIT_BYTES,
      }];
      if (intent.projectId) {
        quotaRows.push({
          scopeType: "project",
          scopeId: intent.projectId,
          limitBytes: WORKSPACE_STORAGE_LIMIT_BYTES,
        });
      }
      await tx.insert(storageQuotaScopes).values(quotaRows).onConflictDoNothing();
      await tx.select({ scopeId: storageQuotaScopes.scopeId })
        .from(storageQuotaScopes)
        .where(and(
          eq(storageQuotaScopes.scopeType, "user"),
          eq(storageQuotaScopes.scopeId, intent.userId),
        ))
        .limit(1)
        .for("update");
      if (intent.projectId) {
        await tx.select({ scopeId: storageQuotaScopes.scopeId })
          .from(storageQuotaScopes)
          .where(and(
            eq(storageQuotaScopes.scopeType, "project"),
            eq(storageQuotaScopes.scopeId, intent.projectId),
          ))
          .limit(1)
          .for("update");
      }

      if (intent.assetId && lease) {
        const [verifiedAsset] = await tx
          .update(storageAssets)
          .set({
            state: "verified",
            verifiedMimeType: intent.expectedMimeType,
            verifiedSize,
            ...(verifiedDimensions && intent.scope === "chat_attachment" ? { metadata: { ...intent.metadata, ...verifiedDimensions } } : {}),
            contentHash,
            verifiedAt: finalizedAt,
            verificationLeaseToken: null,
            verificationLeaseExpiresAt: null,
            lastErrorCode: null,
            updatedAt: finalizedAt,
          })
          .where(and(
            eq(storageAssets.id, intent.assetId),
            eq(storageAssets.state, "pending"),
            eq(storageAssets.verificationLeaseToken, lease.token),
            eq(storageAssets.verificationFence, lease.fence),
          ))
          .returning({ id: storageAssets.id });
        if (!verifiedAsset) {
          throw new StorageVerificationError("Upload verification lease is stale", "VERIFICATION_IN_PROGRESS");
        }

        if (intent.projectId) {
          await tx.update(storageQuotaScopes)
            .set({
              outstandingUploads: sql`greatest(${storageQuotaScopes.outstandingUploads} - 1, 0)`,
              updatedAt: finalizedAt,
            })
            .where(and(
              eq(storageQuotaScopes.scopeType, "user"),
              eq(storageQuotaScopes.scopeId, intent.userId),
            ));
          await tx.update(storageQuotaScopes)
            .set({
              reservedBytes: sql`greatest(${storageQuotaScopes.reservedBytes} - ${intent.expectedSize}, 0)`,
              retainedBytes: sql`${storageQuotaScopes.retainedBytes} + ${verifiedSize}`,
              updatedAt: finalizedAt,
            })
            .where(and(
              eq(storageQuotaScopes.scopeType, "project"),
              eq(storageQuotaScopes.scopeId, intent.projectId),
            ));
        } else {
          await tx.update(storageQuotaScopes)
            .set({
              reservedBytes: sql`greatest(${storageQuotaScopes.reservedBytes} - ${intent.expectedSize}, 0)`,
              retainedBytes: sql`${storageQuotaScopes.retainedBytes} + ${verifiedSize}`,
              outstandingUploads: sql`greatest(${storageQuotaScopes.outstandingUploads} - 1, 0)`,
              updatedAt: finalizedAt,
            })
            .where(and(
              eq(storageQuotaScopes.scopeType, "user"),
              eq(storageQuotaScopes.scopeId, intent.userId),
            ));
        }
      }

      const [finalizedIntent] = await tx
        .update(uploadIntents)
        .set({
          status: "finalized",
          finalizedMimeType: intent.expectedMimeType,
          finalizedSize: verifiedSize,
          finalizedAt,
          failureReason: null,
          updatedAt: finalizedAt,
        })
        .where(and(
          eq(uploadIntents.id, intent.id),
          eq(uploadIntents.status, "pending"),
          sql`${uploadIntents.expiresAt} > now()`,
        ))
        .returning();
      if (!finalizedIntent) throw new Error("Couldn’t finalize upload intent");

      if (intent.assetId) {
        await tx
          .update(storageAssetOperations)
          .set({
            state: "succeeded",
            result: { contentHash, verifiedSize },
            completedAt: finalizedAt,
            updatedAt: finalizedAt,
          })
          .where(and(
            eq(storageAssetOperations.assetId, intent.assetId),
            eq(storageAssetOperations.operation, "upload"),
            eq(storageAssetOperations.state, "pending"),
          ));
      }
      return finalizedIntent;
    });
  } catch (error) {
    await markIntentVerificationFailure(intent, error, lease ?? undefined);
    throw error;
  }
}

export async function finalizeUploadIntents(paramsList: Array<{
  bucket: string;
  storageKey: string;
  userId: string;
  projectId?: string | null;
  expectedScope?: UploadIntentScope;
  expectedKind?: UploadIntentKind;
}>) {
  if (paramsList.length === 0) return [];
  if (paramsList.length > MAX_INTENTS_PER_BATCH) {
    throw new Error(`Too many uploads in one batch. Max ${MAX_INTENTS_PER_BATCH}.`);
  }

  const buckets = Array.from(new Set(paramsList.map((item) => item.bucket)));
  const storageKeys = Array.from(new Set(paramsList.map((item) => item.storageKey)));
  const userIds = Array.from(new Set(paramsList.map((item) => item.userId)));
  const existingIntents = await db.query.uploadIntents.findMany({
    where: and(
      buckets.length === 1 ? eq(uploadIntents.bucket, buckets[0]!) : inArray(uploadIntents.bucket, buckets),
      inArray(uploadIntents.storageKey, storageKeys),
      userIds.length === 1 ? eq(uploadIntents.userId, userIds[0]!) : inArray(uploadIntents.userId, userIds),
    ),
  });
  const intentByBinding = new Map(existingIntents.map((item) => [
    `${item.userId}:${item.bucket}:${item.storageKey}`,
    item,
  ]));

  const results: UploadIntent[] = [];
  for (let index = 0; index < paramsList.length; index += INTENT_CONCURRENCY) {
    const chunk = paramsList.slice(index, index + INTENT_CONCURRENCY);
    results.push(...await Promise.all(chunk.map((params) => finalizeUploadIntent(
      params,
      intentByBinding.get(`${params.userId}:${params.bucket}:${params.storageKey}`) ?? null,
    ))));
  }
  return results;
}

export async function cleanupExpiredUploadIntents() {
  const now = new Date();
  const credentialGraceCutoff = new Date(now.getTime() - INVALID_UPLOAD_DELETE_MARGIN_MS);
  const expired = await db.transaction(async (tx) => {
    const candidates = await tx
      .select({
        id: uploadIntents.id,
        assetId: uploadIntents.assetId,
        bucket: uploadIntents.bucket,
        storageKey: uploadIntents.storageKey,
      })
      .from(uploadIntents)
      .leftJoin(storageAssets, eq(storageAssets.id, uploadIntents.assetId))
      .where(and(
        or(
          and(eq(uploadIntents.status, "pending"), lt(uploadIntents.expiresAt, credentialGraceCutoff)),
          and(eq(uploadIntents.status, "expired"), isNull(uploadIntents.assetId)),
        ),
        or(
          isNull(uploadIntents.assetId),
          isNull(storageAssets.state),
          sql`${storageAssets.state} <> 'deleted'`,
        ),
      ))
      .orderBy(asc(uploadIntents.expiresAt), asc(uploadIntents.id))
      .limit(100)
      .for("update", { of: uploadIntents, skipLocked: true });
    if (candidates.length === 0) return [];

    const ids = candidates.map((intent) => intent.id);
    const assetIds = candidates.flatMap((intent) => intent.assetId ? [intent.assetId] : []);
    await tx
      .update(uploadIntents)
      .set({ status: "expired", updatedAt: now, failureReason: "Upload intent expired before publication" })
      .where(inArray(uploadIntents.id, ids));
    if (assetIds.length > 0) {
      await tx
        .update(storageAssets)
        .set({
          state: "delete_pending",
          deleteAfter: now,
          lastErrorCode: "UPLOAD_INTENT_EXPIRED",
          updatedAt: now,
        })
        .where(and(
          inArray(storageAssets.id, assetIds),
          eq(storageAssets.state, "pending"),
        ));
    }
    return candidates;
  });

  if (expired.length === 0) {
    return { removedObjects: 0, expiredIntents: 0, retryableIntents: 0 };
  }

  const legacyExpired = expired.filter((intent) => !intent.assetId);
  const admin = legacyExpired.length > 0 ? await createAdminClient() : null;
  const byBucket = new Map<string, typeof expired>();
  for (const intent of legacyExpired) {
    const items = byBucket.get(intent.bucket) ?? [];
    items.push(intent);
    byBucket.set(intent.bucket, items);
  }

  const removed: typeof expired = [];
  const retry: typeof expired = [];
  for (const [bucket, intents] of byBucket) {
    const { error } = await admin!.storage.from(bucket).remove(intents.map((intent) => intent.storageKey));
    (error ? retry : removed).push(...intents);
  }

  await db.transaction(async (tx) => {
    const expiredIds = expired.map((item) => item.id);
    if (expiredIds.length > 0) {
      await tx
        .update(importJobFiles)
        .set({ status: "failed", errorMessage: "Upload intent expired and cleaned up" })
        .where(inArray(importJobFiles.uploadIntentId, expiredIds));
      const legacyIntentIds = removed.map((item) => item.id);
      if (legacyIntentIds.length > 0) {
        await tx.delete(uploadIntents).where(inArray(uploadIntents.id, legacyIntentIds));
      }
    }
  });

  return {
    removedObjects: removed.length,
    expiredIntents: expired.length,
    retryableIntents: retry.length,
  };
}

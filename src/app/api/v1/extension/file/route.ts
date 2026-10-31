import crypto from "crypto";
import mime from "mime-types";

import { enforceFileReadLimit, requireAuthenticatedUser, jsonSuccess, jsonError } from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { workspaceNodes, fileVersions, storageAssets } from "@/lib/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { getWorkspaceFileContent } from "@/app/actions/files/content";
import { applyFileRevision } from "@/lib/files/apply-file-revision";
import { isFileRevisionMode, normalizeRevisionComment, parseFileRevisionMode } from "@/lib/files/revision-policy";
import { createAdminClient } from "@/lib/supabase/server";
import { createUploadIntent, finalizeUploadIntent } from "@/lib/upload/upload-intents";
import { parseWorkspaceFileKey } from "@/lib/storage/workspace-file-key";
import { logger } from "@/lib/logger";
import { streamPrivateObject } from "@/lib/storage/private-object-response";
import { readBoundedStorageBytes } from "@/lib/storage/bounded-object-read";
import { withIdempotentRoute } from "@/lib/security/idempotency";
import { recordExtensionMetric } from "@/lib/extension/observability";
import { assertWorkspaceFileReadAccess, assertFileNodeVisible } from "@/lib/files/internal-helpers";
import { validateCsrf } from "@/lib/security/csrf";
import {
  assertNoExtensionWriteConflict,
  buildExtensionRevisionStorageKey,
  extensionRevisionConflictResponse,
  extensionRevisionData,
  readCommittedExtensionReceipt,
  parseExtensionLeaseHeaders,
  resolveWritableExtensionFile,
} from "@/app/api/v1/extension/_file-revision";

const EXTENSION_INLINE_DOWNLOAD_MAX_BYTES = 512 * 1024;
const EXTENSION_INLINE_UPLOAD_MAX_BYTES = 512 * 1024;

function shouldUseSignedDownload(mimeType: string | null, size: number | null) {
  const normalizedMime = mimeType?.trim().toLowerCase() || "";
  const isText = normalizedMime.startsWith("text/")
    || normalizedMime === "application/json"
    || normalizedMime === "application/javascript"
    || normalizedMime === "application/typescript"
    || normalizedMime === "application/xml";
  return !isText || (size ?? 0) > EXTENSION_INLINE_DOWNLOAD_MAX_BYTES;
}

export async function GET(request: Request) {
  try {
    const authResult = await requireAuthenticatedUser();
    if (authResult.response) {
      return authResult.response;
    }
    const user = authResult.user;
    if (!user) {
      return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    }

    const limited = await enforceFileReadLimit(request, "extension:file", 1200, 60, user.id);
    if (limited) return limited;

    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId")?.trim();
    const path = searchParams.get("path")?.trim();
    const transfer = searchParams.get("transfer")?.trim();

    if (!projectId || !path) {
      return jsonError("Missing projectId or path", 400, "BAD_REQUEST");
    }

    const access = await assertWorkspaceFileReadAccess(projectId, user.id);

    // Find the node
    const node = await db.query.workspaceNodes.findFirst({
      where: and(
        eq(workspaceNodes.projectId, projectId),
        eq(workspaceNodes.path, path),
        eq(workspaceNodes.type, "file"),
        isNull(workspaceNodes.deletedAt)
      ),
      columns: {
        id: true,
        name: true,
        path: true,
        type: true,taskId:true,deletedAt:true,
        s3Key: true,
        assetId: true,
        size: true,
        mimeType: true,
        currentVersion: true,
        updatedAt: true,
      },
    });

    if (!node) {
      return jsonError("File not found", 404, "NOT_FOUND");
    }
    await assertFileNodeVisible(access, node);

    // Bytes are served only for an asset that passed verification, with its verified size and type.
    const [verifiedAsset] = node.s3Key && node.assetId
      ? await db.select({ size: storageAssets.verifiedSize, mimeType: storageAssets.verifiedMimeType })
        .from(storageAssets)
        .where(and(
          eq(storageAssets.id, node.assetId),
          eq(storageAssets.bucket, "project-files"),
          eq(storageAssets.storageKey, node.s3Key),
          eq(storageAssets.state, "verified"),
        ))
        .limit(1)
      : [];
    if (transfer !== "metadata" && node.s3Key && !verifiedAsset) {
      return jsonError("File content unavailable", 404, "NOT_FOUND");
    }

    const [version] = await Promise.all([
      db.query.fileVersions.findFirst({
        where: and(
          eq(fileVersions.nodeId, node.id),
          eq(fileVersions.version, node.currentVersion)
        ),
        columns: { contentHash: true },
      }),
    ]);

    if(transfer==="metadata")return jsonSuccess({nodeId:node.id,id:node.id,path:node.path,name:node.name,type:node.type,size:node.size,mimeType:node.mimeType,currentVersion:node.currentVersion,contentHash:version?.contentHash||null,updatedAt:node.updatedAt});

    const useSignedTransfer = transfer === "signed"
      || (transfer !== "inline" && shouldUseSignedDownload(node.mimeType, node.size ?? 0));
    if (transfer === "inline" && (node.size ?? 0) > EXTENSION_INLINE_DOWNLOAD_MAX_BYTES) {
      return jsonError("Extension inline responses are limited to 512 KiB", 400, "NOT_SUPPORTED");
    }
    if (transfer === "raw" && node.s3Key && verifiedAsset) {
      const parsedKey = parseWorkspaceFileKey(node.s3Key);
      if (!parsedKey || parsedKey.projectId !== projectId) {
        return jsonError("File key does not belong to this workspace", 409, "CONFLICT");
      }
      const adminClient = await createAdminClient();
      const { data, error } = await adminClient.storage.from("project-files").createSignedUrl(node.s3Key, 60);
      if (error || !data?.signedUrl) return jsonError("File content unavailable", 404, "NOT_FOUND");
      const etag = `"${version?.contentHash || crypto.createHash("sha256").update(node.s3Key).digest("hex")}"`;
      return streamPrivateObject({
        request,
        signedUrl: data.signedUrl,
        totalSize: verifiedAsset.size,
        mimeType: verifiedAsset.mimeType,
        filename: node.name,
        disposition: "attachment",
        etag,
      });
    }
    if (useSignedTransfer && node.s3Key) {
      const parsedKey = parseWorkspaceFileKey(node.s3Key);
      if (!parsedKey || parsedKey.projectId !== projectId) {
        return jsonError("File key does not belong to this workspace", 409, "CONFLICT");
      }
      const expiresInSeconds = 4 * 60;
      const authorizedUrl = new URL(request.url);
      authorizedUrl.searchParams.set("transfer", "raw");

      recordExtensionMetric("extension.file.download_intent", {
        action: "download_intent",
        success: true,
        userId: user.id,
        projectId,
        nodeId: node.id,
        path,
        sizeBytes: node.size ?? 0,
      });

      return jsonSuccess({
        // Compatibility field now carries an authenticated application route;
        // the upstream provider capability is never exposed to the extension.
        signedUrl: authorizedUrl.toString(),
        expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
        nodeId: node.id,
        size: node.size,
        name: node.name,
        mimeType: node.mimeType,
        currentVersion: node.currentVersion,
        contentHash: version?.contentHash ?? null,
        updatedAt: node.updatedAt?.toISOString?.() ?? node.updatedAt,
      });
    }

    const totalSize = Math.max(0, Number(node.size ?? 0));
    const requestedRange = parseByteRange(request.headers.get("range"), totalSize);
    const etag = version?.contentHash ? `"${version.contentHash}"` : null;
    if (!requestedRange && etag && request.headers.get("if-none-match") === etag) {
      return new Response(null, {
        status: 304,
        headers: { etag, "cache-control": "private, no-cache" },
      });
    }

    let contentBuffer: Uint8Array;
    if (node.s3Key) {
      const parsedKey = parseWorkspaceFileKey(node.s3Key);
      if (!parsedKey || parsedKey.projectId !== projectId) {
        return jsonError("File key does not belong to this workspace", 409, "CONFLICT");
      }
      contentBuffer = await readBoundedStorageBytes({
        bucket: "project-files",
        storageKey: node.s3Key,
        maxBytes: EXTENSION_INLINE_DOWNLOAD_MAX_BYTES,
        timeoutMs: 30_000,
      });
    } else {
      const content = await getWorkspaceFileContent(projectId, node.id);
      contentBuffer = Buffer.from(content, "utf8");
    }

    const range = requestedRange;
    const sliced = range
      ? contentBuffer.subarray(range.start, range.end + 1)
      : contentBuffer;
    const body = JSON.stringify({
      success: true,
      data: {
        content: Buffer.from(sliced).toString("base64"),
        encoding: "base64",
        range: range ? { ...range, total: totalSize || contentBuffer.byteLength } : null,
        complete: !range,
        nodeId: node.id,
        size: node.size,
        name: node.name,
        mimeType: node.mimeType,
        currentVersion: node.currentVersion,
        contentHash: version?.contentHash ?? null,
        updatedAt: node.updatedAt?.toISOString?.() ?? node.updatedAt,
      }
    });

    return new Response(body, {
      status: range ? 206 : 200,
      headers: {
        "content-type": "application/json",
        "accept-ranges": "bytes",
        "x-nb-content-encoding": "base64",
        "cache-control": "private, no-cache",
        ...(etag ? { etag } : {}),
      },
    });
  } catch (error) {
    logger.error("[api/v1/extension/file] Failed to get file content", {
      error: error instanceof Error ? error.message : String(error)
    });
    return jsonError("Couldn’t get file content", 500, "INTERNAL_ERROR");
  }
}

export async function PUT(request: Request) {
  const csrfError = validateCsrf(request);
  if (csrfError) return csrfError;
  try {
    const authResult = await requireAuthenticatedUser();
    if (authResult.response) {
      return authResult.response;
    }
    const user = authResult.user;
    if (!user) {
      return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    }
    if (!authResult.extensionSessionId) {
      return jsonError("An active extension device session is required", 401, "UNAUTHORIZED");
    }

    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId")?.trim();
    const path = searchParams.get("path")?.trim();

    if (!projectId || !path) {
      return jsonError("Missing projectId or path", 400, "BAD_REQUEST");
    }

    return withIdempotentRoute(request, { namespace: "extension.file.put", scopeId: `${user.id}:${projectId}:${path}` }, async () => {
    const directStorageKey = request.headers.get("x-nb-storage-key")?.trim();
    if (directStorageKey) {
      return jsonError(
        "Caller-supplied storage keys are unsupported. Use the verified file-upload intent route.",
        400,
        "NOT_SUPPORTED",
      );
    }
    const savePayload = await readExtensionSavePayload(request);
    const revisionModeHeader = request.headers.get("x-nb-revision-mode")?.trim();
    if (revisionModeHeader && !isFileRevisionMode(revisionModeHeader)) {
      return jsonError("Invalid version mode", 400, "BAD_REQUEST");
    }
    const revisionMode = parseFileRevisionMode(revisionModeHeader);
    const revisionComment = normalizeRevisionComment(
      request.headers.get("x-nb-revision-comment"),
    );
    const parsedLease = parseExtensionLeaseHeaders(request);
    if (parsedLease.response) return parsedLease.response;

    const resolved = await resolveWritableExtensionFile(projectId, path, user.id);
    if (resolved.response) return resolved.response;
    const node = resolved.node!;

    const operationId = request.headers.get("idempotency-key")?.trim() || crypto.randomUUID();
    const contentHash = crypto.createHash("sha256").update(savePayload.buffer).digest("hex");
    const committed = await readCommittedExtensionReceipt(projectId,node.id,user.id,operationId,contentHash);
    if(committed)return jsonSuccess({success:true,...committed});
    const baseVersionHeader = request.headers.get("x-nb-base-version")?.trim();
    const baseHashHeader = request.headers.get("x-nb-base-hash")?.trim();
    const baseVersion = baseVersionHeader ? Number(baseVersionHeader) : null;
    const validBaseVersion = baseVersion !== null && Number.isFinite(baseVersion) ? baseVersion : null;
    const conflict = await assertNoExtensionWriteConflict({
      node,
      baseVersion: validBaseVersion,
      baseHash: baseHashHeader || null,
    });
    if (conflict) return conflict;

    // Prepare upload metadata. Lease ownership is checked in the same
    // transaction as the revision write below.
    const adminClient = await createAdminClient();
    const size = savePayload.buffer.byteLength;
    const mimeType = savePayload.mimeType || inferMimeType(path);
    const s3Key = buildExtensionRevisionStorageKey(
      projectId,
      node.id,
      path,
      contentHash,
      operationId,
    );
    const intent = await createUploadIntent({
      userId: user.id,
      projectId,
      bucket: "project-files",
      storageKey: s3Key,
      scope: "workspace_file",
      kind: "file",
      expectedMimeType: mimeType,
      expectedSize: size,
      idempotencyKey: `extension-inline:${operationId}`,
      metadata: {
        source: "extension_inline_file",
        nodeId: node.id,
        path,
        baseVersion: validBaseVersion ?? node.currentVersion,
        baseHash: baseHashHeader || null,
        contentHash,
        revisionMode,
        comment: revisionComment,
        operationId,
        leaseId: parsedLease.lease!.leaseId,
        clientSessionId: parsedLease.lease!.sessionId,
        fencingToken: parsedLease.lease!.fencingToken,
      },
    });
    if (intent.status === "finalized") {
      const existingVersion = await db.query.fileVersions.findFirst({
        where: and(
          eq(fileVersions.nodeId, node.id),
          eq(fileVersions.s3Key, intent.storageKey),
        ),
      });
      if (existingVersion) {
        const recoveredData = {
          success: true,
          nodeId: node.id,
          version: existingVersion.version,
          size: existingVersion.size,
          mimeType: existingVersion.mimeType,
          contentHash: existingVersion.contentHash,
          syncStatus: node.syncStatus,
          sequenceNumber: null,
          revisionMode,
          versionIncremented: revisionMode === "new_revision",
          updatedAt: node.updatedAt?.toISOString?.() ?? node.updatedAt,
        };
        return jsonSuccess(recoveredData);
      }
    }

    const { error: uploadError } = await adminClient.storage
      .from("project-files")
      .upload(intent.storageKey, savePayload.buffer, {
        contentType: mimeType,
        cacheControl: "31536000",
        upsert: false
      });

    if (uploadError) {
      // A lost response may leave the immutable object present. Verification
      // below is authoritative, so only stop when the object is truly absent.
      const { data: existingObject } = await adminClient.storage
        .from("project-files")
        .info(intent.storageKey);
      if (!existingObject) {
        logger.error("[api/v1/extension/file] Storage upload failed", { error: uploadError.message });
        return jsonError(`Storage upload failed: ${uploadError.message}`, 500, "INTERNAL_ERROR");
      }
    }

    const verifiedIntent = await finalizeUploadIntent({
      intentId: intent.id,
      bucket: intent.bucket,
      storageKey: intent.storageKey,
      userId: user.id,
      projectId,
      expectedScope: "workspace_file",
      expectedKind: "file",
    });
    if (!verifiedIntent.assetId) {
      return jsonError("Verified file asset is unavailable", 409, "CONFLICT");
    }
    const [verifiedAsset] = await db
      .select({ contentHash: storageAssets.contentHash })
      .from(storageAssets)
      .where(and(
        eq(storageAssets.id, verifiedIntent.assetId),
        eq(storageAssets.state, "verified"),
      ))
      .limit(1);
    if (!verifiedAsset || verifiedAsset.contentHash !== contentHash) {
      await db.update(storageAssets)
        .set({
          state: "delete_pending",
          lastErrorCode: "CONTENT_MISMATCH",
          updatedAt: new Date(),
        })
        .where(eq(storageAssets.id, verifiedIntent.assetId));
      return jsonError("File checksum mismatch", 400, "BAD_REQUEST");
    }

    let result;
    try {
      result = await applyFileRevision({
        projectId,
        nodeId: node.id,
        actorUserId: user.id,
        storageKey: intent.storageKey,
        assetId: verifiedIntent.assetId,
        size,
        mimeType,
        contentHash,
        mode: revisionMode,
        comment: revisionComment,
        baseVersion: validBaseVersion,
        baseHash: baseHashHeader || null,
        lease: parsedLease.lease!,
        eventType: "extension_file_saved",
        eventMetadata: {
          transfer: "inline",
          uploadIntentId: intent.id,
          operationId,
        },
        syncStatus: "merged",
      });
    } catch (error) {
      // The commit response can be uncertain. Keep the immutable object and
      // reconcile the idempotent operation instead of deleting bytes that may
      // already be referenced by a committed revision.
      const conflictResponse = extensionRevisionConflictResponse(error);
      if (conflictResponse) return conflictResponse;
      throw error;
    }

    const successData = { success: true, ...extensionRevisionData(result, contentHash) };

    recordExtensionMetric("extension.file.save", {
      action: "save",
      success: true,
      userId: user.id,
      projectId,
      nodeId: result.node.id,
      path,
      sizeBytes: size,
      revisionMode: result.mode,
      versionIncremented: result.versionIncremented,
    });

    return jsonSuccess(successData);
    });
  } catch (error) {
    logger.error("[api/v1/extension/file] Failed to save file content", {
      error: error instanceof Error ? error.message : String(error)
    });
    return jsonError(
      "Couldn’t save file version. Refresh the file and try again.",
      500,
      "INTERNAL_ERROR"
    );
  }
}

function parseByteRange(value: string | null, total: number): { start: number; end: number } | null {
  if (!value || total <= 0) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match) return null;
  let start = match[1] ? Number(match[1]) : 0;
  let end = match[2] ? Number(match[2]) : total - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  start = Math.max(0, Math.min(total - 1, start));
  end = Math.max(start, Math.min(total - 1, end));
  return { start, end };
}

async function readExtensionSavePayload(request: Request): Promise<{ buffer: Buffer; mimeType: string | null }> {
  const contentType = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() || "";
  const declaredEncoding = request.headers.get("x-nb-content-encoding")?.trim().toLowerCase() || "";
  const declaredMimeType = request.headers.get("x-nb-mime-type")?.trim() || null;

  const base64EncodedLimit = Math.ceil(EXTENSION_INLINE_UPLOAD_MAX_BYTES * 4 / 3) + 16;
  const requestBodyLimit = declaredEncoding === "base64"
    ? base64EncodedLimit
    : EXTENSION_INLINE_UPLOAD_MAX_BYTES;
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > requestBodyLimit) {
    throw new Error("Extension inline payload exceeds 512 KiB");
  }
  const encoded = await readRequestBodyWithLimit(request, requestBodyLimit);
  let buffer: Buffer;
  if (declaredEncoding === "base64") {
    buffer = Buffer.from(encoded.toString("ascii"), "base64");
  } else {
    buffer = encoded;
  }
  if (buffer.byteLength > EXTENSION_INLINE_UPLOAD_MAX_BYTES) {
    throw new Error("Extension inline payload exceeds 512 KiB");
  }
  return { buffer, mimeType: declaredMimeType || contentType || null };
}

async function readRequestBodyWithLimit(request: Request, maxBytes: number): Promise<Buffer> {
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader();
  const chunks: Buffer[] = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel("payload too large");
        throw new Error("Extension inline payload exceeds 512 KiB");
      }
      chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, received);
}

function inferMimeType(path: string) {
  return mime.lookup(path) || "application/octet-stream";
}

import { and, eq } from "drizzle-orm";

import {
  enforceRouteLimit,
  getRequestId,
  jsonError,
  jsonSuccess,
  logApiRoute,
  requireAuthenticatedUser,
} from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { attachmentUploads, conversationParticipants, uploadIntents } from "@/lib/db/schema";
import { validateCsrf } from "@/lib/security/csrf";
import { createAdminClient } from "@/lib/supabase/server";
import {
  normalizeAndValidateFileSize,
  normalizeAndValidateMimeType,
  ATTACHMENT_UPLOAD_MAX_FILE_BYTES,
} from "@/lib/upload/security";
import { createUploadIntent, finalizeUploadIntent } from "@/lib/upload/upload-intents";
import { isUuid } from "@/lib/validations/uuid";

const ATTACHMENTS_BUCKET = "chat-attachments";
const SESSION_TTL_MS = 60 * 60 * 1000;

function fileTypeForMime(mimeType: string) {
  return mimeType.startsWith("image/") ? "image" : mimeType.startsWith("video/") ? "video" : "file";
}

async function canAccessConversation(conversationId: string, userId: string) {
  const [membership] = await db
    .select({ id: conversationParticipants.id })
    .from(conversationParticipants)
    .where(and(
      eq(conversationParticipants.conversationId, conversationId),
      eq(conversationParticipants.userId, userId),
    ))
    .limit(1);
  return Boolean(membership);
}

function attachmentResult(record: {
  clientUploadId: string;
  storagePath: string | null;
  filename: string;
  sizeBytes: number | null;
  mimeType: string | null;
}, media: { width?: unknown; height?: unknown; tinyBase64?: unknown } = {}) {
  const mimeType = record.mimeType || "application/octet-stream";
  return {
    id: record.clientUploadId,
    storagePath: record.storagePath,
    type: fileTypeForMime(mimeType),
    url: `/api/v1/messages/attachments/${encodeURIComponent(record.clientUploadId)}`,
    filename: record.filename,
    sizeBytes: record.sizeBytes ?? 0,
    mimeType,
    thumbnailUrl: typeof media.tinyBase64 === "string" && media.tinyBase64.startsWith("data:image/")
      ? media.tinyBase64
      : null,
    width: typeof media.width === "number" ? media.width : null,
    height: typeof media.height === "number" ? media.height : null,
  };
}

export async function POST(request: Request) {
  const csrfError = validateCsrf(request);
  if (csrfError) return csrfError;
  const startedAt = Date.now();
  const requestId = getRequestId(request);
  const limitResponse = await enforceRouteLimit(request, "api:v1:messages:attachments:presign", 120, 60);
  if (limitResponse) return limitResponse;

  const { user, response: authResponse } = await requireAuthenticatedUser();
  if (!user) return authResponse ?? jsonError("Not authenticated", 401, "UNAUTHORIZED");

  try {
    const body = await request.json() as Record<string, unknown>;
    const filename = typeof body.filename === "string" ? body.filename.trim() : "";
    if (!filename || filename.length > 255) return jsonError("Filename is invalid", 400, "BAD_REQUEST");
    const conversationId = typeof body.conversationId === "string" ? body.conversationId.trim() : "";
    if (!isUuid(conversationId) || !await canAccessConversation(conversationId, user.id)) {
      return jsonError("Conversation not found", 404, "NOT_FOUND");
    }
    const sizeBytes = normalizeAndValidateFileSize(body.sizeBytes, ATTACHMENT_UPLOAD_MAX_FILE_BYTES, "Attachment");
    if (sizeBytes === 0) return jsonError("Chat attachments cannot be empty", 400, "BAD_REQUEST");
    const mimeType = normalizeAndValidateMimeType(body.mimeType);
    const clientUploadId = typeof body.clientUploadId === "string" && body.clientUploadId.trim()
      ? body.clientUploadId.trim()
      : crypto.randomUUID();
    if (clientUploadId.length > 160) return jsonError("Upload reference is invalid", 400, "BAD_REQUEST");

    const [existing] = await db
      .select()
      .from(attachmentUploads)
      .where(and(
        eq(attachmentUploads.userId, user.id),
        eq(attachmentUploads.clientUploadId, clientUploadId),
      ))
      .limit(1);
    if (existing) {
      const matches = existing.conversationId === conversationId
        && existing.filename === filename
        && existing.mimeType === mimeType
        && existing.sizeBytes === sizeBytes;
      if (!matches || existing.status === "committed" || !existing.storagePath || !existing.uploadIntentId) {
        return jsonError("Upload reference has already been used", 409, "CONFLICT");
      }
      if (existing.status === "uploaded") {
        return jsonSuccess({ status: "uploaded", clientUploadId, storagePath: existing.storagePath, uploadIntentId: existing.uploadIntentId });
      }
      if (existing.status !== "uploading") {
        return jsonError("Upload session is no longer usable", 409, "CONFLICT");
      }
      const activeIntent = await db.query.uploadIntents.findFirst({
        where: and(
          eq(uploadIntents.id, existing.uploadIntentId),
          eq(uploadIntents.userId, user.id),
          eq(uploadIntents.status, "pending"),
        ),
        columns: { id: true },
      });
      if (!activeIntent) return jsonError("Upload session is no longer usable", 409, "CONFLICT");
      const admin = await createAdminClient();
      const { data: objectInfo } = await admin.storage.from(ATTACHMENTS_BUCKET).info(existing.storagePath);
      if (objectInfo) {
        return jsonSuccess({ status: "uploaded", clientUploadId, storagePath: existing.storagePath, uploadIntentId: existing.uploadIntentId });
      }
      const { data, error } = await admin.storage
        .from(ATTACHMENTS_BUCKET)
        .createSignedUploadUrl(existing.storagePath, { upsert: false });
      if (error || !data?.signedUrl) return jsonError("Failed to renew upload session", 503, "UNAVAILABLE");
      return jsonSuccess({
        status: "presigned",
        bucket: ATTACHMENTS_BUCKET,
        storagePath: existing.storagePath,
        signedUrl: data.signedUrl,
        uploadToken: data.token,
        clientUploadId,
        uploadIntentId: existing.uploadIntentId,
        contentType: mimeType,
      });
    }

    const extension = (filename.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
    const storagePath = `${user.id}/${crypto.randomUUID()}.${extension}`;
    const intent = await createUploadIntent({
      userId: user.id,
      bucket: ATTACHMENTS_BUCKET,
      storageKey: storagePath,
      scope: "chat_attachment",
      kind: "file",
      expectedMimeType: mimeType,
      expectedSize: sizeBytes,
      idempotencyKey: `chat:${clientUploadId}`,
      metadata: { conversationId, clientUploadId, filename },
    });
    const [session] = await db
      .insert(attachmentUploads)
      .values({
        userId: user.id,
        clientUploadId,
        conversationId,
        uploadIntentId: intent.id,
        assetId: intent.assetId,
        storagePath,
        filename,
        mimeType,
        sizeBytes,
        status: "uploading",
        error: null,
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      })
      .onConflictDoNothing()
      .returning();
    if (!session) return jsonError("Upload reference has already been used", 409, "CONFLICT");

    const admin = await createAdminClient();
    const { data, error } = await admin.storage
      .from(ATTACHMENTS_BUCKET)
      .createSignedUploadUrl(storagePath, { upsert: false });
    if (error || !data?.signedUrl) return jsonError("Failed to generate upload session", 503, "UNAVAILABLE");

    logApiRoute(request, {
      requestId,
      action: "messages.attachments.presign",
      userId: user.id,
      startedAt,
      success: true,
      status: 200,
    });
    return jsonSuccess({
      status: "presigned",
      bucket: ATTACHMENTS_BUCKET,
      storagePath,
      signedUrl: data.signedUrl,
      uploadToken: data.token,
      clientUploadId,
      uploadIntentId: intent.id,
      contentType: mimeType,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal error";
    const validation = /MIME|size|maximum/i.test(message);
    return jsonError(message, validation ? 400 : 500, validation ? "BAD_REQUEST" : "INTERNAL_ERROR");
  }
}

export async function PUT(request: Request) {
  const csrfError = validateCsrf(request);
  if (csrfError) return csrfError;
  const startedAt = Date.now();
  const requestId = getRequestId(request);
  const { user, response: authResponse } = await requireAuthenticatedUser();
  if (!user) return authResponse ?? jsonError("Not authenticated", 401, "UNAUTHORIZED");

  try {
    const body = await request.json() as Record<string, unknown>;
    const clientUploadId = typeof body.clientUploadId === "string" ? body.clientUploadId.trim() : "";
    if (!clientUploadId) return jsonError("Upload reference is required", 400, "BAD_REQUEST");
    const [record] = await db
      .select()
      .from(attachmentUploads)
      .where(and(
        eq(attachmentUploads.userId, user.id),
        eq(attachmentUploads.clientUploadId, clientUploadId),
      ))
      .limit(1);
    if (!record || !record.storagePath || !record.uploadIntentId || !record.conversationId) {
      return jsonError("Upload session not found", 404, "NOT_FOUND");
    }
    if (!await canAccessConversation(record.conversationId, user.id)) {
      return jsonError("Conversation not found", 404, "NOT_FOUND");
    }
    if (typeof body.storagePath === "string" && body.storagePath !== record.storagePath) {
      return jsonError("Upload object does not match the issued session", 409, "CONFLICT");
    }
    if (record.status === "committed") return jsonError("Upload has already been attached", 409, "CONFLICT");

    if (record.status !== "uploaded") {
      await finalizeUploadIntent({
        intentId: record.uploadIntentId,
        bucket: ATTACHMENTS_BUCKET,
        storageKey: record.storagePath,
        userId: user.id,
        expectedScope: "chat_attachment",
        expectedKind: "file",
      });
      const [updated] = await db
        .update(attachmentUploads)
        .set({ status: "uploaded", error: null, updatedAt: new Date() })
        .where(and(
          eq(attachmentUploads.id, record.id),
          eq(attachmentUploads.status, "uploading"),
          eq(attachmentUploads.storagePath, record.storagePath),
        ))
        .returning();
      if (!updated) return jsonError("Upload state changed; retry status", 409, "CONFLICT");
    }

    logApiRoute(request, {
      requestId,
      action: "messages.attachments.complete",
      userId: user.id,
      startedAt,
      success: true,
      status: 200,
    });
    return jsonSuccess({ attachment: attachmentResult(record, body) });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Upload verification failed", 422, "BAD_REQUEST");
  }
}

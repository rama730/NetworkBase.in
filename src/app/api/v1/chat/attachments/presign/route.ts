import { normalizeMediaDimensions } from "@/lib/messaging/media-metadata";
import { sql } from "drizzle-orm";
import { chatFileTypeAllowed } from "@/lib/messaging/attachment-types";

import {
  enforceRouteLimit,
  getRequestId,
  jsonError,
  jsonSuccess,
  logApiRoute,
  requireAuthenticatedUser,
} from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { validateCsrf } from "@/lib/security/csrf";
import { createAdminClient } from "@/lib/supabase/server";
import {
  ATTACHMENT_UPLOAD_MAX_FILE_BYTES,
  normalizeAndValidateFileSize,
  normalizeAndValidateMimeType,
} from "@/lib/upload/security";
import { createUploadIntent, finalizeUploadIntent } from "@/lib/upload/upload-intents";
import { isUuid } from "@/lib/validations/uuid";

// Chat uploads go straight to storage with a signed URL. The storage_assets
// lifecycle (0178) owns pending → verified → expiry, so there is no separate
// upload-session table. The key is deterministic per (channel, user, client
// upload id), which makes a retried presign idempotent.
const BUCKET = "chat-attachments";

async function isMember(channelId: string, userId: string) {
  const rows = await db.execute(sql`SELECT app_private.chat_is_member(${channelId}::uuid, ${userId}::uuid) AS ok`);
  return Boolean((rows as unknown as Array<{ ok: boolean }>)[0]?.ok);
}

export async function POST(request: Request) {
  const csrfError = validateCsrf(request);
  if (csrfError) return csrfError;
  const startedAt = Date.now();
  const requestId = getRequestId(request);
  const limitResponse = await enforceRouteLimit(request, "api:v1:chat:attachments:presign", 120, 60);
  if (limitResponse) return limitResponse;
  const { user, response: authResponse } = await requireAuthenticatedUser();
  if (!user) return authResponse ?? jsonError("Sign in to continue", 401, "UNAUTHORIZED");

  try {
    const body = await request.json() as Record<string, unknown>;
    const channelId = typeof body.channelId === "string" ? body.channelId : "";
    const clientUploadId = typeof body.clientUploadId === "string" ? body.clientUploadId : "";
    const filename = typeof body.filename === "string" ? body.filename.trim() : "";
    if (!isUuid(channelId) || !isUuid(clientUploadId) || !filename || filename.length > 255) {
      return jsonError("Invalid upload request", 400, "BAD_REQUEST");
    }
    if (!await isMember(channelId, user.id)) return jsonError("Conversation not found", 404, "NOT_FOUND");
    const sizeBytes = normalizeAndValidateFileSize(body.sizeBytes, ATTACHMENT_UPLOAD_MAX_FILE_BYTES, "Attachment");
    if (sizeBytes === 0) return jsonError("Attachments cannot be empty", 400, "BAD_REQUEST");
    const mimeType = normalizeAndValidateMimeType(body.mimeType);
    if (!chatFileTypeAllowed(mimeType)) return jsonError("This file type can’t be sent in messages.", 400, "BAD_REQUEST");

    const dimensions = /^(image|video)\//.test(mimeType) ? normalizeMediaDimensions(body.width, body.height) : null;
    const originalFilename = typeof body.originalFilename === "string" ? body.originalFilename.trim().slice(0, 255) : filename;
    const extension = (filename.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 10) || "bin";
    const storagePath = `${channelId}/${user.id}/${clientUploadId}.${extension}`;
    const intent = await createUploadIntent({
      userId: user.id,
      bucket: BUCKET,
      storageKey: storagePath,
      scope: "chat_attachment",
      kind: "file",
      expectedMimeType: mimeType,
      expectedSize: sizeBytes,
      idempotencyKey: `chat:${clientUploadId}`,
      metadata: { channelId, clientUploadId, filename, original_filename: originalFilename, width: dimensions?.width ?? null, height: dimensions?.height ?? null },
    });
    const admin = await createAdminClient();
    const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(storagePath, { upsert: false });
    if (error || !data?.signedUrl) return jsonError("Couldn’t generate upload session", 503, "UNAVAILABLE");

    logApiRoute(request, { requestId, action: "chat.attachments.presign", userId: user.id, startedAt, success: true, status: 200 });
    return jsonSuccess({
      assetId: intent.assetId,
      uploadIntentId: intent.id,
      storagePath,
      signedUrl: data.signedUrl,
      uploadToken: data.token,
      contentType: mimeType,
    });
  } catch (error) {
    const validation = error instanceof Error && /MIME|size|maximum/i.test(error.message);
    return validation
      ? jsonError("File type or size is not allowed", 400, "BAD_REQUEST")
      : jsonError("Upload could not be started", 500, "INTERNAL_ERROR");
  }
}

/** Verify the uploaded bytes; the asset becomes attachable once verified. */
export async function PUT(request: Request) {
  const csrfError = validateCsrf(request);
  if (csrfError) return csrfError;
  const startedAt = Date.now();
  const requestId = getRequestId(request);
  const { user, response: authResponse } = await requireAuthenticatedUser();
  if (!user) return authResponse ?? jsonError("Sign in to continue", 401, "UNAUTHORIZED");

  try {
    const body = await request.json() as Record<string, unknown>;
    const uploadIntentId = typeof body.uploadIntentId === "string" ? body.uploadIntentId : "";
    const storagePath = typeof body.storagePath === "string" ? body.storagePath : "";
    if (!isUuid(uploadIntentId) || !storagePath) return jsonError("Invalid upload reference", 400, "BAD_REQUEST");
    const channelId = storagePath.split("/")[0] ?? "";
    if (!isUuid(channelId) || !await isMember(channelId, user.id)) return jsonError("Conversation not found", 404, "NOT_FOUND");
    await finalizeUploadIntent({
      intentId: uploadIntentId,
      bucket: BUCKET,
      storageKey: storagePath,
      userId: user.id,
      expectedScope: "chat_attachment",
      expectedKind: "file",
    });
    logApiRoute(request, { requestId, action: "chat.attachments.verify", userId: user.id, startedAt, success: true, status: 200 });
    return jsonSuccess({ verified: true });
  } catch {
    return jsonError("Upload verification failed", 422, "BAD_REQUEST");
  }
}

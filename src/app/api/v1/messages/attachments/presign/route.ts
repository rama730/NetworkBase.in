import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { createAdminClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { attachmentUploads, messageAttachments } from "@/lib/db/schema";
import {
  enforceRouteLimit,
  getRequestId,
  jsonError,
  logApiRoute,
  requireAuthenticatedUser,
} from "@/app/api/v1/_shared";

const ATTACHMENTS_BUCKET = "chat-attachments";
const MAX_ATTACHMENT_SIZE_BYTES = 50 * 1024 * 1024; // 50MB

export async function POST(request: Request) {
  const startedAt = Date.now();
  const requestId = getRequestId(request);

  const limitResponse = await enforceRouteLimit(request, "api:v1:messages:attachments:presign", 120, 60);
  if (limitResponse) {
    return limitResponse;
  }

  const { user, response: authResponse } = await requireAuthenticatedUser();
  if (!user) {
    return authResponse ?? jsonError("Not authenticated", 401, "UNAUTHORIZED");
  }

  try {
    const body = await request.json();
    const { filename, mimeType, sizeBytes, checksumSha256, conversationId, clientUploadId } = body;

    if (!filename || typeof filename !== "string") {
      return jsonError("Filename is required", 400, "BAD_REQUEST");
    }

    if (!sizeBytes || typeof sizeBytes !== "number" || sizeBytes > MAX_ATTACHMENT_SIZE_BYTES || sizeBytes <= 0) {
      return jsonError("File size exceeds 50MB limit or is invalid", 413, "BAD_REQUEST");
    }

    const sanitizedMime = (mimeType && typeof mimeType === "string") ? mimeType.toLowerCase() : "application/octet-stream";
    const ext = (filename.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
    const resolvedClientUploadId = (typeof clientUploadId === "string" && clientUploadId.trim()) 
      ? clientUploadId.trim() 
      : crypto.randomUUID();

    // 1. Content-Addressable Storage (CAS) Deduplication (Ponytail Dim G)
    // If exact same file has already been committed, link instantly without uploading bytes
    if (typeof checksumSha256 === "string" && checksumSha256.length === 64) {
      const [existing] = await db
        .select({
          storagePath: messageAttachments.storagePath,
          type: messageAttachments.type,
          sizeBytes: messageAttachments.sizeBytes,
        })
        .from(messageAttachments)
        .where(
          and(
            eq(messageAttachments.sizeBytes, sizeBytes),
            eq(messageAttachments.storagePath, checksumSha256)
          )
        )
        .limit(1);

      if (existing?.storagePath) {
        await db
          .insert(attachmentUploads)
          .values({
            userId: user.id,
            clientUploadId: resolvedClientUploadId,
            conversationId: conversationId || null,
            storagePath: existing.storagePath,
            filename,
            mimeType: sanitizedMime,
            sizeBytes,
            status: "uploaded",
            error: null,
            updatedAt: new Date(),
            expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24),
          })
          .onConflictDoUpdate({
            target: [attachmentUploads.userId, attachmentUploads.clientUploadId],
            set: {
              storagePath: existing.storagePath,
              filename,
              mimeType: sanitizedMime,
              sizeBytes,
              status: "uploaded",
              error: null,
              updatedAt: new Date(),
              expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24),
            },
          });

        return NextResponse.json({
          status: "deduplicated",
          storagePath: existing.storagePath,
          clientUploadId: resolvedClientUploadId,
          type: existing.type,
        });
      }
    }

    // 2. Generate unique storage path and presigned upload session
    const timestamp = Date.now();
    const randomSuffix = Math.random().toString(36).substring(7);
    const storagePath = `${user.id}/${timestamp}-${randomSuffix}.${ext}`;

    const admin = await createAdminClient();
    const { data: uploadData, error: uploadError } = await admin.storage
      .from(ATTACHMENTS_BUCKET)
      .createSignedUploadUrl(storagePath, { upsert: false });

    if (uploadError || !uploadData?.signedUrl) {
      return jsonError("Failed to generate presigned upload session", 500, "INTERNAL_ERROR");
    }

    // 3. Record upload session row in DB
    await db
      .insert(attachmentUploads)
      .values({
        userId: user.id,
        clientUploadId: resolvedClientUploadId,
        conversationId: conversationId || null,
        storagePath,
        filename,
        mimeType: sanitizedMime,
        sizeBytes,
        status: "uploading",
        error: null,
        updatedAt: new Date(),
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24),
      })
      .onConflictDoUpdate({
        target: [attachmentUploads.userId, attachmentUploads.clientUploadId],
        set: {
          storagePath,
          filename,
          mimeType: sanitizedMime,
          sizeBytes,
          status: "uploading",
          error: null,
          updatedAt: new Date(),
          expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24),
        },
      });

    logApiRoute(request, {
      requestId,
      action: "messages.attachments.presign",
      userId: user.id,
      startedAt,
      success: true,
      status: 200,
    });

    return NextResponse.json({
      status: "presigned",
      bucket: ATTACHMENTS_BUCKET,
      storagePath,
      signedUrl: uploadData.signedUrl,
      uploadToken: uploadData.token,
      clientUploadId: resolvedClientUploadId,
      contentType: sanitizedMime,
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Internal error", 500, "INTERNAL_ERROR");
  }
}

export async function PUT(request: Request) {
  const startedAt = Date.now();
  const requestId = getRequestId(request);

  const { user, response: authResponse } = await requireAuthenticatedUser();
  if (!user) {
    return authResponse ?? jsonError("Not authenticated", 401, "UNAUTHORIZED");
  }

  try {
    const body = await request.json();
    const { clientUploadId, storagePath, width, height, tinyBase64 } = body;

    if (!clientUploadId || typeof clientUploadId !== "string") {
      return jsonError("Client upload ID is required", 400, "BAD_REQUEST");
    }

    const [record] = await db
      .select()
      .from(attachmentUploads)
      .where(
        and(
          eq(attachmentUploads.userId, user.id),
          eq(attachmentUploads.clientUploadId, clientUploadId.trim())
        )
      )
      .limit(1);

    if (!record) {
      return jsonError("Upload session not found", 404, "NOT_FOUND");
    }

    const effectiveStoragePath = storagePath || record.storagePath;

    // Verify storage path ownership
    if (!effectiveStoragePath.startsWith(`${user.id}/`)) {
      return jsonError("Unauthorized storage path", 403, "FORBIDDEN");
    }

    // Mark as uploaded
    await db
      .update(attachmentUploads)
      .set({
        status: "uploaded",
        storagePath: effectiveStoragePath,
        updatedAt: new Date(),
        error: null,
      })
      .where(
        and(
          eq(attachmentUploads.userId, user.id),
          eq(attachmentUploads.clientUploadId, clientUploadId.trim())
        )
      );

    const admin = await createAdminClient();
    const { data: signedData } = await admin.storage
      .from(ATTACHMENTS_BUCKET)
      .createSignedUrl(effectiveStoragePath, 86400);

    const fileType = record.mimeType?.startsWith("image/")
      ? "image"
      : record.mimeType?.startsWith("video/")
      ? "video"
      : "file";

    logApiRoute(request, {
      requestId,
      action: "messages.attachments.complete",
      userId: user.id,
      startedAt,
      success: true,
      status: 200,
    });

    return NextResponse.json({
      success: true,
      attachment: {
        id: record.clientUploadId,
        storagePath: effectiveStoragePath,
        type: fileType,
        url: signedData?.signedUrl || `/api/v1/messages/attachments/${record.clientUploadId}`,
        filename: record.filename,
        sizeBytes: record.sizeBytes,
        mimeType: record.mimeType,
        thumbnailUrl: tinyBase64 || null,
        width: typeof width === "number" ? width : null,
        height: typeof height === "number" ? height : null,
      },
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Internal error", 500, "INTERNAL_ERROR");
  }
}

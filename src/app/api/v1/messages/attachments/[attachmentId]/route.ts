import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { createAdminClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import {
  conversations,
  conversationParticipants,
  dmPairs,
  messageAttachments,
  messageHiddenForUsers,
  messages,
  storageAssets,
} from "@/lib/db/schema";
import { resolvePrivacyRelationship } from "@/lib/privacy/resolver";
import { isUuid } from "@/lib/validations/uuid";
import { MESSAGE_MEDIA_PREVIEW_MAX_WIDTH } from "@/lib/messages/media-metadata";
import { resolveAttachmentStoragePath } from "@/lib/messages/attachment-storage-path";
import { streamPrivateObject } from "@/lib/storage/private-object-response";
import {
  enforceRouteLimit,
  getRequestId,
  jsonError,
  logApiRoute,
  requireAuthenticatedUser,
} from "@/app/api/v1/_shared";

const ATTACHMENTS_BUCKET = "chat-attachments";
const ATTACHMENT_SIGNED_URL_TTL_SECONDS = 60;

function storageImageTransformationsEnabled() {
  return process.env.SUPABASE_STORAGE_IMAGE_TRANSFORMATIONS_ENABLED?.trim().toLowerCase() === "true";
}

async function getReusableAttachmentSignedUrl(input: {
  admin: Awaited<ReturnType<typeof createAdminClient>>;
  storagePath: string;
  download?: string;
  transform?: { width: number; resize: "contain"; format: "origin" };
}) {
  const { data, error } = await input.admin.storage
    .from(ATTACHMENTS_BUCKET)
    .createSignedUrl(input.storagePath, ATTACHMENT_SIGNED_URL_TTL_SECONDS, {
      download: input.download,
      transform: input.transform,
    });
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

function sanitizeFilename(filename: string | null | undefined) {
  const raw = typeof filename === "string" ? filename.trim() : "";
  const fallback = "attachment";
  return (raw || fallback).replace(/[^A-Za-z0-9._() \-]/g, "_");
}

export async function GET(
  request: Request,
  context: { params: Promise<{ attachmentId: string }> },
) {
  const startedAt = Date.now();
  const requestId = getRequestId(request);
  const limitResponse = await enforceRouteLimit(request, "api:v1:messages:attachments:get", 600, 60);
  if (limitResponse) {
    logApiRoute(request, {
      requestId,
      action: "messages.attachments.get",
      startedAt,
      success: false,
      status: 429,
      errorCode: "RATE_LIMITED",
    });
    return limitResponse;
  }

  const auth = await requireAuthenticatedUser();
  if (auth.response || !auth.user) {
    logApiRoute(request, {
      requestId,
      action: "messages.attachments.get",
      startedAt,
      success: false,
      status: 401,
      errorCode: "UNAUTHORIZED",
    });
    return auth.response ?? jsonError("Not authenticated", 401, "UNAUTHORIZED");
  }
  const user = auth.user;

  const { attachmentId } = await context.params;
  const trimmedAttachmentId = attachmentId.trim();
  if (!trimmedAttachmentId || !isUuid(trimmedAttachmentId)) {
    logApiRoute(request, {
      requestId,
      action: "messages.attachments.get",
      userId: user.id,
      startedAt,
      success: false,
      status: 400,
      errorCode: "BAD_REQUEST",
    });
    return jsonError("Attachment not found", 404, "NOT_FOUND");
  }

  const [attachment] = await db
    .select({
      id: messageAttachments.id,
      filename: messageAttachments.filename,
      mimeType: messageAttachments.mimeType,
      sizeBytes: messageAttachments.sizeBytes,
      storagePath: messageAttachments.storagePath,
      legacyUrl: messageAttachments.url,
      assetStorageKey: storageAssets.storageKey,
      assetSize: storageAssets.verifiedSize,
      assetMimeType: storageAssets.verifiedMimeType,
      conversationId: messages.conversationId,
      conversationType: conversations.type,
      dmUserOneId: dmPairs.userLow,
      dmUserTwoId: dmPairs.userHigh,
    })
    .from(messageAttachments)
    .innerJoin(storageAssets, eq(storageAssets.id, messageAttachments.assetId))
    .innerJoin(messages, eq(messageAttachments.messageId, messages.id))
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .leftJoin(dmPairs, eq(dmPairs.conversationId, conversations.id))
    .innerJoin(
      conversationParticipants,
      and(
        eq(conversationParticipants.conversationId, messages.conversationId),
        eq(conversationParticipants.userId, user.id),
      ),
    )
    .leftJoin(
      messageHiddenForUsers,
      and(
        eq(messageHiddenForUsers.messageId, messages.id),
        eq(messageHiddenForUsers.userId, user.id),
      ),
    )
    .where(
      and(
        eq(messageAttachments.id, trimmedAttachmentId),
        eq(storageAssets.bucket, ATTACHMENTS_BUCKET),
        eq(storageAssets.state, "verified"),
        isNull(messages.deletedAt),
        isNull(messageHiddenForUsers.id),
      ),
    )
    .limit(1);

  if (!attachment) {
    logApiRoute(request, {
      requestId,
      action: "messages.attachments.get",
      userId: user.id,
      startedAt,
      success: false,
      status: 404,
      errorCode: "NOT_FOUND",
    });
    return jsonError("Attachment not found", 404, "NOT_FOUND");
  }

  if (attachment.conversationType === "dm") {
    const otherParticipantId = attachment.dmUserOneId === user.id
      ? attachment.dmUserTwoId
      : attachment.dmUserTwoId === user.id
        ? attachment.dmUserOneId
        : null;
    if (!otherParticipantId) {
      return jsonError("Attachment not found", 404, "NOT_FOUND");
    }
    const privacy = await resolvePrivacyRelationship(user.id, otherParticipantId);
    if (!privacy || privacy.blockedByViewer || privacy.blockedByTarget) {
      logApiRoute(request, {
        requestId,
        action: "messages.attachments.get",
        userId: user.id,
        startedAt,
        success: false,
        status: 404,
        errorCode: "NOT_FOUND",
      });
      return jsonError("Attachment not found", 404, "NOT_FOUND");
    }
  }

  const storagePath = resolveAttachmentStoragePath({
    storagePath: attachment.storagePath,
    url: attachment.legacyUrl,
  });
  if (!storagePath) {
    logApiRoute(request, {
      requestId,
      action: "messages.attachments.get",
      userId: user.id,
      startedAt,
      success: false,
      status: 404,
      errorCode: "NOT_FOUND",
    });
    return jsonError("Attachment not found", 404, "NOT_FOUND");
  }
  if (storagePath !== attachment.assetStorageKey || attachment.assetSize == null) {
    return jsonError("Attachment not found", 404, "NOT_FOUND");
  }

  const requestUrl = new URL(request.url);
  const download = requestUrl.searchParams.get("download") === "1";
  const preview = requestUrl.searchParams.get("preview") === "1";
  const requestedMimeType = (attachment.assetMimeType || attachment.mimeType || "").trim();
  const usePreviewTransform = (
    preview
    && storageImageTransformationsEnabled()
    && requestedMimeType.startsWith("image/")
    && requestedMimeType !== "image/gif"
  );

  const admin = await createAdminClient();
  const filename = sanitizeFilename(attachment.filename);

  const signedUrl = await getReusableAttachmentSignedUrl({
    admin,
    storagePath,
    transform: usePreviewTransform ? {
      width: MESSAGE_MEDIA_PREVIEW_MAX_WIDTH,
      resize: "contain",
      format: "origin",
    } : undefined,
  });

  if (!signedUrl) {
    logApiRoute(request, {
      requestId,
      action: "messages.attachments.get",
      userId: user.id,
      startedAt,
      success: false,
      status: 404,
      errorCode: "NOT_FOUND",
    });
    return jsonError("Attachment not found", 404, "NOT_FOUND");
  }

  logApiRoute(request, {
    requestId,
    action: "messages.attachments.get",
    userId: user.id,
    startedAt,
    success: true,
    status: 200,
  });
  const storageIdentity = createHash("sha256").update(storagePath).digest("base64url").slice(0, 16);
  return streamPrivateObject({
    request,
    signedUrl,
    totalSize: usePreviewTransform ? null : attachment.assetSize,
    mimeType: requestedMimeType,
    filename,
    disposition: download ? "attachment" : "inline",
    etag: `"chat-attachment-${attachment.id}-${storageIdentity}${usePreviewTransform ? "-preview" : ""}"`,
  });
}

export async function HEAD(
  request: Request,
  context: { params: Promise<{ attachmentId: string }> },
) {
  return GET(request, context);
}

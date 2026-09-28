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
} from "@/lib/db/schema";
import { resolvePrivacyRelationship } from "@/lib/privacy/resolver";
import { isUuid } from "@/lib/validations/uuid";
import { MESSAGE_MEDIA_PREVIEW_MAX_WIDTH } from "@/lib/messages/media-metadata";
import { resolveAttachmentStoragePath } from "@/lib/messages/attachment-storage-path";
import {
  enforceRouteLimit,
  getRequestId,
  jsonError,
  logApiRoute,
  requireAuthenticatedUser,
} from "@/app/api/v1/_shared";

const ATTACHMENTS_BUCKET = "chat-attachments";
const ATTACHMENT_SIGNED_URL_TTL_SECONDS = 86_400; // 24 hours
const ATTACHMENT_REDIRECT_STALE_SECONDS = 3_600;
const ATTACHMENT_REDIRECT_CACHE_CONTROL = `private, max-age=${ATTACHMENT_SIGNED_URL_TTL_SECONDS - ATTACHMENT_REDIRECT_STALE_SECONDS}, stale-while-revalidate=${ATTACHMENT_REDIRECT_STALE_SECONDS}`;

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
      storagePath: messageAttachments.storagePath,
      legacyUrl: messageAttachments.url,
      conversationId: messages.conversationId,
      conversationType: conversations.type,
      dmUserOneId: dmPairs.userLow,
      dmUserTwoId: dmPairs.userHigh,
    })
    .from(messageAttachments)
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

  const requestUrl = new URL(request.url);
  const download = requestUrl.searchParams.get("download") === "1";
  const preview = requestUrl.searchParams.get("preview") === "1";
  const requestedMimeType = (attachment.mimeType || "").trim();
  const usePreviewTransform = (
    preview
    && storageImageTransformationsEnabled()
    && requestedMimeType.startsWith("image/")
    && requestedMimeType !== "image/gif"
  );

  const admin = await createAdminClient();
  const filename = sanitizeFilename(attachment.filename);

  // For video files, proxy the bytes through our server with the correct Content-Type.
  // Supabase Storage may have the wrong Content-Type if the file was uploaded as
  // application/octet-stream, causing <video> tags to refuse to play.
  const fileExt = (attachment.filename || "").split(".").pop()?.toLowerCase();
  const videoExtensions = new Set(["mp4", "webm", "mov", "ogg", "avi", "mkv"]);
  const isVideo = requestedMimeType.startsWith("video/") || videoExtensions.has(fileExt || "");
  const isStreamRequest = requestUrl.searchParams.get("stream") === "1";

  if (isVideo || isStreamRequest) {
    const signedUrl = await getReusableAttachmentSignedUrl({
      admin,
      storagePath,
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
      status: 307,
    });

    return new Response(null, {
      status: 307,
      headers: {
        Location: signedUrl,
        "Cache-Control": ATTACHMENT_REDIRECT_CACHE_CONTROL,
      },
    });
  }

  const signedUrl = await getReusableAttachmentSignedUrl({
    admin,
    storagePath,
    download: download ? filename : undefined,
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
    status: 307,
  });

  return new Response(null, {
    status: 307,
    headers: {
      Location: signedUrl,
      "Cache-Control": ATTACHMENT_REDIRECT_CACHE_CONTROL,
    },
  });
}

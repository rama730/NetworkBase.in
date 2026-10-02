"use client";

import { compressImage } from "@/lib/messaging/image-compression";
import { readMediaDimensions } from "@/lib/messaging/media-metadata";
import { uploadToSupabaseSignedUrl } from "@/lib/upload/supabase-signed-upload-client";

const ROUTE = "/api/v1/chat/attachments/presign";

async function json(response: Response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.message || body?.error?.message || "Upload failed");
  return body?.data ?? body;
}

/**
 * Compress images on the device, upload straight to storage with a signed URL,
 * then have the server verify the bytes. Returns the verified asset id to attach.
 */
export async function uploadChatFile(channelId: string, original: File, onProgress?: (percent: number) => void) {
  const file = await compressImage(original);
  const dimensions = await readMediaDimensions(file);
  const clientUploadId = crypto.randomUUID();
  onProgress?.(5);
  const session = await json(await fetch(ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      channelId,
      clientUploadId,
      filename: original.name,
      sizeBytes: file.size,
      mimeType: file.type || "application/octet-stream",
      width: dimensions?.width ?? null,
      height: dimensions?.height ?? null,
    }),
  }));
  await uploadToSupabaseSignedUrl(
    { bucket: "chat-attachments", storagePath: session.storagePath, uploadToken: session.uploadToken, uploadUrl: session.signedUrl, contentType: session.contentType, operationId: session.uploadIntentId },
    file,
    { cacheProfile: "immutable", onProgress: (sent, total) => onProgress?.(5 + Math.round((total ? sent / total : 0) * 85)) },
  );
  await json(await fetch(ROUTE, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uploadIntentId: session.uploadIntentId, storagePath: session.storagePath }),
  }));
  onProgress?.(100);
  return session.assetId as string;
}

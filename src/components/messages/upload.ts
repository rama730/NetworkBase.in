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
// At most 2 images decode and re-encode at once, so ten photos don't spike memory
// and freeze the page (UPL-01). Transfers are already limited by the upload client.
const MAX_COMPRESSIONS = 2;
let compressing = 0;
const waiting: Array<() => void> = [];

async function compressQueued(file: File) {
  if (compressing >= MAX_COMPRESSIONS) await new Promise<void>((resolve) => waiting.push(resolve));
  compressing += 1;
  try {
    return await compressImage(file);
  } finally {
    compressing -= 1;
    waiting.shift()?.();
  }
}

export async function uploadChatFile(channelId: string, original: File, onProgress?: (percent: number) => void, signal?: AbortSignal) {
  const file = await compressQueued(original);
  signal?.throwIfAborted();
  const dimensions = await readMediaDimensions(file);
  const clientUploadId = crypto.randomUUID();
  onProgress?.(5);
  const session = await json(await fetch(ROUTE, {
    method: "POST",
    signal,
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
    { cacheProfile: "immutable", signal, onProgress: (sent, total) => onProgress?.(5 + Math.round((total ? sent / total : 0) * 85)) },
  );
  await json(await fetch(ROUTE, {
    method: "PUT",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uploadIntentId: session.uploadIntentId, storagePath: session.storagePath }),
  }));
  onProgress?.(100);
  return session.assetId as string;
}

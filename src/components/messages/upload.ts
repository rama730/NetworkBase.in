"use client";

import { compressImage } from "@/lib/messaging/image-compression";
import { readMediaDimensions } from "@/lib/messaging/media-metadata";
import { uploadToSupabaseSignedUrl } from "@/lib/upload/supabase-signed-upload-client";

const ROUTE = "/api/v1/chat/attachments/presign";

/** An upload error with its HTTP status: 4xx (too big, wrong type) won't work on a retry. */
export type UploadError = Error & { status?: number };

async function json(response: Response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error: UploadError = new Error(body?.message || body?.error?.message || "Upload failed");
    error.status = response.status;
    throw error;
  }
  return body?.data ?? body;
}

/** Retry can't help: the server refused the file itself (not a timeout or a rate limit). */
export function uploadRefused(error: unknown) {
  const status = Number((error as UploadError | null)?.status ?? 0);
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

/** What a tile says when a file didn't upload: the server's reason, or plain words, never "Failed to fetch". */
export function uploadReason(error: unknown) {
  if (typeof navigator !== "undefined" && !navigator.onLine) return "You're offline";
  if (error instanceof TypeError) return "Connection lost";
  const message = error instanceof Error ? error.message : "";
  return uploadRefused(error) && message && message.length < 80 && !/^Upload failed/.test(message) ? message : "Upload failed";
}

/** Files the server never accepts: caught before uploading, with the reason. */
export function fileProblem(file: File, maxBytes: number) {
  if (file.size === 0) return `${file.name} is empty.`;
  if (file.type === "image/svg+xml" || /\.svg$/i.test(file.name)) return `${file.name}: SVG files can't be attached.`;
  if (file.size > maxBytes) return `${file.name} is too large (max ${Math.round(maxBytes / 1024 / 1024)} MB).`;
  return null;
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
      filename: file.name,
      originalFilename: original.name,
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

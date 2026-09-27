'use client';

import { useCallback } from 'react';
import { uploadToSupabaseSignedUrl, type SupabaseSignedUploadSession } from '@/lib/upload/supabase-signed-upload-client';
import type { UploadedAttachment } from '@/app/actions/messaging';

export interface DirectUploadParams {
  file: File;
  conversationId?: string;
  clientUploadId?: string;
  width?: number;
  height?: number;
  tinyBase64?: string;
  onProgress?: (progress: number) => void;
}

async function computeSha256Hex(blob: Blob): Promise<string> {
  if (typeof window === 'undefined' || !window.crypto?.subtle) return '';
  try {
    const buffer = await blob.slice(0, 1024 * 1024 * 5).arrayBuffer(); // first 5MB for fast fingerprint
    const hashBuffer = await window.crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return '';
  }
}

export function useDirectAttachmentUpload() {
  const uploadDirect = useCallback(async ({
    file,
    conversationId,
    clientUploadId,
    width,
    height,
    tinyBase64,
    onProgress,
  }: DirectUploadParams): Promise<UploadedAttachment> => {
    onProgress?.(10);
    const checksumSha256 = await computeSha256Hex(file);
    onProgress?.(25);

    // 1. Request presigned upload session or check CAS deduplication
    const presignRes = await fetch('/api/v1/messages/attachments/presign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
        checksumSha256,
        conversationId,
        clientUploadId,
      }),
    });

    if (!presignRes.ok) {
      const err = await presignRes.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to initialize upload session');
    }

    const presignData = await presignRes.json();
    onProgress?.(50);

    // 2. Direct upload if not deduplicated
    if (presignData.status === 'presigned') {
      const session: SupabaseSignedUploadSession = {
        bucket: presignData.bucket,
        storagePath: presignData.storagePath,
        uploadToken: presignData.uploadToken,
        contentType: presignData.contentType || file.type || 'application/octet-stream',
      };

      await uploadToSupabaseSignedUrl(session, file, { cacheProfile: 'immutable' });
    }

    onProgress?.(80);

    // 3. Finalize upload session
    const completeRes = await fetch('/api/v1/messages/attachments/presign', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientUploadId: presignData.clientUploadId || clientUploadId,
        storagePath: presignData.storagePath,
        width,
        height,
        tinyBase64,
      }),
    });

    if (!completeRes.ok) {
      const err = await completeRes.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to complete upload session');
    }

    const completeData = await completeRes.json();
    onProgress?.(100);

    return completeData.attachment as UploadedAttachment;
  }, []);

  return { uploadDirect };
}

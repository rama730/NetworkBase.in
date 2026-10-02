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
    // The server verifies the complete object digest after transfer. A browser
    // prefix hash is not accepted as content identity.
    onProgress?.(20);
    const presignRes = await fetch('/api/v1/messages/attachments/presign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
        conversationId,
        clientUploadId,
      }),
    });

    if (!presignRes.ok) {
      const err = await presignRes.json().catch(() => ({}));
      throw new Error(err.message || 'Failed to initialize upload session');
    }

    const presignData = (await presignRes.json()).data;
    onProgress?.(50);

    // A retried initiation may report that the immutable object already
    // arrived, in which case finalization is the only remaining step.
    if (presignData.status === 'presigned') {
      const session: SupabaseSignedUploadSession = {
        bucket: presignData.bucket,
        storagePath: presignData.storagePath,
        uploadToken: presignData.uploadToken,
        uploadUrl: presignData.signedUrl,
        contentType: presignData.contentType || file.type || 'application/octet-stream',
        operationId: presignData.uploadIntentId,
      };

      await uploadToSupabaseSignedUrl(session, file, {
        cacheProfile: 'immutable',
        onProgress: (uploadedBytes, totalBytes) => {
          const ratio = totalBytes > 0 ? uploadedBytes / totalBytes : 0;
          onProgress?.(20 + Math.round(ratio * 60));
        },
      });
    }

    onProgress?.(80);

    // Verification and publication progress is distinct from byte transfer.
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
      throw new Error(err.message || 'Failed to complete upload session');
    }

    const completeData = (await completeRes.json()).data;
    onProgress?.(100);

    return completeData.attachment as UploadedAttachment;
  }, []);

  return { uploadDirect };
}

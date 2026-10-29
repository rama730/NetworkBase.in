"use client";

import { createWorkspaceCoverImageUploadUrlAction, finalizeWorkspaceCoverImageUploadAction } from "@/app/actions/workspace";

// One place for the project picture rules, shared by Project settings and create step 4.
export const WORKSPACE_IMAGE_UPLOAD_MAX_BYTES = 2 * 1024 * 1024;
export const WORKSPACE_IMAGE_OUTPUT_SIZE = 1024;
export const WORKSPACE_IMAGE_PREVIEW_SIZE = 224;
export const ALLOWED_WORKSPACE_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

/** Crops (square, with optional zoom/offset), uploads through a signed URL, and finalizes the project picture. */
export async function uploadWorkspaceImage(
    projectId: string,
    file: File,
    crop: { zoom: number; offsetX: number; offsetY: number } = { zoom: 1, offsetX: 0, offsetY: 0 },
): Promise<{ publicUrl: string; optimized: boolean }> {
    const [{ prepareWorkspaceImageForUpload }, { uploadToSupabaseSignedUrl }] = await Promise.all([
        import("@/lib/upload/image-prep-client"),
        import("@/lib/upload/supabase-signed-upload-client"),
    ]);
    const isGif = file.type === "image/gif" || file.name.toLowerCase().endsWith(".gif");
    const preparedImage = await prepareWorkspaceImageForUpload(file, {
        maxBytes: WORKSPACE_IMAGE_UPLOAD_MAX_BYTES,
        size: WORKSPACE_IMAGE_OUTPUT_SIZE,
        previewSize: WORKSPACE_IMAGE_PREVIEW_SIZE,
        ...crop,
        outputType: isGif ? undefined : "image/jpeg",
    });
    const uploadSession = await createWorkspaceCoverImageUploadUrlAction({
        projectId,
        mimeType: preparedImage.contentType,
        sizeBytes: preparedImage.blob.size,
    });
    if (!uploadSession.success) {
        throw new Error(uploadSession.error || "Couldn’t prepare workspace avatar upload");
    }

    await uploadToSupabaseSignedUrl(uploadSession, preparedImage.blob, { cacheProfile: "immutable" });

    const finalized = await finalizeWorkspaceCoverImageUploadAction({
        projectId,
        uploadIntentId: uploadSession.uploadIntentId,
    });
    if (!finalized.success) {
        throw new Error(finalized.error || "Couldn’t finalize workspace avatar upload");
    }
    return { publicUrl: finalized.publicUrl, optimized: preparedImage.optimized };
}

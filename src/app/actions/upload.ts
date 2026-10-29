'use server';

import { createAdminClient, createClient } from '@/lib/supabase/server';
import { assertWorkspaceUploadAccess } from '@/lib/files/internal-helpers';
import { isCanonicalWorkspaceFileKey, parseWorkspaceFileKey } from '@/lib/storage/workspace-file-key';
import { logger } from '@/lib/logger';
import {
    normalizeAndValidateFileSize,
    normalizeAndValidateMimeType,
    WORKSPACE_UPLOAD_MAX_FILE_BYTES,
} from '@/lib/upload/security';
import { createUploadIntent, createUploadIntents } from '@/lib/upload/upload-intents';
import { allocateWorkspaceObjectKey } from '@/lib/upload/workspace-upload-allocation';

const MAX_BATCH_UPLOAD_KEYS = 50;

const UPLOAD_ERROR_CODES = {
    KEY_FORMAT_INVALID: 'KEY_FORMAT_INVALID',
    UPLOAD_VALIDATION_FAILED: 'UPLOAD_VALIDATION_FAILED',
} as const;

function isUploadValidationError(message: string): boolean {
    return (
        message.includes('MIME type') ||
        message.includes('File size') ||
        message.includes('exceeds maximum size') ||
        message.includes('Relative path')
    );
}

async function assertUploadAccessForKey(key: string, userId: string) {
    const parsed = parseWorkspaceFileKey(key);
    if (!parsed) {
        throw new Error(UPLOAD_ERROR_CODES.KEY_FORMAT_INVALID);
    }
    if (!isCanonicalWorkspaceFileKey(key)) {
        throw new Error(UPLOAD_ERROR_CODES.KEY_FORMAT_INVALID);
    }
    const projectId = parsed.projectId;
    // Org members upload only to their own copies; createFileNode checks the exact copy (report §23.5).
    await assertWorkspaceUploadAccess(projectId, userId, { anyOwnCopy: true });
    return projectId;
}

/**
 * Generate a presigned URL for direct browser-to-S3 upload.
 * Pure optimization: zero server throughput, browser uploads directly.
 *
 * @param key - S3 object key (path within bucket)
 * @param contentType - MIME type of the file
 * @returns Presigned URL valid for 1 hour
 */
export async function getUploadPresignedUrl(
    key: string,
    contentType: string,
    sizeBytes: number,
    options?: { sessionId?: string | null }
): Promise<{ url: string; token: string; uploadIntentId: string; storageKey: string } | { error: string; code?: string }> {
    const startedAt = Date.now();
    try {
        const authClient = await createClient();
        const { data: { user } } = await authClient.auth.getUser();
        if (!user) {
            return { error: 'Sign in to continue' };
        }

        const projectId = await assertUploadAccessForKey(key, user.id);
        const normalizedMimeType = normalizeAndValidateMimeType(contentType);
        const normalizedSize = normalizeAndValidateFileSize(sizeBytes, WORKSPACE_UPLOAD_MAX_FILE_BYTES);
        const storageKey = allocateWorkspaceObjectKey(projectId, key, normalizedMimeType);

        const supabase = await createAdminClient();

        const intent = await createUploadIntent({
            userId: user.id,
            projectId,
            bucket: 'project-files',
            storageKey,
            scope: 'project_file',
            kind: 'file',
            expectedMimeType: normalizedMimeType,
            expectedSize: normalizedSize,
            metadata: { sessionId: options?.sessionId ?? null, requestedKey: key },
        });

        const { data, error } = await supabase.storage
            .from('project-files')
            .createSignedUploadUrl(storageKey, { upsert: false });

        if (error) {
            console.error('Failed to create signed URL:', error);
            return { error: 'Couldn’t generate upload URL' };
        }

        logger.metric('upload.presign.single', {
            userId: user.id,
            projectId,
            sessionId: options?.sessionId || null,
            contentType: normalizedMimeType,
            sizeBytes: normalizedSize,
            success: 1,
            durationMs: Date.now() - startedAt,
        });

        return {
            url: data.signedUrl,
            token: data.token,
            uploadIntentId: intent.id,
            storageKey,
        };
    } catch (e) {
        if (e instanceof Error && e.message === UPLOAD_ERROR_CODES.KEY_FORMAT_INVALID) {
            return { error: 'Invalid upload key format', code: UPLOAD_ERROR_CODES.KEY_FORMAT_INVALID };
        }
        if (e instanceof Error && isUploadValidationError(e.message)) {
            return { error: e.message, code: UPLOAD_ERROR_CODES.UPLOAD_VALIDATION_FAILED };
        }
        console.error('Presigned URL error:', e);
        return { error: 'Internal server error' };
    }
}

/**
 * Batch generate presigned URLs for multiple files.
 * More efficient for folder uploads.
 */
export async function getBatchUploadUrls(
    keys: { key: string; contentType: string; sizeBytes: number }[],
    options?: { sessionId?: string | null }
): Promise<{
    urls: Record<string, string>;
    uploadTokens: Record<string, string>;
    uploadIntentIds: Record<string, string>;
    storageKeys: Record<string, string>;
} | { error: string; code?: string }> {
    const startedAt = Date.now();
    try {
        const authClient = await createClient();
        const { data: { user } } = await authClient.auth.getUser();
        if (!user) {
            return { error: 'Sign in to continue' };
        }

        if (!keys || keys.length === 0) {
            return { urls: {}, uploadTokens: {}, uploadIntentIds: {}, storageKeys: {} };
        }
        if (keys.length > MAX_BATCH_UPLOAD_KEYS) {
            return { error: `Too many files in one request. Max ${MAX_BATCH_UPLOAD_KEYS}.` };
        }

        const normalizedItems = keys.map((item) => ({
            key: item.key,
            contentType: normalizeAndValidateMimeType(item.contentType),
            sizeBytes: normalizeAndValidateFileSize(item.sizeBytes, WORKSPACE_UPLOAD_MAX_FILE_BYTES),
        }));
        if (new Set(normalizedItems.map((item) => item.key)).size !== normalizedItems.length) {
            return { error: 'Duplicate upload request identities are not allowed' };
        }

        const firstParsed = parseWorkspaceFileKey(normalizedItems[0]?.key || '');
        if (!firstParsed || !isCanonicalWorkspaceFileKey(normalizedItems[0]?.key || '')) {
            return { error: 'Invalid upload key format', code: UPLOAD_ERROR_CODES.KEY_FORMAT_INVALID };
        }
        const firstProjectId = firstParsed.projectId;

        // Ensure all keys belong to the same project
        for (const item of normalizedItems) {
            const parsed = parseWorkspaceFileKey(item.key);
            if (!parsed || !isCanonicalWorkspaceFileKey(item.key) || parsed.projectId !== firstProjectId) {
                return { error: 'Invalid upload key format', code: UPLOAD_ERROR_CODES.KEY_FORMAT_INVALID };
            }
        }

        await assertWorkspaceUploadAccess(firstProjectId, user.id, { anyOwnCopy: true });

        const supabase = await createAdminClient();
        const urls: Record<string, string> = {};
        const uploadTokens: Record<string, string> = {};
        const uploadIntentIds: Record<string, string> = {};
        const storageKeys: Record<string, string> = {};
        const allocatedItems = normalizedItems.map((item) => ({
            ...item,
            storageKey: allocateWorkspaceObjectKey(firstProjectId, item.key, item.contentType),
        }));

        const intents = await createUploadIntents(allocatedItems.map(({ key, storageKey, contentType, sizeBytes }) => ({
            userId: user.id,
            projectId: firstProjectId,
            bucket: 'project-files',
            storageKey,
            scope: 'project_file',
            kind: 'file',
            expectedMimeType: contentType,
            expectedSize: sizeBytes,
            metadata: { sessionId: options?.sessionId ?? null, requestedKey: key },
        })));

        const intentIdsByStorageKey = new Map(intents.map(intent => [intent.storageKey, intent.id]));

        const CONCURRENCY_LIMIT = 10;
        const results: Array<{ key: string; storageKey: string; url?: string; token?: string; error: unknown; intentId: string }> = [];
        for (let i = 0; i < allocatedItems.length; i += CONCURRENCY_LIMIT) {
            const chunk = allocatedItems.slice(i, i + CONCURRENCY_LIMIT);
            const chunkResults = await Promise.all(
                chunk.map(async ({ key, storageKey }) => {
                    const intentId = intentIdsByStorageKey.get(storageKey) || '';
                    const { data, error } = await supabase.storage
                        .from('project-files')
                        .createSignedUploadUrl(storageKey, { upsert: false });
                    return { key, storageKey, url: data?.signedUrl, token: data?.token, error, intentId };
                })
            );
            results.push(...chunkResults);
        }

        for (const result of results) {
            if (result.url) {
                urls[result.key] = result.url;
                if (result.token) uploadTokens[result.key] = result.token;
                uploadIntentIds[result.key] = result.intentId;
                storageKeys[result.key] = result.storageKey;
            }
        }

        logger.metric('upload.presign.batch', {
            userId: user.id,
            projectId: firstProjectId,
            sessionId: options?.sessionId || null,
            requestedCount: normalizedItems.length,
            generatedCount: Object.keys(urls).length,
            durationMs: Date.now() - startedAt,
        });

        return { urls, uploadTokens, uploadIntentIds, storageKeys };
    } catch (e) {
        if (e instanceof Error && isUploadValidationError(e.message)) {
            return { error: e.message, code: UPLOAD_ERROR_CODES.UPLOAD_VALIDATION_FAILED };
        }
        console.error('Batch presigned URL error:', e);
        return { error: 'Internal server error' };
    }
}

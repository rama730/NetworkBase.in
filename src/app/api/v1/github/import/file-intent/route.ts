import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { importJobs, importJobFiles } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { jsonError, jsonSuccess } from '@/app/api/v1/_envelope';
import { validateCsrf } from '@/lib/security/csrf';
import { assertProjectWriteAccess } from '@/lib/files/internal-helpers';
import { enforceRouteLimit, requireAuthenticatedUser } from '@/app/api/v1/_shared';
import { z } from 'zod';
import { buildProjectFileKey } from '@/lib/storage/project-file-key';
import { createUploadIntent } from '@/lib/upload/upload-intents';
import {
    normalizeAndValidateFileSize,
    normalizeAndValidateMimeType,
    normalizeAndValidateUploadRelativePath,
    PROJECT_UPLOAD_MAX_FILE_BYTES,
} from '@/lib/upload/security';

const fileIntentSchema = z.object({
    jobId: z.string().uuid(),
    path: z.string().min(1),
    size: z.number().int().nonnegative(),
    mimeType: z.string().min(1),
    checksum: z.string().length(64), // SHA-256 hex
});

/**
 * POST /api/v1/github/import/file-intent
 * Pre-registers file upload intent for an active import job, returning a signed upload URL.
 */
export async function POST(request: NextRequest) {
    try {
        const csrfError = validateCsrf(request);
        if (csrfError) return csrfError;

        const limitResponse = await enforceRouteLimit(request, 'api:v1:github:import:file-intent', 200, 60);
        if (limitResponse) return limitResponse;

        const auth = await requireAuthenticatedUser();
        if (auth.response || !auth.user) return auth.response ?? jsonError('Unauthorized', 401, 'UNAUTHORIZED');
        const user = auth.user;

        let body;
        try {
            body = await request.json();
        } catch {
            return jsonError('Invalid JSON', 400, 'BAD_REQUEST');
        }

        const parsed = fileIntentSchema.safeParse(body);
        if (!parsed.success) {
            return jsonError('Invalid request body', 400, 'BAD_REQUEST');
        }

        const { jobId, path, size, mimeType, checksum } = parsed.data;
        const normalizedPath = normalizeAndValidateUploadRelativePath(path);
        const normalizedSize = normalizeAndValidateFileSize(size, PROJECT_UPLOAD_MAX_FILE_BYTES);
        const normalizedMimeType = normalizeAndValidateMimeType(mimeType);

        // Fetch job and file state in parallel
        const [job, jobFile] = await Promise.all([
            db.query.importJobs.findFirst({
                where: and(eq(importJobs.id, jobId), eq(importJobs.status, 'importing')),
            }),
            db.query.importJobFiles.findFirst({
                where: and(
                    eq(importJobFiles.jobId, jobId),
                    eq(importJobFiles.path, normalizedPath)
                ),
            }),
        ]);

        if (!job) {
            return jsonError('Import job not active or not found', 404, 'NOT_FOUND');
        }

        await assertProjectWriteAccess(job.projectId, user.id);

        if (!jobFile) {
            return jsonError('File path not registered in job manifest', 404, 'NOT_FOUND');
        }
        if (jobFile.size !== normalizedSize || jobFile.checksum.toLowerCase() !== checksum.toLowerCase()) {
            return jsonError('File does not match the registered manifest', 400, 'BAD_REQUEST');
        }

        const storageKey = buildProjectFileKey(job.projectId, `imports/${jobId}/${jobFile.id}-${checksum.toLowerCase()}`);
        const bucket = 'project-files';

        const intent = await createUploadIntent({
            userId: user.id,
            projectId: job.projectId,
            bucket,
            storageKey,
            scope: 'project_file',
            kind: 'file',
            expectedMimeType: normalizedMimeType,
            expectedSize: normalizedSize,
            idempotencyKey: `github-import:${jobId}:${jobFile.id}:${checksum.toLowerCase()}`,
            metadata: {
                jobId,
                path: normalizedPath,
                checksum: checksum.toLowerCase(),
                jobFileId: jobFile.id,
            },
        });

        const adminClient = await createAdminClient();
        const { data: uploadSession, error: storageError } = await adminClient.storage
            .from(bucket)
            .createSignedUploadUrl(storageKey, { upsert: false });

        if (storageError || !uploadSession) {
            console.error('[github-import-file-intent] signed URL generation failed:', storageError);
            return jsonError('Failed to generate signed upload URL', 500, 'INTERNAL_ERROR');
        }

        await db.update(importJobFiles)
            .set({ status: 'uploading', uploadIntentId: intent.id, s3Key: storageKey, errorMessage: null })
            .where(eq(importJobFiles.id, jobFile.id));

        return jsonSuccess({
            uploadIntentId: intent.id,
            signedUrl: uploadSession.signedUrl,
            storagePath: storageKey,
        });
    } catch (error) {
        console.error('[github-import-file-intent] error:', error);
        return jsonError('Internal error', 500, 'INTERNAL_ERROR');
    }
}

import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { importJobs } from '@/lib/db/schema';
import { jsonError, jsonSuccess } from '@/app/api/v1/_envelope';
import { validateCsrf } from '@/lib/security/csrf';
import { assertProjectWriteAccess } from '@/lib/files/internal-helpers';
import { enforceRouteLimit, requireAuthenticatedUser } from '@/app/api/v1/_shared';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { createUploadIntent } from '@/lib/upload/upload-intents';

const initSchema = z.object({
    projectId: z.string().uuid(),
    manifestHash: z.string().regex(/^[a-f0-9]{64}$/i),
    manifestSize: z.number().int().positive().max(10 * 1024 * 1024),
    totalFiles: z.number().int().nonnegative().max(20_000),
});

/**
 * POST /api/v1/github/import/init
 * Initializes repository ingestion, returning a signed upload URL for the manifest.
 */
export async function POST(request: NextRequest) {
    try {
        const csrfError = validateCsrf(request);
        if (csrfError) return csrfError;

        const limitResponse = await enforceRouteLimit(request, 'api:v1:github:import:init', 100, 60);
        if (limitResponse) return limitResponse;

        const auth = await requireAuthenticatedUser();
        if (auth.response || !auth.user) return auth.response ?? jsonError('Sign in to continue', 401, 'UNAUTHORIZED');
        const user = auth.user;

        let body;
        try {
            body = await request.json();
        } catch {
            return jsonError('Invalid JSON', 400, 'BAD_REQUEST');
        }

        const parsed = initSchema.safeParse(body);
        if (!parsed.success) {
            return jsonError('This request isn’t valid', 400, 'BAD_REQUEST');
        }

        const { projectId, manifestHash, manifestSize, totalFiles } = parsed.data;
        await assertProjectWriteAccess(projectId, user.id);

        const jobId = randomUUID();
        const manifestS3Key = `imports/${jobId}/manifest.json`;
        const bucket = 'project-files';

        const intent = await createUploadIntent({
            userId: user.id,
            projectId,
            bucket,
            storageKey: manifestS3Key,
            scope: 'import_manifest',
            kind: 'manifest',
            expectedMimeType: 'application/json',
            expectedSize: manifestSize,
            idempotencyKey: `import-manifest:${jobId}`,
            metadata: { jobId, totalFiles },
        });
        if (!intent.assetId) {
            return jsonError('Couldn’t reserve manifest asset', 503, 'UNAVAILABLE');
        }

        const adminClient = await createAdminClient();
        const { data: uploadSession, error: storageError } = await adminClient.storage
            .from(bucket)
            .createSignedUploadUrl(manifestS3Key, { upsert: false });

        if (storageError || !uploadSession) {
            console.error('[github-import-init] Storage signed url error:', storageError);
            return jsonError('Couldn’t generate signed manifest URL', 500, 'INTERNAL_ERROR');
        }

        // Insert pending import job
        const [job] = await db
            .insert(importJobs)
            .values({
                id: jobId,
                projectId,
                status: 'pending',
                totalFiles,
                processedFiles: 0,
                manifestS3Key,
                manifestAssetId: intent.assetId,
                manifestUploadIntentId: intent.id,
                manifestHash,
                createdAt: new Date(),
                updatedAt: new Date(),
            })
            .returning();

        if (!job) {
            return jsonError('Couldn’t initialize import job', 500, 'INTERNAL_ERROR');
        }

        return jsonSuccess({
            jobId: job.id,
            signedUrl: uploadSession.signedUrl,
            uploadToken: uploadSession.token,
            uploadIntentId: intent.id,
            manifestS3Key,
        });
    } catch (error) {
        console.error('[github-import-init] error:', error);
        return jsonError('Internal error', 500, 'INTERNAL_ERROR');
    }
}

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import {
    fileVersions,
    importJobs,
    importJobFiles,
    projectNodes,
    storageAssets,
    uploadIntents,
} from '@/lib/db/schema';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { jsonError, jsonSuccess } from '@/app/api/v1/_envelope';
import { validateCsrf } from '@/lib/security/csrf';
import { assertWorkspaceWriteAccess } from '@/lib/files/internal-helpers';
import { enforceRouteLimit, requireAuthenticatedUser } from '@/app/api/v1/_shared';
import { z } from 'zod';

const abortSchema = z.object({
    jobId: z.string().uuid(),
});

/**
 * POST /api/v1/github/import/abort
 * Aborts an active import job, marking it failed, and cleaning up any uploaded file blobs.
 */
export async function POST(request: NextRequest) {
    try {
        const csrfError = validateCsrf(request);
        if (csrfError) return csrfError;

        const limitResponse = await enforceRouteLimit(request, 'api:v1:github:import:abort', 100, 60);
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

        const parsed = abortSchema.safeParse(body);
        if (!parsed.success) {
            return jsonError('This request isn’t valid', 400, 'BAD_REQUEST');
        }

        const { jobId } = parsed.data;

        // 1. Fetch import job
        const job = await db.query.importJobs.findFirst({
            where: eq(importJobs.id, jobId),
        });

        if (!job) {
            return jsonError('Import job not found', 404, 'NOT_FOUND');
        }

        if (job.status === 'completed' || job.status === 'failed') {
            return jsonError(`Cannot abort import job that is already in '${job.status}' state`, 400, 'BAD_REQUEST');
        }

        await assertWorkspaceWriteAccess(job.projectId, user.id);

        // 2. Resolve lifecycle identities. Raw object keys are never deletion authority.
        const filesWithKeys = await db.query.importJobFiles.findMany({
            where: eq(importJobFiles.jobId, jobId),
            columns: {
                id: true,
                uploadIntentId: true,
            },
        });

        const intentIds: string[] = [];

        for (const f of filesWithKeys) {
            if (f.uploadIntentId) {
                intentIds.push(f.uploadIntentId);
            }
        }

        // 3. Detach unpublished objects and let the fenced lifecycle worker
        // remove bytes after credential grace. Published assets stay live.
        await db.transaction(async (tx) => {
            await tx.execute(sql`
                SELECT id FROM public.import_jobs
                WHERE id = ${jobId}
                FOR UPDATE
            `);
            const [lockedJob] = await tx.select({
                status: importJobs.status,
                manifestAssetId: importJobs.manifestAssetId,
            }).from(importJobs).where(eq(importJobs.id, jobId)).limit(1);
            if (!lockedJob || lockedJob.status === 'completed' || lockedJob.status === 'failed') {
                throw new Error('Import job became terminal before abort committed');
            }
            const intentAssets = intentIds.length > 0
                ? await tx.select({ assetId: uploadIntents.assetId })
                    .from(uploadIntents)
                    .where(inArray(uploadIntents.id, intentIds))
                : [];
            const assetIds = Array.from(new Set([
                ...(lockedJob.manifestAssetId ? [lockedJob.manifestAssetId] : []),
                ...intentAssets.flatMap((row) => row.assetId ? [row.assetId] : []),
            ]));

            // Mark job as failed
            await tx
                .update(importJobs)
                .set({
                    status: 'failed',
                    errorMessage: 'Import aborted by user',
                    manifestAssetId: null,
                    manifestUploadIntentId: null,
                    manifestS3Key: null,
                    updatedAt: new Date(),
                })
                .where(eq(importJobs.id, jobId));

            // Mark job files as failed
            await tx
                .update(importJobFiles)
                .set({
                    status: 'failed',
                    errorMessage: 'Import aborted',
                })
                .where(eq(importJobFiles.jobId, jobId));

            // Mark upload intents as failed
            if (intentIds.length > 0) {
                await tx
                    .update(uploadIntents)
                    .set({
                        status: 'failed',
                        failureReason: 'Import aborted by user',
                        updatedAt: new Date(),
                    })
                    .where(inArray(uploadIntents.id, intentIds));
            }

            if (assetIds.length > 0) {
                await tx.update(storageAssets)
                    .set({
                        state: 'delete_pending',
                        deleteAfter: sql`GREATEST(${storageAssets.expiresAt} + interval '5 minutes', now())`,
                        backupState: 'not_required',
                        lastErrorCode: 'IMPORT_ABORTED',
                        updatedAt: new Date(),
                    })
                    .where(and(
                        inArray(storageAssets.id, assetIds),
                        inArray(storageAssets.state, ['pending', 'verified']),
                        sql`NOT EXISTS (
                            SELECT 1 FROM ${projectNodes}
                            WHERE ${projectNodes.assetId} = ${storageAssets.id}
                        )`,
                        sql`NOT EXISTS (
                            SELECT 1 FROM ${fileVersions}
                            WHERE ${fileVersions.assetId} = ${storageAssets.id}
                        )`,
                    ));
            }
        });

        return jsonSuccess({
            message: 'Import job aborted and unpublished resources scheduled for cleanup',
            jobId,
        });
    } catch (error) {
        console.error('[github-import-abort] error:', error);
        return jsonError('Internal error', 500, 'INTERNAL_ERROR');
    }
}

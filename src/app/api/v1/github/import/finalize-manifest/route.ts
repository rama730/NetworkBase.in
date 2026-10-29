import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { importJobs, storageAssets } from '@/lib/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { jsonError, jsonSuccess } from '@/app/api/v1/_envelope';
import { validateCsrf } from '@/lib/security/csrf';
import { assertWorkspaceWriteAccess } from '@/lib/files/internal-helpers';
import { enforceRouteLimit, requireAuthenticatedUser } from '@/app/api/v1/_shared';
import { z } from 'zod';
import { finalizeUploadIntent } from '@/lib/upload/upload-intents';
import { readBoundedStorageText } from '@/lib/storage/bounded-object-read';
import {
    normalizeAndValidateFileSize,
    normalizeAndValidateUploadRelativePath,
    WORKSPACE_UPLOAD_MAX_FILE_BYTES,
} from '@/lib/upload/security';

const finalizeSchema = z.object({
    jobId: z.string().uuid(),
    manifestHash: z.string().length(64),
});

const manifestFileSchema = z.object({
    path: z.string().min(1).max(1024),
    size: z.number().int().nonnegative().max(WORKSPACE_UPLOAD_MAX_FILE_BYTES),
    checksum: z.string().regex(/^[a-f0-9]{64}$/i),
}).strict();
const manifestSchema = z.object({
    files: z.array(manifestFileSchema).max(20_000),
}).strict();

/**
 * POST /api/v1/github/import/finalize-manifest
 * Verifies manifest upload, downloads it from S3, validates the hash, and inserts import_job_files rows.
 */
export async function POST(request: NextRequest) {
    try {
        const csrfError = validateCsrf(request);
        if (csrfError) return csrfError;

        const limitResponse = await enforceRouteLimit(request, 'api:v1:github:import:finalize-manifest', 100, 60);
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

        const parsed = finalizeSchema.safeParse(body);
        if (!parsed.success) {
            return jsonError('This request isn’t valid', 400, 'BAD_REQUEST');
        }

        const { jobId, manifestHash } = parsed.data;

        // 1. Fetch import job
        const job = await db.query.importJobs.findFirst({
            where: eq(importJobs.id, jobId),
        });

        if (!job) {
            return jsonError('Import job not found', 404, 'NOT_FOUND');
        }

        await assertWorkspaceWriteAccess(job.projectId, user.id);

        if (job.status === 'importing' || job.status === 'completed') {
            return jsonSuccess({
                jobId,
                status: job.status,
                filesCount: job.totalFiles,
            });
        }
        if (job.status !== 'pending') {
            return jsonError(`Import job is already ${job.status}`, 409, 'CONFLICT');
        }

        if (
            job.manifestHash?.toLowerCase() !== manifestHash.toLowerCase()
            || !job.manifestS3Key
            || !job.manifestAssetId
            || !job.manifestUploadIntentId
        ) {
            return jsonError('Manifest hash mismatch or key is missing', 400, 'BAD_REQUEST');
        }
        const manifestAssetId = job.manifestAssetId;
        const manifestUploadIntentId = job.manifestUploadIntentId;

        const finalizedIntent = await finalizeUploadIntent({
            intentId: manifestUploadIntentId,
            bucket: 'project-files',
            storageKey: job.manifestS3Key,
            userId: user.id,
            projectId: job.projectId,
            expectedScope: 'import_manifest',
            expectedKind: 'manifest',
        });
        if (finalizedIntent.assetId !== manifestAssetId) {
            return jsonError('Manifest asset binding is invalid', 409, 'CONFLICT');
        }
        const [asset] = await db.select({
            state: storageAssets.state,
            contentHash: storageAssets.contentHash,
            size: storageAssets.verifiedSize,
        }).from(storageAssets)
            .where(eq(storageAssets.id, manifestAssetId))
            .limit(1);
        if (
            asset?.state !== 'verified'
            || asset.contentHash?.toLowerCase() !== manifestHash.toLowerCase()
            || asset.size == null
            || asset.size > 10 * 1024 * 1024
        ) {
            return jsonError('Manifest failed full-content verification', 400, 'BAD_REQUEST');
        }

        // 2. Read through a deadline-bound stream. The byte ceiling remains
        // authoritative even if the provider ignores metadata or Range.
        let manifestText: string;
        try {
            manifestText = await readBoundedStorageText({
                bucket: 'project-files',
                storageKey: job.manifestS3Key,
                maxBytes: 10 * 1024 * 1024,
                timeoutMs: 30_000,
            });
        } catch {
            return jsonError('Couldn’t read manifest from storage', 404, 'NOT_FOUND');
        }

        let rawManifest: unknown;
        try {
            rawManifest = JSON.parse(manifestText);
        } catch {
            return jsonError('Manifest contains invalid JSON', 400, 'BAD_REQUEST');
        }
        const validatedManifest = manifestSchema.safeParse(rawManifest);
        if (!validatedManifest.success) {
            return jsonError('Manifest structure is invalid', 400, 'BAD_REQUEST');
        }
        const manifestFiles = validatedManifest.data.files.map((file) => ({
            path: normalizeAndValidateUploadRelativePath(file.path),
            size: normalizeAndValidateFileSize(file.size, WORKSPACE_UPLOAD_MAX_FILE_BYTES),
            checksum: file.checksum.toLowerCase(),
        }));
        if (manifestFiles.length !== job.totalFiles) {
            return jsonError('Manifest file count does not match the import reservation', 400, 'BAD_REQUEST');
        }
        const uniquePaths = new Set(manifestFiles.map((file) => file.path));
        if (uniquePaths.size !== manifestFiles.length) {
            return jsonError('Manifest contains duplicate paths', 400, 'BAD_REQUEST');
        }
        const totalBytes = manifestFiles.reduce((sum, file) => sum + file.size, 0);
        if (!Number.isSafeInteger(totalBytes) || totalBytes > 1024 * 1024 * 1024) {
            return jsonError('Manifest exceeds the 1 GiB import limit', 400, 'BAD_REQUEST');
        }

        // 4. Batch insert files into import_job_files in a single transaction
        await db.transaction(async (tx) => {
            await tx.execute(sql`
                SELECT id FROM public.import_jobs
                WHERE id = ${jobId}
                FOR UPDATE
            `);
            // Update job status to 'importing'
            const updated = await tx
                .update(importJobs)
                .set({
                    status: 'importing',
                    updatedAt: new Date(),
                })
                .where(and(
                    eq(importJobs.id, jobId),
                    eq(importJobs.status, 'pending'),
                    eq(importJobs.manifestAssetId, manifestAssetId),
                ))
                .returning({ id: importJobs.id });
            if (updated.length === 0) return;

            await tx.update(storageAssets)
                .set({ backupState: 'pending', updatedAt: new Date() })
                .where(and(
                    eq(storageAssets.id, manifestAssetId),
                    eq(storageAssets.state, 'verified'),
                ));

            if (manifestFiles.length > 0) {
                // High-performance single multi-row ingestion via jsonb_to_recordset
                const jsonPayload = JSON.stringify(manifestFiles.map((file) => ({
                    path: file.path,
                    size: file.size,
                    checksum: file.checksum,
                })));
                await tx.execute(sql`
                    INSERT INTO import_job_files (job_id, path, size, checksum, status, created_at)
                    SELECT 
                        ${jobId}::uuid,
                        r.path,
                        r.size,
                        r.checksum,
                        'pending',
                        now()
                    FROM jsonb_to_recordset(${jsonPayload}::jsonb) AS r(path text, size bigint, checksum text)
                `);
            }
        });

        return jsonSuccess({
            jobId,
            status: 'importing',
            filesCount: manifestFiles.length,
        });
    } catch (error) {
        console.error('[github-import-finalize-manifest] error:', error);
        return jsonError('Internal error', 500, 'INTERNAL_ERROR');
    }
}

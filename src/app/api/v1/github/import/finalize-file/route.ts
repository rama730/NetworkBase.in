import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { importJobs, importJobFiles, uploadIntents, projectNodes, fileVersions, storageAssets } from '@/lib/db/schema';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { jsonError, jsonSuccess } from '@/app/api/v1/_envelope';
import { validateCsrf } from '@/lib/security/csrf';
import { assertProjectWriteAccess, recordNodeEvent } from '@/lib/files/internal-helpers';
import { enforceRouteLimit, requireAuthenticatedUser } from '@/app/api/v1/_shared';
import { createDirectoryStructureFromPaths } from '@/lib/import/utils';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import path from 'path';
import { finalizeUploadIntent } from '@/lib/upload/upload-intents';

const finalizeFileSchema = z.object({
    jobId: z.string().uuid(),
    path: z.string().min(1),
    uploadIntentId: z.string().uuid(),
});

/**
 * POST /api/v1/github/import/finalize-file
 * Finalizes file upload for ingestion job by checking storage info, updating the DB node/version,
 * and marking import_job_files status as completed.
 */
export async function POST(request: NextRequest) {
    try {
        const csrfError = validateCsrf(request);
        if (csrfError) return csrfError;

        const limitResponse = await enforceRouteLimit(request, 'api:v1:github:import:finalize-file', 300, 60);
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

        const parsed = finalizeFileSchema.safeParse(body);
        if (!parsed.success) {
            return jsonError('This request isn’t valid', 400, 'BAD_REQUEST');
        }

        const { jobId, path: filePath, uploadIntentId } = parsed.data;

        // Fetch the operation binding and manifest entry before reading bytes.
        const [job, intent, jobFile] = await Promise.all([
            db.query.importJobs.findFirst({
                where: and(eq(importJobs.id, jobId), eq(importJobs.status, 'importing')),
            }),
            db.query.uploadIntents.findFirst({
                where: eq(uploadIntents.id, uploadIntentId),
            }),
            db.query.importJobFiles.findFirst({
                where: and(
                    eq(importJobFiles.jobId, jobId),
                    eq(importJobFiles.path, filePath)
                ),
            }),
        ]);

        if (!job) {
            return jsonError('Active import job not found', 404, 'NOT_FOUND');
        }

        await assertProjectWriteAccess(job.projectId, user.id);

        if (!intent) {
            return jsonError('Pending upload intent not found', 404, 'NOT_FOUND');
        }
        if (intent.userId !== user.id || intent.projectId !== job.projectId) {
            return jsonError('You don’t have access to this', 403, 'FORBIDDEN');
        }

        if (!jobFile) {
            return jsonError('File path not registered in job manifest', 404, 'NOT_FOUND');
        }
        if (jobFile.uploadIntentId !== uploadIntentId || jobFile.s3Key !== intent.storageKey) {
            return jsonError('Upload intent does not match the manifest entry', 400, 'BAD_REQUEST');
        }
        if (jobFile.status === 'completed') {
            const existing = await db.query.projectNodes.findFirst({
                where: and(
                    eq(projectNodes.projectId, job.projectId),
                    eq(projectNodes.path, `/${filePath.replaceAll('\\', '/').replace(/^\/+/, '')}`),
                    isNull(projectNodes.deletedAt),
                ),
                columns: { id: true, currentVersion: true },
            });
            return jsonSuccess({
                message: 'File already finalized',
                nodeId: existing?.id ?? null,
                version: existing?.currentVersion ?? null,
                isComplete: job.status === 'completed',
            });
        }

        const finalizedIntent = await finalizeUploadIntent({
            intentId: uploadIntentId,
            bucket: 'project-files',
            storageKey: intent.storageKey,
            userId: user.id,
            projectId: job.projectId,
            expectedScope: 'project_file',
            expectedKind: 'file',
        }, intent);
        if (!finalizedIntent.assetId || finalizedIntent.finalizedSize === null || !finalizedIntent.finalizedMimeType) {
            return jsonError('Verified upload asset is unavailable', 409, 'CONFLICT');
        }
        const [verifiedAsset] = await db.select({
            id: storageAssets.id,
            contentHash: storageAssets.contentHash,
        }).from(storageAssets).where(and(
            eq(storageAssets.id, finalizedIntent.assetId),
            eq(storageAssets.state, 'verified'),
            eq(storageAssets.ownerUserId, user.id),
            eq(storageAssets.projectId, job.projectId),
        )).limit(1);
        if (!verifiedAsset?.contentHash || verifiedAsset.contentHash !== jobFile.checksum.toLowerCase()) {
            await db.transaction(async (tx) => {
                await tx.update(uploadIntents).set({
                    status: 'failed',
                    failureReason: 'Uploaded content does not match the import manifest checksum',
                    updatedAt: new Date(),
                }).where(eq(uploadIntents.id, uploadIntentId));
                if (verifiedAsset) {
                    await tx.update(storageAssets).set({
                        state: 'delete_pending',
                        deleteAfter: sql`GREATEST(${storageAssets.expiresAt} + interval '5 minutes', now())`,
                        backupState: 'not_required',
                        lastErrorCode: 'IMPORT_CHECKSUM_MISMATCH',
                        updatedAt: new Date(),
                    }).where(and(
                        eq(storageAssets.id, verifiedAsset.id),
                        eq(storageAssets.state, 'verified'),
                    ));
                }
            });
            return jsonError('Uploaded content does not match the manifest checksum', 400, 'BAD_REQUEST');
        }
        const finalizedSize = finalizedIntent.finalizedSize;
        const finalizedMimeType = finalizedIntent.finalizedMimeType;
        const verifiedAssetId = verifiedAsset.id;
        const verifiedContentHash = verifiedAsset.contentHash;

        // 5. Ensure folder structure exists
        const rel = filePath.replaceAll('\\', '/').replace(/^\/+/, '');
        const dir = path.posix.dirname(rel);
        const fileName = path.posix.basename(rel);

        let parentId: string | null = null;
        if (dir && dir !== '.') {
            const parts = dir.split('/');
            const dirPaths = new Set<string>();
            let current = '';
            for (const part of parts) {
                current = current ? `${current}/${part}` : part;
                dirPaths.add(current);
            }
            const folderMap = await createDirectoryStructureFromPaths(job.projectId, dirPaths, user.id);
            parentId = folderMap.get(dir) || null;
        }

        const nodePath = `/${rel}`;

        // Commit the asset reference, node version, job state and backup request together.
        const result = await db.transaction(async (tx) => {
            const [lockedJobFile] = await tx.select({
                status: importJobFiles.status,
                uploadIntentId: importJobFiles.uploadIntentId,
            }).from(importJobFiles)
                .where(eq(importJobFiles.id, jobFile.id))
                .limit(1)
                .for('update');
            if (!lockedJobFile || lockedJobFile.uploadIntentId !== uploadIntentId) {
                throw new Error('Import manifest binding changed before publication');
            }
            if (lockedJobFile.status === 'completed') {
                const [publishedNode] = await tx.select({
                    id: projectNodes.id,
                    currentVersion: projectNodes.currentVersion,
                }).from(projectNodes).where(and(
                    eq(projectNodes.projectId, job.projectId),
                    eq(projectNodes.path, nodePath),
                    isNull(projectNodes.deletedAt),
                )).limit(1);
                if (!publishedNode) throw new Error('Completed import file has no published node');
                const [currentJob] = await tx.select({ status: importJobs.status })
                    .from(importJobs).where(eq(importJobs.id, jobId)).limit(1);
                return {
                    nodeId: publishedNode.id,
                    nextVersion: publishedNode.currentVersion,
                    isComplete: currentJob?.status === 'completed',
                };
            }
            const [publishableAsset] = await tx.update(storageAssets).set({
                backupState: sql`CASE WHEN ${storageAssets.backupState} = 'verified' THEN 'verified' ELSE 'pending' END`,
                updatedAt: new Date(),
            }).where(and(
                eq(storageAssets.id, verifiedAssetId),
                eq(storageAssets.state, 'verified'),
                eq(storageAssets.ownerUserId, user.id),
                eq(storageAssets.projectId, job.projectId),
            )).returning({ id: storageAssets.id });
            if (!publishableAsset) throw new Error('Import asset is no longer publishable');

            // Check if node already exists (matching path in project)
            const [existingNode] = await tx.select().from(projectNodes).where(and(
                    eq(projectNodes.projectId, job.projectId),
                    eq(projectNodes.path, nodePath),
                    isNull(projectNodes.deletedAt)
                )).limit(1).for('update');

            const nodeId = existingNode?.id || randomUUID();
            const nextVersion = existingNode ? existingNode.currentVersion + 1 : 1;

            if (existingNode) {
                await tx
                    .update(projectNodes)
                    .set({
                        currentVersion: nextVersion,
                        s3Key: intent.storageKey,
                        assetId: verifiedAssetId,
                        size: finalizedSize,
                        mimeType: finalizedMimeType,
                        gitHash: jobFile.checksum,
                        syncStatus: 'merged',
                        updatedAt: new Date(),
                    })
                    .where(eq(projectNodes.id, existingNode.id));
            } else {
                await tx
                    .insert(projectNodes)
                    .values({
                        id: nodeId,
                        projectId: job.projectId,
                        parentId,
                        path: nodePath,
                        type: 'file',
                        name: fileName,
                        s3Key: intent.storageKey,
                        assetId: verifiedAssetId,
                        size: finalizedSize,
                        mimeType: finalizedMimeType,
                        currentVersion: 1,
                        gitHash: jobFile.checksum,
                        syncStatus: 'merged',
                        createdBy: user.id,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    });
            }

            // Create file version record
            await tx.insert(fileVersions).values({
                nodeId,
                version: nextVersion,
                s3Key: intent.storageKey,
                assetId: verifiedAssetId,
                size: finalizedSize,
                mimeType: finalizedMimeType,
                contentHash: verifiedContentHash,
                uploadedBy: user.id,
                uploadedAt: new Date(),
                attribution: { source: 'github_import', jobId },
            });

            // Mark import job file as completed
            await tx
                .update(importJobFiles)
                .set({
                    status: 'completed',
                    finalizedAt: new Date(),
                })
                .where(eq(importJobFiles.id, jobFile.id));

            const [updatedJob] = await tx
                .update(importJobs)
                .set({
                    processedFiles: sql`LEAST(${importJobs.processedFiles} + 1, ${importJobs.totalFiles})`,
                    status: sql`CASE WHEN ${importJobs.processedFiles} + 1 >= ${importJobs.totalFiles} THEN 'completed' ELSE ${importJobs.status} END`,
                    updatedAt: new Date(),
                })
                .where(and(eq(importJobs.id, jobId), eq(importJobs.status, 'importing')))
                .returning({ status: importJobs.status });
            if (!updatedJob) throw new Error('Import job became inactive before publication');

            // Record node event
            const eventType = existingNode ? 'file_write' : 'file_create';
            await recordNodeEvent(job.projectId, user.id, nodeId, eventType, { version: nextVersion }, tx);

            return { nodeId, nextVersion, isComplete: updatedJob.status === 'completed' };
        });

        return jsonSuccess({
            message: 'File import finalized',
            nodeId: result.nodeId,
            version: result.nextVersion,
            isComplete: result.isComplete,
        });
    } catch (error) {
        console.error('[github-import-finalize-file] error:', error);
        return jsonError('Internal error', 500, 'INTERNAL_ERROR');
    }
}

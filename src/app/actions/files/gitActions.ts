'use server';

import { db } from '@/lib/db';
import { projectGitDeltas, projectNodeConflicts, projectNodes, fileVersions, projects } from '@/lib/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { buildProjectFileKey } from '@/lib/storage/project-file-key';
import { randomUUID, createHash } from 'crypto';
import {
    acquireFileLease,
    assertOwnedFileLease,
    releaseFileLease,
} from '@/lib/files/file-lock-service';

function computeSha256(content: string): string {
    return createHash('sha256').update(content).digest('hex');
}

async function assertGitOwner(projectId: string, userId: string) {
    const project = await db.query.projects.findFirst({ where: eq(projects.id, projectId), columns: { ownerId: true } });
    if (!project || project.ownerId !== userId) throw new Error('Forbidden');
}

export async function getPendingDeltasAction(projectId: string, targetBranch: string) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Unauthorized');
        await assertGitOwner(projectId, user.id);

        const deltas = await db.query.projectGitDeltas.findMany({
            where: and(
                eq(projectGitDeltas.projectId, projectId),
                eq(projectGitDeltas.targetBranch, targetBranch),
                eq(projectGitDeltas.status, 'pending')
            ),
            orderBy: [projectGitDeltas.sequenceNumber, projectGitDeltas.deltaOrder],
            limit: 100,
        });

        return { success: true, deltas };
    } catch (err: any) {
        return { success: false, error: err.message };
    }
}

export async function getProjectConflictsAction(projectId: string, targetBranch: string) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Unauthorized');
        await assertGitOwner(projectId, user.id);

        const conflicts = await db.query.projectNodeConflicts.findMany({
            where: and(
                eq(projectNodeConflicts.projectId, projectId),
                eq(projectNodeConflicts.gitBranch, targetBranch),
                eq(projectNodeConflicts.conflictStatus, 'unresolved')
            ),
            limit: 100,
        });

        // Resolve paths and names in a single batch query (O(1) roundtrips instead of N+1)
        const nodeIds = [...new Set(conflicts.map((c) => c.nodeId))];
        const nodes = nodeIds.length > 0
            ? await db.query.projectNodes.findMany({
                where: inArray(projectNodes.id, nodeIds),
                columns: { id: true, name: true, path: true },
            })
            : [];
        const nodeMap = new Map(nodes.map((n) => [n.id, n]));
        const conflictsWithNodes = conflicts.map((c) => {
            const node = nodeMap.get(c.nodeId);
            return {
                ...c,
                fileName: node?.name || 'unknown',
                filePath: node?.path || 'unknown',
            };
        });

        return { success: true, conflicts: conflictsWithNodes };
    } catch (err: any) {
        return { success: false, error: err.message };
    }
}

export async function resolveConflictAction(
    conflictId: string,
    resolution: 'keep_mine' | 'keep_remote' | 'merge',
    mergedContent?: string
) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Unauthorized');

        const conflict = await db.query.projectNodeConflicts.findFirst({
            where: eq(projectNodeConflicts.id, conflictId),
        });
        if (!conflict) throw new Error('Conflict not found');

        const node = await db.query.projectNodes.findFirst({
            where: eq(projectNodes.id, conflict.nodeId),
            columns: { id: true, projectId: true, mimeType: true, currentVersion: true },
        });
        if (!node) throw new Error('Node not found');
        await assertGitOwner(node.projectId, user.id);

        let finalContent = '';
        if (resolution === 'keep_mine') {
            // Content is already current local node in DB/S3
            finalContent = ''; // No change needed
        } else if (resolution === 'keep_remote') {
            finalContent = conflict.canonicalContent || '';
        } else if (resolution === 'merge') {
            finalContent = mergedContent || '';
        }

        const lease = await acquireFileLease({
            projectId: conflict.projectId,
            nodeId: node.id,
            userId: user.id,
            sessionId: randomUUID(),
            clientKind: 'web',
            ttlSeconds: 60,
        });

        let storageKey: string | null = null;
        let contentHash: string | null = null;
        let finalBufferSize = 0;
        if (resolution !== 'keep_mine') {
            const adminClient = await createAdminClient();
            storageKey = buildProjectFileKey(conflict.projectId, `conflicts/${conflict.id}-${Date.now()}`);
            const buf = Buffer.from(finalContent, 'utf8');
            finalBufferSize = buf.length;
            const { error: uploadError } = await adminClient.storage
                .from('project-files')
                .upload(storageKey, buf, {
                    contentType: node.mimeType || 'text/plain',
                    cacheControl: '31536000',
                });

            if (uploadError) {
                throw new Error(`Failed to upload resolved content to storage: ${uploadError.message}`);
            }

            contentHash = computeSha256(finalContent);
        }

        try {
        await db.transaction(async (tx) => {
            await tx
                .select({ id: projectNodes.id })
                .from(projectNodes)
                .where(eq(projectNodes.id, node.id))
                .for('update');
            await assertOwnedFileLease(tx, {
                projectId: conflict.projectId,
                nodeId: node.id,
                userId: user.id,
                credentials: lease,
            });
            if (resolution !== 'keep_mine' && storageKey && contentHash) {
                const nextVersion = node.currentVersion + 1;

                // Update node version
                await tx
                    .update(projectNodes)
                    .set({
                        currentVersion: nextVersion,
                        s3Key: storageKey,
                        size: finalBufferSize,
                        gitHash: contentHash,
                        syncStatus: 'merged',
                        updatedAt: new Date(),
                    })
                    .where(eq(projectNodes.id, node.id));

                // Insert new version
                await tx.insert(fileVersions).values({
                    nodeId: node.id,
                    version: nextVersion,
                    s3Key: storageKey,
                    size: Buffer.from(finalContent, 'utf8').length,
                    mimeType: node.mimeType || 'text/plain',
                    contentHash,
                    uploadedBy: user.id,
                    uploadedAt: new Date(),
                });
            }

            // Update conflict status
            await tx
                .update(projectNodeConflicts)
                .set({
                    conflictStatus: 'resolved',
                    mergedContent: resolution === 'keep_mine' ? conflict.incomingContent : (resolution === 'keep_remote' ? conflict.canonicalContent : mergedContent),
                })
                .where(eq(projectNodeConflicts.id, conflictId));

            // Reset deltas from conflict/failed to pending so they can be pushed/pulled again
            await tx
                .update(projectGitDeltas)
                .set({
                    status: 'pending',
                })
                .where(
                    and(
                        eq(projectGitDeltas.projectId, conflict.projectId),
                        eq(projectGitDeltas.targetBranch, conflict.gitBranch),
                        eq(projectGitDeltas.status, 'conflict')
                    )
                );
        });
        } finally {
            await releaseFileLease({
                projectId: conflict.projectId,
                nodeId: node.id,
                userId: user.id,
                credentials: lease,
            }).catch(() => false);
        }

        return { success: true };
    } catch (err: any) {
        console.error('[resolveConflictAction] error:', err);
        return { success: false, error: err.message };
    }
}

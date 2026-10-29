"use server";

import { requireAuthenticatedUser } from "@/app/api/v1/_shared";

import { db } from "@/lib/db";
import { readFileSubtree } from "@/lib/files/permanent-delete";
import { permanentlyDeleteTrashedNode } from "./trash";
import { fileVersions, profiles, projectFileIndex, projectNodeEvents, projectNodeLocks, projectNodes, storageAssets, taskActivityEvents, taskNodeLinks, tasks, uploadIntents } from "@/lib/db/schema";
import type { ProjectNode } from "@/lib/db/schema";
import { eq, and, or, isNull, isNotNull, ilike, inArray, sql, gt, ne, desc, type SQL } from "drizzle-orm";
import { randomUUID } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { after } from "next/server";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { logger } from "@/lib/logger";
import { enqueueProjectNotificationEvent } from "@/lib/notifications/project-events";
import { buildProjectFileKey, isCanonicalProjectFileKey, parseProjectFileKey } from "@/lib/storage/project-file-key";
import {
    normalizeAndValidateFileSize,
    normalizeAndValidateMimeType,
    normalizeAndValidateUploadRelativePath,
    PROJECT_UPLOAD_MAX_FILE_BYTES,
} from "@/lib/upload/security";
import { finalizeUploadIntent } from "@/lib/upload/upload-intents";
import { replaceTaskFileRoleTag, type TaskFileRole } from "@/lib/projects/task-file-intelligence";
import {
    assertProjectWriteAccess,
    assertProjectWriteAccessTx,
    assertNodesNotLockedByAnotherUser,
    assertNotMovingAnyIntoDescendant,
    assertUniqueSiblingNames,
    assertProjectManageFilesAccess,
    assertProjectManageFilesAccessTx,
    assertProjectUploadAccess,
    assertProjectUploadAccessTx,
    assertValidParentFolder,
    assertValidMoveDestination,
    assertUniqueSiblingName,
    assertNodeNotLockedByAnotherUser,
    recordNodeEvent,
    recordNodeEventsBatch,
} from "@/lib/files/internal-helpers";
import {
    normalizeNodeName,
    assertValidNodeName,
    assertBulkLimit,
    escapeLikePattern,
    UUID_RE,
} from "./_constants";

function actorNotificationSnapshot(user: { user_metadata?: Record<string, unknown> | null }) {
    return {
        actorName: (user.user_metadata?.full_name as string | undefined) ?? (user.user_metadata?.username as string | undefined) ?? null,
        actorAvatarUrl: (user.user_metadata?.avatar_url as string | undefined) ?? null,
    };
}

async function enqueueFileNotificationBestEffort(input: Parameters<typeof enqueueProjectNotificationEvent>[0]) {
    const run = async () => {
        try {
            await enqueueProjectNotificationEvent(input);
        } catch (error) {
            logger.warn("project_files.notification_enqueue_failed", {
                module: "files",
                projectId: input.projectId,
                eventKey: input.eventKey,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    };

    try {
        after(run);
    } catch {
        // If invoked outside a request lifecycle (e.g. scripts/background), run unawaited.
        void run();
    }
}

async function getParentPath(tx: any, projectId: string, parentId: string | null): Promise<string> {
    if (!parentId) return "";
    const parent = await tx.query.projectNodes.findFirst({
        where: and(eq(projectNodes.id, parentId), eq(projectNodes.projectId, projectId)),
        columns: { path: true }
    });
    return parent?.path || "";
}

// PURE OPTIMIZATION (Item 22): Combine parent folder verification, type check, sibling collision check, and path resolution into 1 DB query.
async function resolveParentAndCheckSibling(
    tx: any,
    projectId: string,
    parentId: string | null,
    safeName: string,
    ignoreNodeId?: string,
): Promise<string> {
    if (!parentId) {
        await assertUniqueSiblingName(projectId, null, safeName, tx, ignoreNodeId);
        return "";
    }

    const rows = (await tx.execute(sql`
        SELECT
            p.id as parent_id,
            p.type as parent_type,
            p.path as parent_path,
            EXISTS(
                SELECT 1 FROM project_nodes s
                WHERE s.project_id = ${projectId}::uuid
                  AND s.parent_id = ${parentId}::uuid
                  AND s.deleted_at IS NULL
                  AND lower(s.name) = lower(${safeName})
                  ${ignoreNodeId ? sql`AND s.id != ${ignoreNodeId}::uuid` : sql``}
            ) as name_exists
        FROM project_nodes p
        WHERE p.id = ${parentId}::uuid
          AND p.project_id = ${projectId}::uuid
          AND p.deleted_at IS NULL
    `)) as Array<{
        parent_id: string | null;
        parent_type: string | null;
        parent_path: string | null;
        name_exists: boolean;
    }>;

    const row = Array.from(rows)[0];
    if (!row) throw new Error("Destination folder not found");
    if (row.parent_type !== "folder") throw new Error("Destination must be a folder");
    if (row.name_exists) throw new Error("A file/folder with this name already exists in this location");

    return row.parent_path || "";
}

function descendantLikePattern(path: string): string {
    return `${escapeLikePattern(path)}/%`;
}

function taskScopePredicate(taskId: string | null): SQL {
    return sql`${projectNodes.taskId} IS NOT DISTINCT FROM ${taskId}`;
}

function subtreePathPredicate(node: { id: string; path: string; type: string; taskId: string | null }): SQL {
    const predicates: SQL[] = [eq(projectNodes.id, node.id)];
    if (node.type === "folder" && node.path) {
        predicates.push(sql`${projectNodes.path} LIKE ${descendantLikePattern(node.path)} ESCAPE '\\'`);
    }
    return and(taskScopePredicate(node.taskId), or(...predicates) ?? sql`FALSE`) ?? sql`FALSE`;
}

async function updateFolderDescendantPaths(
    tx: any,
    projectId: string,
    folderId: string,
    oldPath: string,
    newPath: string,
    taskId: string | null,
    options: { releaseTaskScope?: boolean } = {},
) {
    if (!oldPath) return;
    // The subtree is walked by parent_id, trashed rows included: a trashed descendant moves with its
    // folder (so restore lands at the current path), while an unrelated trashed folder that once had
    // the same path does not. The offset is cast ::int: untyped, Postgres reads SUBSTRING(x FROM $n)
    // as a regex. Paths and task scope move in ONE statement matched on the old scope (COR-012).
    await tx.execute(sql`
        WITH RECURSIVE subtree AS (
            SELECT id FROM project_nodes WHERE parent_id = ${folderId} AND project_id = ${projectId}
            UNION ALL
            SELECT child.id FROM project_nodes child JOIN subtree ON child.parent_id = subtree.id
            WHERE child.project_id = ${projectId}
        )
        UPDATE project_nodes
        SET path = ${newPath} || SUBSTRING(path FROM ${oldPath.length + 1}::int),
            ${options.releaseTaskScope ? sql`task_id = NULL,` : sql``}
            updated_at = NOW()
        WHERE id IN (SELECT id FROM subtree)
          AND task_id IS NOT DISTINCT FROM ${taskId}
          AND path LIKE ${descendantLikePattern(oldPath)} ESCAPE '\\'
    `);
}

/** Restore puts a root back under its live parent's current path (and its subtree with it). */
async function realignRestoredRoot(tx: any, projectId: string, nodeId: string) {
    const [row] = Array.from(await tx.execute(sql`
        SELECT n.path, n.type, n.task_id, n.name, p.path AS parent_path
        FROM project_nodes n
        LEFT JOIN project_nodes p ON p.id = n.parent_id
        WHERE n.id = ${nodeId} AND n.project_id = ${projectId}
    `)) as Array<{ path: string; type: string; task_id: string | null; name: string; parent_path: string | null }>;
    if (!row) return;
    const expected = `${row.parent_path ?? ""}/${row.name}`;
    if (row.path === expected) return;
    await tx.execute(sql`UPDATE project_nodes SET path = ${expected}, updated_at = NOW() WHERE id = ${nodeId}`);
    if (row.type === "folder") await updateFolderDescendantPaths(tx, projectId, nodeId, row.path, expected, row.task_id);
}

async function assertSubtreeNotLockedByAnotherUser(
    tx: any,
    projectId: string,
    node: { id: string; path: string; type: string; taskId: string | null },
    userId: string,
) {
    const [lock] = await tx
        .select({ nodeId: projectNodeLocks.nodeId })
        .from(projectNodeLocks)
        .innerJoin(projectNodes, eq(projectNodeLocks.nodeId, projectNodes.id))
        .where(and(
            eq(projectNodeLocks.projectId, projectId),
            ne(projectNodeLocks.lockedBy, userId),
            gt(projectNodeLocks.expiresAt, new Date()),
            subtreePathPredicate(node)
        ))
        .limit(1);

    if (lock) {
        throw new Error("This folder or one of its contents is being edited by another member");
    }
}

export async function createFolder(
    projectId: string,
    parentId: string | null,
    name: string,
    options?: { taskId?: string },
) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");
    const { allowed } = await consumeRateLimit(`files:${user.id}`, 60, 60);
    if (!allowed) throw new Error("Rate limit exceeded");
    await assertProjectUploadAccess(projectId, user.id);

    const safeName = normalizeNodeName(name);
    assertValidNodeName(safeName);

    const node = await db.transaction(async (tx) => {
        await assertProjectUploadAccessTx(tx, projectId, user.id);
        const parentPath = await resolveParentAndCheckSibling(tx, projectId, parentId, safeName);
        const nodePath = `${parentPath}/${safeName}`;

        const [created] = await tx.insert(projectNodes).values({
            projectId,
            parentId,
            type: 'folder',
            name: safeName,
            path: nodePath,
            createdBy: user.id,
            taskId: options?.taskId ?? null,
        }).returning();
        return created!;
    });

    await recordNodeEvent(projectId, user.id, node.id, 'create_folder', { parentId, name: safeName });
    await enqueueFileNotificationBestEffort({
        projectId,
        actorUserId: user.id,
        ...actorNotificationSnapshot(user),
        eventKey: "files.folder_created",
        title: `Folder created: ${safeName}`,
        body: "A new folder was added to the project workspace.",
        sourceEventId: node.id,
        entityRefs: { projectId, fileId: node.id },
    });
    return node;
}

export async function createFileNode(projectId: string, parentId: string | null, file: {
    name: string;
    s3Key: string;
    size: number;
    mimeType: string;
    uploadIntentId?: string;
    taskId?: string;
    canonicalNodeId?: string;
    taskLink?: { role?: TaskFileRole; annotation?: string | null };
}) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");
    const { allowed } = await consumeRateLimit(`files:${user.id}`, 60, 60);
    if (!allowed) throw new Error("Rate limit exceeded");
    await assertProjectUploadAccess(projectId, user.id, { taskId: file.taskId });

    const safeName = normalizeNodeName(file.name);
    assertValidNodeName(safeName);
    if (file.taskId && !UUID_RE.test(file.taskId)) throw new Error("Invalid task");
    if (file.taskLink && (!file.taskId || (file.taskLink.role && !["working", "reference", "deliverable"].includes(file.taskLink.role)))) throw new Error("Invalid task link");
    if (file.taskLink?.annotation && file.taskLink.annotation.length > 2000) throw new Error("Task file annotation is too long");
    const finalizedIntent = await finalizeUploadIntent({
        intentId: file.uploadIntentId,
        storageKey: file.s3Key,
        bucket: 'project-files',
        userId: user.id,
        projectId,
        expectedScope: 'project_file',
        expectedKind: 'file',
    });

    const parsedKey = parseProjectFileKey(finalizedIntent.storageKey);
    if (!parsedKey || !isCanonicalProjectFileKey(finalizedIntent.storageKey) || parsedKey.projectId !== projectId) {
        throw new Error("Invalid file storage key");
    }
    const normalizedRelativePath = normalizeAndValidateUploadRelativePath(parsedKey.relativePath);
    const canonicalS3Key = buildProjectFileKey(projectId, normalizedRelativePath);
    // The node must point at the object that was actually uploaded and verified.
    if (canonicalS3Key !== finalizedIntent.storageKey) throw new Error("Invalid file storage key");
    const normalizedSize = normalizeAndValidateFileSize(finalizedIntent.finalizedSize ?? file.size, PROJECT_UPLOAD_MAX_FILE_BYTES);
    const normalizedMimeType = normalizeAndValidateMimeType(finalizedIntent.finalizedMimeType ?? file.mimeType);
    if (!finalizedIntent.assetId) throw new Error("Verified file asset is unavailable");
    const assetId = finalizedIntent.assetId;

    const node = await db.transaction(async (tx) => {
        await assertProjectUploadAccessTx(tx, projectId, user.id, { taskId: file.taskId });
        const [publishableAsset] = await tx.update(storageAssets)
            .set({
                backupState: sql`CASE WHEN ${storageAssets.backupState} = 'verified' THEN 'verified' ELSE 'pending' END`,
                updatedAt: new Date(),
            })
            .where(and(
                eq(storageAssets.id, assetId),
                eq(storageAssets.state, "verified"),
                eq(storageAssets.ownerUserId, user.id),
                eq(storageAssets.projectId, projectId),
            ))
            .returning({ id: storageAssets.id, contentHash: storageAssets.contentHash });
        if (!publishableAsset) throw new Error("File asset is no longer publishable");
        if (!publishableAsset.contentHash) throw new Error("Verified file digest is unavailable");
        if (file.taskId) {
            const [task] = await tx.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.id, file.taskId), eq(tasks.projectId, projectId), isNull(tasks.deletedAt))).limit(1).for("update");
            if (!task) throw new Error("Task not found");
        }
        if (file.canonicalNodeId) {
            // A staged task copy may only point at a live main-tree file of this
            // same project; merge later rewrites that node (COR-057).
            if (!UUID_RE.test(file.canonicalNodeId) || !file.taskId) throw new Error("Invalid canonical file");
            const [canonical] = await tx.select({ id: projectNodes.id }).from(projectNodes).where(and(
                eq(projectNodes.id, file.canonicalNodeId),
                eq(projectNodes.projectId, projectId),
                eq(projectNodes.type, "file"),
                isNull(projectNodes.taskId),
                isNull(projectNodes.deletedAt),
            )).limit(1).for("update");
            if (!canonical) throw new Error("Canonical file not found in this project");
        }
        if (file.taskLink) await assertProjectWriteAccessTx(tx, projectId, user.id, { taskId: file.taskId });
        const parentPath = await resolveParentAndCheckSibling(tx, projectId, parentId, safeName);
        const nodePath = `${parentPath}/${safeName}`;

        const [created] = await tx.insert(projectNodes).values({
            projectId,
            parentId,
            type: 'file',
            name: safeName,
            path: nodePath,
            s3Key: canonicalS3Key,
            assetId,
            size: normalizedSize,
            mimeType: normalizedMimeType,
            createdBy: user.id,
            taskId: file.taskId || null,
            canonicalNodeId: file.canonicalNodeId || null,
        }).returning();
        await tx.insert(fileVersions).values({
            nodeId: created!.id,
            version: created!.currentVersion,
            s3Key: canonicalS3Key,
            assetId,
            size: normalizedSize,
            mimeType: normalizedMimeType,
            contentHash: publishableAsset.contentHash,
            uploadedBy: user.id,
            attribution: { source: "direct_upload" },
        });
        if (file.taskLink && file.taskId) {
            const [last] = await tx.select({ order: sql<number>`coalesce(max(${taskNodeLinks.order}), 0)` }).from(taskNodeLinks).where(eq(taskNodeLinks.taskId, file.taskId));
            await tx.insert(taskNodeLinks).values({ taskId: file.taskId, nodeId: created!.id, createdBy: user.id, order: Number(last?.order ?? 0) + 1,
                tags: replaceTaskFileRoleTag([], file.taskLink.role ?? "working"), annotation: file.taskLink.annotation ?? null });
        }
        return created!;
    });

    await recordNodeEvent(projectId, user.id, node.id, 'create_file', { parentId, name: safeName, s3Key: canonicalS3Key });
    await enqueueFileNotificationBestEffort({
        projectId,
        actorUserId: user.id,
        ...actorNotificationSnapshot(user),
        eventKey: "files.uploaded",
        title: `File uploaded: ${safeName}`,
        body: "A file was added to the project workspace.",
        sourceEventId: node.id,
        entityRefs: { projectId, fileId: node.id },
    });
    const profile = await db.query.profiles.findFirst({
        where: eq(profiles.id, user.id),
        columns: { fullName: true, username: true, avatarUrl: true },
    });

    // The explorer optimistically upserts this result before its background
    // listing refresh finishes. Include the same attribution shape returned by
    // getProjectNodes so the "By" column never briefly renders as "—".
    return {
        ...node,
        updatedById: user.id,
        updatedByName: profile?.fullName ?? null,
        updatedByUsername: profile?.username ?? null,
        updatedByAvatarUrl: profile?.avatarUrl ?? null,
        versionUpdatedAt: node.updatedAt,
    };
}

// Finalization stays within the shared 50-item server batch boundary.
export async function finalizeBatchUpload(
    projectId: string,
    parentId: string | null,
    files: Array<{
        name: string;
        s3Key: string;
        size: number;
        mimeType: string;
        uploadIntentId?: string;
    }>,
) {
    if (!files.length) return [];
    if (files.length > 50) throw new Error("Batch upload exceeds maximum of 50 files");

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");
    const { allowed } = await consumeRateLimit(`files:${user.id}`, 60, 60);
    if (!allowed) throw new Error("Rate limit exceeded");
    await assertProjectUploadAccess(projectId, user.id);

    const intentIds = files
        .map((f) => f.uploadIntentId)
        .filter((id): id is string => typeof id === "string" && id.length > 0);
    const storageKeys = files
        .map((f) => f.s3Key)
        .filter((k): k is string => typeof k === "string" && k.length > 0);

    const intentConditions = [];
    if (intentIds.length > 0) intentConditions.push(inArray(uploadIntents.id, intentIds));
    if (storageKeys.length > 0) intentConditions.push(inArray(uploadIntents.storageKey, storageKeys));

    // One bounded query preloads the upload intents for this batch.
    const preloadedIntents = intentConditions.length > 0
        ? await db.query.uploadIntents.findMany({
            where: and(
                eq(uploadIntents.userId, user.id),
                eq(uploadIntents.bucket, "project-files"),
                intentConditions.length === 1 ? intentConditions[0] : or(...intentConditions),
            ),
        })
        : [];
    const intentById = new Map(preloadedIntents.map((i) => [i.id, i]));
    const intentByStorageKey = new Map(preloadedIntents.map((i) => [i.storageKey, i]));

    const validatedFiles: Array<{
        safeName: string;
        canonicalS3Key: string;
        normalizedSize: number;
        normalizedMimeType: string;
        assetId: string | null | undefined;
    }> = [];
    for (let offset = 0; offset < files.length; offset += 8) {
        validatedFiles.push(...await Promise.all(files.slice(offset, offset + 8).map(async (file) => {
            const safeName = normalizeNodeName(file.name);
            assertValidNodeName(safeName);

            const preloaded = (file.uploadIntentId ? intentById.get(file.uploadIntentId) : null)
                ?? intentByStorageKey.get(file.s3Key)
                ?? null;

            const finalizedIntent = await finalizeUploadIntent({
                intentId: file.uploadIntentId,
                storageKey: file.s3Key,
                bucket: 'project-files',
                userId: user.id,
                projectId,
                expectedScope: 'project_file',
                expectedKind: 'file',
            }, preloaded);

            const parsedKey = parseProjectFileKey(finalizedIntent.storageKey);
            if (!parsedKey || !isCanonicalProjectFileKey(finalizedIntent.storageKey) || parsedKey.projectId !== projectId) {
                throw new Error("Invalid file storage key");
            }
            const normalizedRelativePath = normalizeAndValidateUploadRelativePath(parsedKey.relativePath);
            const canonicalS3Key = buildProjectFileKey(projectId, normalizedRelativePath);
            const normalizedSize = normalizeAndValidateFileSize(finalizedIntent.finalizedSize ?? file.size, PROJECT_UPLOAD_MAX_FILE_BYTES);
            const normalizedMimeType = normalizeAndValidateMimeType(finalizedIntent.finalizedMimeType ?? file.mimeType);

            return {
                safeName,
                canonicalS3Key,
                normalizedSize,
                normalizedMimeType,
                assetId: finalizedIntent.assetId,
            };
        })));
    }

    if (validatedFiles.some((file) => !file.assetId)) {
        throw new Error("One or more verified file assets are unavailable");
    }
    const assetIds = validatedFiles.map((file) => file.assetId!);
    const verifiedAssets = await db.select({
        id: storageAssets.id,
        contentHash: storageAssets.contentHash,
    }).from(storageAssets).where(and(
        inArray(storageAssets.id, assetIds),
        eq(storageAssets.state, "verified"),
        eq(storageAssets.ownerUserId, user.id),
        eq(storageAssets.projectId, projectId),
    ));
    const assetById = new Map(verifiedAssets.map((asset) => [asset.id, asset]));
    if (assetById.size !== new Set(assetIds).size || verifiedAssets.some((asset) => !asset.contentHash)) {
        throw new Error("One or more file assets are no longer publishable");
    }

    const createdNodes = await db.transaction(async (tx) => {
        await assertProjectUploadAccessTx(tx, projectId, user.id);
        let parentPath = "";
        if (parentId) {
            const [parent] = await tx
                .select({ path: projectNodes.path, type: projectNodes.type })
                .from(projectNodes)
                .where(and(eq(projectNodes.id, parentId), eq(projectNodes.projectId, projectId), isNull(projectNodes.deletedAt)))
                .limit(1);
            if (!parent) throw new Error("Parent folder not found");
            if (parent.type !== "folder") throw new Error("Destination must be a folder");
            parentPath = parent.path;
        }

        // Check for existing active sibling names in destination to prevent unique constraint collisions
        const existingSiblings = await tx
            .select({ lowerName: sql<string>`lower(${projectNodes.name})` })
            .from(projectNodes)
            .where(and(
                eq(projectNodes.projectId, projectId),
                parentId ? eq(projectNodes.parentId, parentId) : isNull(projectNodes.parentId),
                isNull(projectNodes.taskId),
                isNull(projectNodes.deletedAt)
            ));
        const existingSet = new Set(existingSiblings.map((s: { lowerName: string }) => s.lowerName));

        // Deduplicate files by lowercase name within the same batch, taking the latest uploaded entry
        const uniqueValuesMap = new Map<string, {
            projectId: string;
            parentId: string | null;
            type: 'file';
            name: string;
            path: string;
            s3Key: string;
            size: number;
            mimeType: string;
            assetId: string;
            contentHash: string | null;
            createdBy: string;
        }>();
        for (const f of validatedFiles) {
            const lowerName = f.safeName.toLowerCase();
            if (existingSet.has(lowerName)) {
                continue;
            }
            uniqueValuesMap.set(lowerName, {
                projectId,
                parentId,
                type: 'file' as const,
                name: f.safeName,
                path: `${parentPath}/${f.safeName}`,
                s3Key: f.canonicalS3Key,
                assetId: f.assetId!,
                size: f.normalizedSize,
                mimeType: f.normalizedMimeType,
                contentHash: assetById.get(f.assetId!)?.contentHash ?? null,
                createdBy: user.id,
            });
        }
        const valuesToInsert = Array.from(uniqueValuesMap.values());
        if (!valuesToInsert.length) return [];

        const attachedAssetIds = [...new Set(valuesToInsert.map((value) => value.assetId))];
        const publishedAssets = await tx.update(storageAssets)
            .set({
                backupState: sql`CASE WHEN ${storageAssets.backupState} = 'verified' THEN 'verified' ELSE 'pending' END`,
                updatedAt: new Date(),
            })
            .where(and(
                inArray(storageAssets.id, attachedAssetIds),
                eq(storageAssets.state, "verified"),
                eq(storageAssets.ownerUserId, user.id),
                eq(storageAssets.projectId, projectId),
            ))
            .returning({ id: storageAssets.id });
        if (publishedAssets.length !== attachedAssetIds.length) {
            throw new Error("One or more file assets are no longer publishable");
        }

        const inserted = await tx.insert(projectNodes).values(valuesToInsert.map(({ contentHash: _contentHash, ...value }) => value)).returning();
        const valueByKey = new Map(valuesToInsert.map((value) => [value.s3Key, value]));
        await tx.insert(fileVersions).values(inserted.map((node) => {
            const source = valueByKey.get(node.s3Key!);
            if (!source) throw new Error("File publication mapping changed");
            return {
                nodeId: node.id,
                version: node.currentVersion,
                s3Key: source.s3Key,
                assetId: source.assetId,
                size: source.size,
                mimeType: source.mimeType,
                contentHash: source.contentHash,
                uploadedBy: user.id,
                attribution: { source: "batch_upload" },
            };
        }));
        return inserted;
    });

    const firstNode = createdNodes[0];
    if (!firstNode) return [];

    await enqueueFileNotificationBestEffort({
        projectId,
        actorUserId: user.id,
        ...actorNotificationSnapshot(user),
        eventKey: createdNodes.length === 1 ? "files.uploaded" : "files.bulk_uploaded",
        title: createdNodes.length === 1 ? `File uploaded: ${firstNode.name}` : `${createdNodes.length} files uploaded`,
        body: "Files were added to the project workspace.",
        sourceEventId: firstNode.id,
        aggregateCount: createdNodes.length,
        entityRefs: { projectId, fileId: firstNode.id },
    });

    const profile = await db.query.profiles.findFirst({
        where: eq(profiles.id, user.id),
        columns: { fullName: true, username: true, avatarUrl: true },
    });

    // Record this bounded batch in one round trip.
    await recordNodeEventsBatch(
        projectId,
        user.id,
        createdNodes.map((node) => node.id),
        'create_file',
        { parentId, count: createdNodes.length }
    ).catch((err) => console.warn('[files] failed to batch record node events', err));

    return createdNodes.map((node) => ({
        ...node,
        updatedById: user.id,
        updatedByName: profile?.fullName ?? null,
        updatedByUsername: profile?.username ?? null,
        updatedByAvatarUrl: profile?.avatarUrl ?? null,
        versionUpdatedAt: node.updatedAt,
    }));
}

export type UploadCollisionSummary = {
    existingFiles: string[];
    existingFolders: string[];
    folderIdsByPath: Record<string, string>;
};

/**
 * Resolve an upload's intended relative paths against the persisted tree.
 * This is deliberately a read-only preflight: clients can explain what will
 * be reused/skipped before bytes are sent, while the create mutations remain
 * the authoritative race-safe uniqueness guard.
 */
export async function getUploadCollisionSummary(
    projectId: string,
    targetParentId: string | null,
    paths: string[],
    options?: { taskId?: string | null },
): Promise<UploadCollisionSummary> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");
    await assertProjectUploadAccess(projectId, user.id);

    if (paths.length > 5000) {
        throw new Error("Maximum 5000 paths allowed per collision check");
    }

    const normalizedPaths = Array.from(new Set(paths
        .map((path) => normalizeAndValidateUploadRelativePath(path))
        .filter(Boolean)));
    if (normalizedPaths.length === 0) {
        return { existingFiles: [], existingFolders: [], folderIdsByPath: {} };
    }

    const taskId = options?.taskId ?? null;
    const pathInputs = normalizedPaths.map((path) => ({ path, segments: path.split("/") }));
    const segmentCount = pathInputs.reduce((total, input) => total + input.segments.length, 0);
    if (segmentCount > 10_000) {
        throw new Error("Upload paths contain too many nested segments");
    }

    // Walk only the submitted sibling chains. The active sibling uniqueness
    // index owns races; this preflight never scans the rest of the project tree.
    const matchedRows = await db.execute<{
        input_path: string;
        relative_path: string;
        node_id: string;
        node_type: "file" | "folder";
    }>(sql`
        WITH RECURSIVE input_paths AS (
            SELECT input.path, input.segments
            FROM jsonb_to_recordset(${JSON.stringify(pathInputs)}::jsonb)
                AS input(path text, segments text[])
        ), walk AS (
            SELECT
                input.path AS input_path,
                input.segments,
                1 AS depth,
                ${targetParentId}::uuid AS parent_id,
                NULL::uuid AS node_id,
                NULL::text AS node_type
            FROM input_paths input

            UNION ALL

            SELECT
                walk.input_path,
                walk.segments,
                walk.depth + 1,
                node.id,
                node.id,
                node.type
            FROM walk
            JOIN project_nodes node
              ON node.project_id = ${projectId}::uuid
             AND node.parent_id IS NOT DISTINCT FROM walk.parent_id
             AND lower(node.name) = lower(walk.segments[walk.depth])
             AND node.task_id IS NOT DISTINCT FROM ${taskId}::uuid
             AND node.deleted_at IS NULL
            WHERE walk.depth <= cardinality(walk.segments)
              AND (walk.node_type IS NULL OR walk.node_type = 'folder')
        )
        SELECT
            input_path,
            array_to_string(segments[1:depth - 1], '/') AS relative_path,
            node_id,
            node_type
        FROM walk
        WHERE node_id IS NOT NULL
    `);

    const existingFiles = new Set<string>();
    const existingFolders = new Set<string>();
    const folderIdsByPath: Record<string, string> = {};

    for (const row of matchedRows) {
        if (row.node_type === "folder") {
            existingFolders.add(row.relative_path);
            folderIdsByPath[row.relative_path] = row.node_id;
        } else {
            existingFiles.add(row.relative_path);
        }
    }

    return {
        existingFiles: Array.from(existingFiles).sort(),
        existingFolders: Array.from(existingFolders).sort(),
        folderIdsByPath,
    };
}

export async function renameNode(nodeId: string, newName: string, projectId: string, expectedUpdatedAt?: string) {
    const { user } = await requireAuthenticatedUser();
    if (!user) throw new Error("Unauthorized");
    const { allowed } = await consumeRateLimit(`files:${user.id}`, 60, 60);
    if (!allowed) throw new Error("Rate limit exceeded");
    await assertProjectWriteAccess(projectId, user.id);

    const safeName = normalizeNodeName(newName);
    assertValidNodeName(safeName);

    const node = await db.transaction(async (tx) => {
        await assertProjectWriteAccessTx(tx, projectId, user.id);
        await assertNodeNotLockedByAnotherUser(projectId, nodeId, user.id, tx);
        const current = await tx.query.projectNodes.findFirst({
            where: and(eq(projectNodes.id, nodeId), eq(projectNodes.projectId, projectId)),
            columns: { id: true, parentId: true, taskId: true, metadata: true, deletedAt: true, path: true, type: true, updatedAt: true },
        });

        if (!current || current.deletedAt) throw new Error("File not found");
        if (expectedUpdatedAt !== undefined && current.updatedAt.toISOString() !== expectedUpdatedAt)
            throw new Error("This item changed since the rename. Review its current name before renaming again.");
        const isSystemFolder =
            !!current.metadata && (current.metadata as { isSystem?: unknown }).isSystem === true;
        if (isSystemFolder) throw new Error("Cannot rename system folder");

        const parentPath = await resolveParentAndCheckSibling(tx, projectId, current.parentId ?? null, safeName, nodeId);
        const newPath = `${parentPath}/${safeName}`;
        const oldPath = current.path;

        const [updated] = await tx.update(projectNodes)
            .set({ name: safeName, path: newPath, updatedAt: new Date() })
            .where(and(eq(projectNodes.id, nodeId), eq(projectNodes.projectId, projectId)))
            .returning();

        await updateFolderDescendantPaths(tx, projectId, nodeId, oldPath, newPath, current.taskId ?? null);

        return updated!;
    });

    await recordNodeEvent(projectId, user.id, nodeId, 'rename', { newName: safeName });
    await enqueueFileNotificationBestEffort({
        projectId,
        actorUserId: user.id,
        ...actorNotificationSnapshot(user),
        eventKey: "files.organized",
        title: `File renamed: ${safeName}`,
        body: "A project file or folder was renamed.",
        sourceEventId: `${nodeId}:rename:${safeName}`,
        entityRefs: { projectId, fileId: nodeId },
    });
    // ponytail: client explorer handles rename via Zustand renameNodeInCaches; skip route revalidation. ceiling: single-tab explorer view. upgrade: Realtime broadcast if multi-tab explorer sync is required.
    return node;
}

export type MoveProjectNodesResult = {
    nodes: ProjectNode[];
    operationId: string | null;
    affectedParentIds: Array<string | null>;
};

export async function moveProjectNodes(
    nodeIds: string[],
    newParentId: string | null,
    projectId: string,
    options?: {
        expectedParentByNode?: Record<string, string | null>;
        expectedUpdatedAtByNode?: Record<string,string>;
        mode?: "move" | "publish";
    },
): Promise<MoveProjectNodesResult> {
    const { user } = await requireAuthenticatedUser();
    if (!user) throw new Error("Unauthorized");
    const { allowed } = await consumeRateLimit(`files:${user.id}`, 60, 60);
    if (!allowed) throw new Error("Rate limit exceeded");
    await assertProjectManageFilesAccess(projectId, user.id);

    const uniqueIds = Array.from(new Set(nodeIds.filter(Boolean)));
    assertBulkLimit(uniqueIds);
    const operationId = randomUUID();

    const result = await db.transaction(async (tx) => {
        await assertProjectManageFilesAccessTx(tx, projectId, user.id);
        const nodes = await tx.query.projectNodes.findMany({
            where: and(
                eq(projectNodes.projectId, projectId),
                inArray(projectNodes.id, uniqueIds),
                isNull(projectNodes.deletedAt)
            ),
            columns: {
                id: true,
                parentId: true,
                name: true,
                type: true,
                path: true,
                taskId: true,
                metadata: true,
                updatedAt:true,
            },
        });

        if (nodes.length !== uniqueIds.length) {
            throw new Error("Some selected files are missing or already deleted");
        }

        for (const node of nodes) {
            if(options?.expectedUpdatedAtByNode && options.expectedUpdatedAtByNode[node.id]!==node.updatedAt.toISOString()) throw new Error("File changed elsewhere. Review before moving.");
            if (
                options?.expectedParentByNode &&
                Object.prototype.hasOwnProperty.call(options.expectedParentByNode, node.id) &&
                (node.parentId ?? null) !== options.expectedParentByNode[node.id]
            ) {
                throw new Error(`Cannot undo move because "${node.name}" changed after the original operation`);
            }
        }

        const movers = nodes.filter((node) => (node.parentId ?? null) !== newParentId);
        if (movers.length === 0) {
            return { nodes: [] as ProjectNode[], operationId: null, affectedParentIds: [] as Array<string | null> };
        }
        const isPublishing = options?.mode === "publish";
        if (!isPublishing && movers.some((node) => node.taskId)) {
            throw new Error("Task working files must be published to Project Files before they can be relocated");
        }
        if (isPublishing && movers.some((node) => !node.taskId)) {
            throw new Error("Only task-owned files or folders can be published with this action");
        }
        await assertValidMoveDestination(projectId, newParentId, null, tx);

        const targetNameSet = new Set<string>();
        for (const node of movers) {
            const isSystemFolder =
                !!node.metadata && (node.metadata as { isSystem?: unknown }).isSystem === true;
            if (isSystemFolder) throw new Error(`Cannot move system folder: ${node.name}`);
            if (newParentId === node.id) throw new Error("Cannot move node into itself");

            const lowName = node.name.toLowerCase();
            if (targetNameSet.has(lowName)) {
                throw new Error(`Duplicate name conflict in selection: ${node.name}`);
            }
            targetNameSet.add(lowName);
        }
        await assertNodesNotLockedByAnotherUser(projectId, movers.map((node) => node.id), user.id, tx);
        await assertNotMovingAnyIntoDescendant(projectId, movers.filter((node) => node.type === "folder").map((node) => node.id), newParentId, tx);
        await assertUniqueSiblingNames(projectId, movers.map((node) => ({ id: node.id, parentId: newParentId, name: node.name })), tx);

        const selectedFolders = movers.filter((node) => node.type === "folder");
        for (const node of movers) {
            const selectedAncestor = selectedFolders.find((folder) =>
                folder.id !== node.id && node.path.startsWith(`${folder.path}/`)
            );
            if (selectedAncestor) {
                throw new Error(`Selection contains both "${selectedAncestor.name}" and one of its descendants. Select the top-level folder only.`);
            }
        }

        const movedNodes: ProjectNode[] = [];
        const affectedParentIds = new Set<string | null>([newParentId]);
        const newParentPath = await getParentPath(tx, projectId, newParentId);
        const now = new Date();
        const linkedTasks = await tx
            .select({ nodeId: taskNodeLinks.nodeId, taskId: taskNodeLinks.taskId, sprintId: tasks.sprintId })
            .from(taskNodeLinks)
            .innerJoin(tasks, eq(tasks.id, taskNodeLinks.taskId))
            .where(inArray(taskNodeLinks.nodeId, movers.map((node) => node.id)));
        const moves = movers.map((node) => ({ node, oldPath: node.path, newPath: `${newParentPath}/${node.name}` }));
        for (const { node } of moves) affectedParentIds.add(node.parentId ?? null);
        const updatedRows = await tx.update(projectNodes)
            .set({
                parentId: newParentId,
                path: sql`CASE ${projectNodes.id} ${sql.join(moves.map(({ node, newPath }) => sql`WHEN ${node.id}::uuid THEN ${newPath}`), sql` `)} END`,
                ...(isPublishing ? { taskId: null } : {}),
                updatedAt: now,
            })
            .where(and(inArray(projectNodes.id, moves.map(({ node }) => node.id)), eq(projectNodes.projectId, projectId)))
            .returning();
        const updatedById = new Map(updatedRows.map((row) => [row.id, row]));
        for (const { node, oldPath, newPath } of moves) {
            if (node.type !== "folder") continue;
            await updateFolderDescendantPaths(tx, projectId, node.id, oldPath, newPath, node.taskId ?? null, { releaseTaskScope: isPublishing });
        }
        for (const { node } of moves) movedNodes.push(updatedById.get(node.id)!);
        await recordNodeEventsBatch(
            projectId,
            user.id,
            moves.map(({ node }) => node.id),
            isPublishing ? "publish_task_file" : "move",
            moves.map(({ node, oldPath, newPath }) => ({
                operationId,
                oldParentId: node.parentId ?? null,
                newParentId,
                oldPath,
                newPath,
                taskId: node.taskId ?? null,
            })),
            tx,
        );
        const activityRows = moves.flatMap(({ node, oldPath, newPath }) =>
            linkedTasks
                .filter((link) => link.nodeId === node.id)
                .map((link) => ({
                    taskId: link.taskId,
                    projectId,
                    sprintId: link.sprintId,
                    actorId: user.id,
                    eventType: isPublishing ? "file_published" : "file_relocated",
                    payload: { operationId, fileName: node.name, oldPath, newPath },
                    createdAt: now,
                })),
        );
        if (activityRows.length > 0) await tx.insert(taskActivityEvents).values(activityRows);

        return { nodes: movedNodes, operationId, affectedParentIds: Array.from(affectedParentIds) };
    });

    if (result.nodes.length > 0) {
        await enqueueFileNotificationBestEffort({
            projectId,
            actorUserId: user.id,
            ...actorNotificationSnapshot(user),
            eventKey: "files.organized",
            title: options?.mode === "publish"
                ? `${result.nodes.length} task file${result.nodes.length === 1 ? "" : "s"} published`
                : `${result.nodes.length} file${result.nodes.length === 1 ? "" : "s"} moved`,
            body: options?.mode === "publish"
                ? "Task working files were published to Project Files."
                : "Project files were reorganized.",
            aggregateCount: result.nodes.length,
            sourceEventId: operationId,
            entityRefs: { projectId },
        });
        // ponytail: client explorer handles move via Zustand; skip route revalidation. ceiling: single-tab explorer view. upgrade: Realtime broadcast if multi-tab explorer sync is required.
    }
    return result;
}

export async function restoreNode(nodeId: string, projectId: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");
    const { allowed } = await consumeRateLimit(`files:${user.id}`, 60, 60);
    if (!allowed) throw new Error("Rate limit exceeded");
    await assertProjectWriteAccess(projectId, user.id);

    await db.transaction(async (tx) => {
        await assertProjectWriteAccessTx(tx, projectId, user.id);
        const node = await tx.query.projectNodes.findFirst({
            where: and(eq(projectNodes.id, nodeId), eq(projectNodes.projectId, projectId)),
            columns: { id: true, parentId: true, name: true, deletedAt: true, metadata: true },
        });
        if (!node) throw new Error("File not found");
        if (!node.deletedAt) return;
        if (node.metadata?.permanentDeleteRoot) throw new Error("Permanent deletion is pending. This item cannot be restored.");

        await assertNodeNotLockedByAnotherUser(projectId, nodeId, user.id, tx);
        if (node.parentId) {
            const parent = await tx.query.projectNodes.findFirst({
                where: and(
                    eq(projectNodes.id, node.parentId),
                    eq(projectNodes.projectId, projectId),
                    isNull(projectNodes.deletedAt)
                ),
                columns: { id: true, type: true },
            });
            if (!parent || parent.type !== "folder") {
                throw new Error("Restore the parent folder before restoring this file");
            }
        }
        const subtree = await readFileSubtree(tx, projectId, nodeId);
        // Restore only this trash operation; items deleted earlier stay in Trash.
        const restoreIds = subtree.filter(item => item.deletedAt?.getTime() === node.deletedAt!.getTime()).map(item => item.id);
        const restoreSet = new Set(restoreIds);
        for (const item of subtree.filter(item => restoreSet.has(item.id))) {
            if (item.metadata?.permanentDeleteRoot) throw new Error("Permanent deletion is pending in this folder.");
            await assertNodeNotLockedByAnotherUser(projectId, item.id, user.id, tx);
            await assertUniqueSiblingName(projectId, item.parentId ?? null, item.name, tx, item.id);
        }
        await tx.update(projectNodes)
            .set({ deletedAt: null, deletedBy: null, updatedAt: new Date() })
            .where(and(eq(projectNodes.projectId, projectId), inArray(projectNodes.id, restoreIds)));
        await realignRestoredRoot(tx, projectId, nodeId);
        await recordNodeEvent(projectId, user.id, nodeId, "restore", { restoredIds: restoreIds }, tx);
    });

    await enqueueFileNotificationBestEffort({
        projectId,
        actorUserId: user.id,
        ...actorNotificationSnapshot(user),
        eventKey: "files.deleted_restored",
        title: "File restored",
        body: "A project file or folder was restored.",
        sourceEventId: `${nodeId}:restore`,
        entityRefs: { projectId, fileId: nodeId },
    });
    // ponytail: client handles trash restore via query invalidation; skip route revalidation. ceiling: client query invalidation. upgrade: global cache invalidation bus if cross-device state sync required.
}

export async function bulkTrashNodes(nodeIds: string[], projectId: string, expectedVersions?: Record<string,string>) {
    const { user } = await requireAuthenticatedUser();
    if (!user) throw new Error("Unauthorized");
    const { allowed } = await consumeRateLimit(`files:${user.id}`, 60, 60);
    if (!allowed) throw new Error("Rate limit exceeded");
    await assertProjectWriteAccess(projectId, user.id);

    const uniqueIds = Array.from(new Set(nodeIds.filter(Boolean)));
    assertBulkLimit(uniqueIds);

    const now = new Date();
    const result = await db.transaction(async (tx) => {
        await assertProjectWriteAccessTx(tx, projectId, user.id);
        const nodes = await tx.query.projectNodes.findMany({
            where: and(eq(projectNodes.projectId, projectId), inArray(projectNodes.id, uniqueIds)),
            columns: { id: true, name: true, path: true, type: true, taskId: true, metadata: true, deletedAt: true, updatedAt:true },
        });
        if (nodes.length !== uniqueIds.length) {
            throw new Error("Some selected files are missing");
        }

        for (const node of nodes) {
            if(expectedVersions && expectedVersions[node.id] !== node.updatedAt.toISOString()) throw new Error("File changed elsewhere. Review before deleting.");
            await assertSubtreeNotLockedByAnotherUser(tx, projectId, node, user.id);
            const isSystemFolder =
                !!node.metadata && (node.metadata as { isSystem?: unknown }).isSystem === true;
            if (isSystemFolder) throw new Error(`Cannot delete system folder: ${node.name}`);
        }

        const toTrashNodes = nodes.filter((n) => !n.deletedAt);
        const toTrashIds = toTrashNodes.map((n) => n.id);
        const alreadyTrashedIds = nodes.filter((n) => !!n.deletedAt).map((n) => n.id);

        if (toTrashIds.length > 0) {
            const selectedFolders = toTrashNodes.filter((node) => node.type === "folder");
            const topLevelTrashNodes = toTrashNodes.filter((node) =>
                !selectedFolders.some((folder) =>
                    folder.id !== node.id && node.path.startsWith(`${folder.path}/`)
                )
            );
            const subtreePredicates = topLevelTrashNodes.map((node) => subtreePathPredicate(node));

            const affectedRows = await tx.update(projectNodes)
                .set({ deletedAt: now, deletedBy: user.id, updatedAt: now })
                .where(and(
                    eq(projectNodes.projectId, projectId),
                    isNull(projectNodes.deletedAt),
                    or(...subtreePredicates) ?? sql`FALSE`
                ))
                .returning({ id: projectNodes.id });
            const affectedIds = affectedRows.map((row) => row.id);

            if (affectedIds.length > 0) {
                await tx.delete(projectFileIndex).where(inArray(projectFileIndex.nodeId, affectedIds));
                await tx.delete(projectNodeLocks).where(inArray(projectNodeLocks.nodeId, affectedIds));
            }

            await tx.insert(projectNodeEvents).values(
                toTrashIds.map((nodeId) => ({
                    projectId,
                    nodeId,
                    actorId: user.id,
                    type: "trash",
                    metadata: { bulk: true },
                    createdAt: now,
                }))
            );

            return { trashedIds: affectedIds, selectedTrashedIds: toTrashIds, alreadyTrashedIds, deletedAt: now.toISOString() };
        }

        return { trashedIds: toTrashIds, selectedTrashedIds: toTrashIds, alreadyTrashedIds, deletedAt: now.toISOString() };
    });

    if (result.trashedIds.length > 0) {
        await enqueueFileNotificationBestEffort({
            projectId,
            actorUserId: user.id,
            ...actorNotificationSnapshot(user),
            eventKey: "files.deleted_restored",
            title: `${result.trashedIds.length} file${result.trashedIds.length === 1 ? "" : "s"} moved to trash`,
            body: "Project files were moved to trash.",
            aggregateCount: result.trashedIds.length,
            sourceEventId: `bulk-trash:${result.selectedTrashedIds.slice(0, 50).join(",")}:${result.trashedIds.length}`,
            entityRefs: { projectId },
        });
    }

    // ponytail: client handles trash purge via query invalidation; skip route revalidation. ceiling: client query invalidation. upgrade: global cache invalidation bus if cross-device state sync required.
    return result;
}

export async function bulkRestoreNodes(nodeIds: string[], projectId: string, expectedDeletedAt?: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");
    const { allowed } = await consumeRateLimit(`files:${user.id}`, 60, 60);
    if (!allowed) throw new Error("Rate limit exceeded");
    await assertProjectWriteAccess(projectId, user.id);

    const uniqueIds = Array.from(new Set(nodeIds.filter(Boolean)));
    assertBulkLimit(uniqueIds);

    const now = new Date();
    const result = await db.transaction(async (tx) => {
        await assertProjectWriteAccessTx(tx, projectId, user.id);
        const selectedNodes = await tx.query.projectNodes.findMany({
            where: and(eq(projectNodes.projectId, projectId), inArray(projectNodes.id, uniqueIds)),
            columns: { id: true, parentId: true, name: true, deletedAt: true, metadata: true },
        });
        if (selectedNodes.length !== uniqueIds.length) {
            throw new Error("Some selected files are missing");
        }
        if (expectedDeletedAt !== undefined && selectedNodes.some(node => node.deletedAt?.toISOString() !== expectedDeletedAt))
            throw new Error("These items changed since they were trashed. Review Trash before restoring them.");

        // Match single-folder restore: include only descendants deleted in
        // the same operation; explicitly selected older deletions still restore.
        const restoreScope = new Map(selectedNodes.map(node => [node.id, node]));
        for (const selected of selectedNodes.filter(node => !!node.deletedAt)) {
            const subtree = await readFileSubtree(tx, projectId, selected.id);
            for (const child of subtree) if (child.deletedAt?.getTime() === selected.deletedAt!.getTime()) restoreScope.set(child.id, child);
            if (restoreScope.size > 500) throw new Error("Restore up to 500 items at a time. Choose smaller folders.");
        }
        const nodes = [...restoreScope.values()];

        if (nodes.some((node) => node.metadata?.permanentDeleteRoot)) throw new Error("Permanent deletion is pending. This item cannot be restored.");
        await assertNodesNotLockedByAnotherUser(projectId, nodes.map((node) => node.id), user.id, tx);

        const toRestoreIds = nodes.filter((n) => !!n.deletedAt).map((n) => n.id);
        const alreadyActiveIds = nodes.filter((n) => !n.deletedAt).map((n) => n.id);
        const toRestoreSet = new Set(toRestoreIds);

        if (toRestoreIds.length > 0) {
            const siblingNameKeys = new Set<string>();
            const restoring = nodes.filter((n) => !!n.deletedAt);
            for (const node of restoring) {
                const siblingKey = `${node.parentId ?? "root"}:${node.name.toLowerCase()}`;
                if (siblingNameKeys.has(siblingKey)) {
                    throw new Error(`Duplicate name conflict in restore selection: ${node.name}`);
                }
                siblingNameKeys.add(siblingKey);
            }
            await assertUniqueSiblingNames(projectId, restoring.map((node) => ({ id: node.id, parentId: node.parentId ?? null, name: node.name })), tx);

            const parentIdsToCheck = Array.from(new Set(
                nodes
                    .filter((node) => !!node.deletedAt && node.parentId && !toRestoreSet.has(node.parentId))
                    .map((node) => node.parentId as string)
            ));
            if (parentIdsToCheck.length > 0) {
                const activeParents = await tx.query.projectNodes.findMany({
                    where: and(
                        eq(projectNodes.projectId, projectId),
                        inArray(projectNodes.id, parentIdsToCheck),
                        isNull(projectNodes.deletedAt)
                    ),
                    columns: { id: true, type: true },
                });
                const activeFolderParentIds = new Set(activeParents.filter((parent) => parent.type === "folder").map((parent) => parent.id));
                const missingParentId = parentIdsToCheck.find((parentId) => !activeFolderParentIds.has(parentId));
                if (missingParentId) {
                    throw new Error("Restore the parent folder before restoring this file");
                }
            }

            await tx.update(projectNodes)
                .set({ deletedAt: null, deletedBy: null, updatedAt: now })
                .where(and(eq(projectNodes.projectId, projectId), inArray(projectNodes.id, toRestoreIds)));
            for (const node of nodes) {
                if (node.deletedAt && !(node.parentId && toRestoreSet.has(node.parentId))) await realignRestoredRoot(tx, projectId, node.id);
            }

            await tx.insert(projectNodeEvents).values(
                toRestoreIds.map((nodeId) => ({
                    projectId,
                    nodeId,
                    actorId: user.id,
                    type: "restore",
                    metadata: { bulk: true },
                    createdAt: now,
                }))
            );
        }

        return { restoredIds: toRestoreIds, alreadyActiveIds };
    });

    if (result.restoredIds.length > 0) {
        await enqueueFileNotificationBestEffort({
            projectId,
            actorUserId: user.id,
            ...actorNotificationSnapshot(user),
            eventKey: "files.deleted_restored",
            title: `${result.restoredIds.length} file${result.restoredIds.length === 1 ? "" : "s"} restored`,
            body: "Project files were restored from trash.",
            aggregateCount: result.restoredIds.length,
            sourceEventId: `bulk-restore:${result.restoredIds.join(",")}`,
            entityRefs: { projectId },
        });
    }

    // ponytail: client handles trash restore via query invalidation; skip route revalidation. ceiling: client query invalidation. upgrade: global cache invalidation bus if cross-device state sync required.
    return result;
}


/** Paged trash browser; the legacy sidebar getter remains backward compatible. */
export async function getTrashPage(projectId: string, query = "", cursor?: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");
    await assertProjectWriteAccess(projectId, user.id);
    // Newest deletion first; the cursor is "<deleted_at as database text>~<id>" (exact microseconds).
    const [cursorAt, cursorId] = cursor?.split("~") ?? [];
    if (cursor && (!cursorId || !UUID_RE.test(cursorId) || !/^[0-9][0-9:. +\-]{9,39}$/.test(cursorAt ?? ""))) throw new Error("Invalid cursor");
    const search = query.trim();
    const rows = await db
        .select({
            node: projectNodes,
            cursorAt: sql<string>`${projectNodes.deletedAt}::text`,
            deletedByName: sql<string | null>`coalesce(${profiles.fullName}, ${profiles.username}, case when ${projectNodes.deletedBy} is not null then 'Former member' else null end)`,
            deletedByUsername: profiles.username,
            deletedByAvatarUrl: profiles.avatarUrl,
        })
        .from(projectNodes)
        .leftJoin(profiles, eq(profiles.id, projectNodes.deletedBy))
        .where(and(eq(projectNodes.projectId, projectId), isNotNull(projectNodes.deletedAt),
            search
                ? ilike(projectNodes.name, `%${escapeLikePattern(search.slice(0, 200))}%`)
                // Browsing lists what was trashed, not every descendant of a trashed folder.
                : sql`NOT EXISTS (SELECT 1 FROM project_nodes parent WHERE parent.id = ${projectNodes.parentId} AND parent.deleted_at IS NOT NULL)`,
            cursor ? sql`(${projectNodes.deletedAt}, ${projectNodes.id}) < (${cursorAt}::timestamptz, ${cursorId}::uuid)` : undefined))
        .orderBy(desc(projectNodes.deletedAt), desc(projectNodes.id))
        .limit(101);
    const page = rows.slice(0, 100);
    return {
        nodes: page.map(({ node, deletedByName, deletedByUsername, deletedByAvatarUrl }) => ({
            ...node,
            deletedByName,
            deletedByUsername,
            deletedByAvatarUrl,
        })),
        nextCursor: rows.length > 100 ? `${page.at(-1)!.cursorAt}~${page.at(-1)!.node.id}` : null,
    };
}

/** Legacy export kept safe: deletion now requires Trash and reviewed scope. */
export async function deleteNode(nodeId: string, projectId: string, expectedFingerprint: string) {
    return permanentlyDeleteTrashedNode(projectId, nodeId, expectedFingerprint);
}

export async function bulkCreateFolderTree(
    projectId: string,
    targetParentId: string | null,
    files: { path: string; name: string; size: number; mimeType: string }[]
) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");
    const { allowed } = await consumeRateLimit(`files:${user.id}`, 60, 60);
    if (!allowed) throw new Error("Rate limit exceeded");
    await assertProjectUploadAccess(projectId, user.id);

    if (files.length === 0) return [];
    if (files.length > 5000) throw new Error("Maximum 5000 files allowed per bulk upload block.");
    const normalizedFiles = files.map((file) => {
        const normalizedPath = normalizeAndValidateUploadRelativePath(file.path);
        const normalizedSize = normalizeAndValidateFileSize(file.size, PROJECT_UPLOAD_MAX_FILE_BYTES);
        const normalizedMimeType = normalizeAndValidateMimeType(file.mimeType);
        return {
            path: normalizedPath,
            name: file.name,
            size: normalizedSize,
            mimeType: normalizedMimeType,
        };
    });

    // 1. Parse all implicit folders from the file paths
    const folderPaths = new Set<string>();
    for (const f of normalizedFiles) {
        const parts = f.path.split('/');
        parts.pop(); // Remove the file name
        let cur = "";
        for (const p of parts) {
            cur = cur ? `${cur}/${p}` : p;
            folderPaths.add(cur);
        }
    }

    // Sort folders by depth so we create parents before children
    const sortedFolders = Array.from(folderPaths).sort((a, b) => a.split('/').length - b.split('/').length);

    const result = await db.transaction(async (tx) => {
        await assertProjectUploadAccessTx(tx, projectId, user.id);
        await assertValidParentFolder(projectId, targetParentId, tx);

        // Map: virtual path -> physical node ID
        const pathToId = new Map<string, string>();
        // Map: virtual path -> materialized node path (for DB `path` column)
        const pathToNodePath = new Map<string, string>();
        let targetBaseNodePath = "";
        if (targetParentId) {
            pathToId.set("", targetParentId);
            const parentPath = await getParentPath(tx, projectId, targetParentId);
            pathToNodePath.set("", parentPath);
            targetBaseNodePath = parentPath;
        } else {
            pathToNodePath.set("", "");
        }

        // Pre-fetch all folders that may already exist across all depth levels in 1 single query
        const allPossiblePaths = sortedFolders.map(fp => targetBaseNodePath ? `${targetBaseNodePath}/${fp}` : `/${fp}`);
        const existingFoldersByPath = new Map<string, { id: string; name: string; parentId: string | null; path: string }>();
        if (allPossiblePaths.length > 0) {
            const found = await tx.query.projectNodes.findMany({
                where: and(
                    eq(projectNodes.projectId, projectId),
                    eq(projectNodes.type, 'folder'),
                    isNull(projectNodes.deletedAt),
                    // Sibling names are unique case-insensitively, so `docs/` must land in an existing `Docs`.
                    inArray(sql`lower(${projectNodes.path})`, allPossiblePaths.map((path) => path.toLowerCase()))
                ),
                columns: { id: true, name: true, parentId: true, path: true }
            });
            for (const f of found) {
                existingFoldersByPath.set(f.path.toLowerCase(), f);
            }
        }

        // 2. Resolve / Create all folders layer by layer (Strict O(Depth) operations)
        const foldersByDepth: Record<number, string[]> = {};
        for (const folderPath of sortedFolders) {
            const depth = folderPath.split('/').length;
            if (!foldersByDepth[depth]) foldersByDepth[depth] = [];
            foldersByDepth[depth].push(folderPath);
        }
        const maxDepth = Math.max(0, ...Object.keys(foldersByDepth).map(Number));

        for (let depth = 1; depth <= maxDepth; depth++) {
            const paths = foldersByDepth[depth];
            if (!paths || paths.length === 0) continue;

            const nodesToFindOrCreate = paths.map(path => {
                const parts = path.split('/');
                const name = parts[parts.length - 1];
                const safeName = normalizeNodeName(name!);
                assertValidNodeName(safeName);
                const parentVirtualPath = parts.slice(0, -1).join('/');
                const parentId = targetParentId
                    ? (parentVirtualPath ? pathToId.get(parentVirtualPath) : targetParentId)
                    : (parentVirtualPath ? pathToId.get(parentVirtualPath) : null);
                return { path, safeName, parentId: parentId || null };
            });

            const newFolderInserts: (typeof projectNodes.$inferInsert)[] = [];
            const newFolderPaths: string[] = [];
            const pendingByLowerPath = new Map<string, string>();
            const sameFolderAs: [string, string][] = [];

            for (const node of nodesToFindOrCreate) {
                const parentVirtualPath = node.path.split('/').slice(0, -1).join('/');
                const parentNodePath = pathToNodePath.get(parentVirtualPath) || "";
                const nodePath = `${parentNodePath}/${node.safeName}`;
                const existing = existingFoldersByPath.get(nodePath.toLowerCase());
                const pending = pendingByLowerPath.get(nodePath.toLowerCase());
                if (existing) {
                    pathToId.set(node.path, existing.id);
                    pathToNodePath.set(node.path, existing.path || nodePath);
                } else if (pending) {
                    // `A/` and `a/` in one upload are one folder.
                    sameFolderAs.push([node.path, pending]);
                    pathToNodePath.set(node.path, pathToNodePath.get(pending)!);
                } else {
                    pendingByLowerPath.set(nodePath.toLowerCase(), node.path);
                    newFolderInserts.push({
                        projectId,
                        parentId: node.parentId,
                        type: 'folder',
                        name: node.safeName,
                        path: nodePath,
                        createdBy: user.id
                    });
                    newFolderPaths.push(node.path);
                    pathToNodePath.set(node.path, nodePath);
                }
            }

            if (newFolderInserts.length > 0) {
                const chunkSize = 500;
                for (let i = 0; i < newFolderInserts.length; i += chunkSize) {
                    const chunk = newFolderInserts.slice(i, i + chunkSize);
                    const inserted = await tx.insert(projectNodes).values(chunk).returning({ id: projectNodes.id });
                    for (let j = 0; j < chunk.length; j++) {
                        pathToId.set(newFolderPaths[i + j]!, inserted[j]!.id);
                    }
                }
            }
            for (const [path, twin] of sameFolderAs) pathToId.set(path, pathToId.get(twin)!);
        }

        // Return publication targets only. File rows are created after their
        // exact server-allocated assets have been uploaded and verified.
        const resultMappings: {
            path: string;
            parentId: string | null;
            requestKey: string;
            name: string;
        }[] = [];

        for (const f of normalizedFiles) {
            const parts = f.path.split('/');
            const name = parts.pop() || "unknown";
            const safeName = normalizeNodeName(name);
            assertValidNodeName(safeName);
            const parentVirtualPath = parts.join('/');

            const parentId = targetParentId ? (parentVirtualPath ? pathToId.get(parentVirtualPath) : targetParentId) : (parentVirtualPath ? pathToId.get(parentVirtualPath) : null);
            resultMappings.push({
                path: f.path,
                parentId: parentId || null,
                requestKey: buildProjectFileKey(projectId, f.path),
                name: safeName,
            });
        }

        return resultMappings;
    });
    return result;
}

export async function getOrCreateTaskSystemFolderAction(projectId: string, taskId: string): Promise<string> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");
    if (!UUID_RE.test(projectId) || !UUID_RE.test(taskId)) throw new Error("Task not found");
    await assertProjectUploadAccess(projectId, user.id, { taskId });

    return await db.transaction(async (tx) => {
        const [task] = await tx.select({ id: tasks.id }).from(tasks)
            .where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId), isNull(tasks.deletedAt))).limit(1);
        if (!task) throw new Error("Task not found");
        // The live sibling-name indexes are expression indexes (COALESCE/lower), so no ON CONFLICT
        // target matches them: serialize per project and select-then-insert, as ensureSystemRootFolder does.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`files-task-system-folder:${projectId}`}))`);
        const ensureFolder = async (parentId: string | null, name: string, path: string) => {
            const [existing] = await tx.select({ id: projectNodes.id }).from(projectNodes).where(and(
                eq(projectNodes.projectId, projectId),
                parentId ? eq(projectNodes.parentId, parentId) : isNull(projectNodes.parentId),
                sql`lower(${projectNodes.name}) = lower(${name})`,
                isNull(projectNodes.deletedAt),
            )).limit(1);
            if (existing) return existing.id;
            const [created] = await tx.insert(projectNodes).values({
                projectId, parentId, type: "folder", name, path, createdBy: user.id, metadata: { isSystem: true },
            }).returning({ id: projectNodes.id });
            return created!.id;
        };
        const systemId = await ensureFolder(null, ".system", "/.system");
        const tasksId = await ensureFolder(systemId, "tasks", "/.system/tasks");
        return ensureFolder(tasksId, taskId, `/.system/tasks/${taskId}`);
    });
}

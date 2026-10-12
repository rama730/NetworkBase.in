import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors/domain";
import { projectEventCounters, projectMembers, projectNodeEvents, projectNodeLocks, projectNodes, projects, tasks } from "@/lib/db/schema";
import { assertProjectTabReadAccess, canReadProjectTab, getProjectAccessById, type ProjectAccess } from "@/lib/data/project-access";
import { eq, and, isNull, sql, ne, gt, type SQL } from "drizzle-orm";
import { isWithParent } from "@/app/actions/files/_constants";
import { requireProjectCapability } from "@/lib/projects/collaborator-lifecycle";
import { canProjectMemberUploadFiles, projectMemberCan } from "@/lib/projects/settings-policies";

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type ExistingProjectAccess = ProjectAccess & { project: NonNullable<ProjectAccess["project"]> };

async function getProjectAccess(projectId: string, userId: string | null): Promise<ExistingProjectAccess> {
    const access = await getProjectAccessById(projectId, userId);
    if (!access.project) throw new NotFoundError("Project not found");
    return access as ExistingProjectAccess;
}

export async function assertProjectReadAccess(projectId: string, userId: string | null) {
    const access = await getProjectAccess(projectId, userId);
    if (!access.canRead) throw new ForbiddenError("Forbidden");
    return access;
}

export async function assertProjectFileReadAccess(projectId: string, userId: string | null) {
    return assertProjectTabReadAccess(projectId, userId, "files");
}

/** Files visibility does not implicitly publish task-only attachments. */
export function canReadProjectTaskFiles(access: ExistingProjectAccess): boolean {
    return canReadProjectTab(access, "tasks");
}

/** SQL: ordinary project content, i.e. not owned by a task and not under /.system. */
export const projectContentNodeSql = sql`${projectNodes.taskId} IS NULL AND ${projectNodes.path} NOT LIKE '/.system%'`;

/** Listing filter for file readers: task-file readers see all nodes, everyone else project content only. */
export function visibleFileNodesSql(access: ExistingProjectAccess): SQL | undefined {
    return canReadProjectTaskFiles(access) ? undefined : projectContentNodeSql;
}

export function assertTaskFileNodeVisible(access: ExistingProjectAccess, node: { taskId?: string | null; path?: string | null; deletedAt?: unknown }) {
    if (node.deletedAt) throw new NotFoundError("File not found");
    if ((node.taskId || node.path?.startsWith("/.system/")) && !canReadProjectTaskFiles(access)) {
        throw new ForbiddenError("Task files are not available to this viewer.");
    }
}

export async function assertProjectWriteAccess(projectId: string, userId: string) {
    const access = await getProjectAccess(projectId, userId);
    if (!access.canWrite) throw new ForbiddenError("Forbidden");
    await requireProjectCapability(projectId, userId, "upload_files");
    return { ...access, canWrite: true };
}

export async function assertProjectManageFilesAccess(projectId: string, userId: string) {
    const access = await getProjectAccess(projectId, userId);
    if (!access.canWrite) throw new ForbiddenError("Forbidden");
    await requireProjectCapability(projectId, userId, "manage_files");
    return { ...access, canManageFiles: true };
}

export async function assertProjectUploadAccess(projectId: string, userId: string) {
    const access = await getProjectAccess(projectId, userId);
    if (access.isOwner) return { ...access, canUpload: true };
    const [member] = access.isMember
        ? await db
            .select({ fileUploadEnabled: projectMembers.fileUploadEnabled })
            .from(projectMembers)
            .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
            .limit(1)
        : [];
    if (!canProjectMemberUploadFiles({ role: access.memberRole, fileUploadEnabled: member?.fileUploadEnabled ?? null })) {
        throw new ForbiddenError("File uploads are disabled for this project member.");
    }
    return { ...access, canUpload: true };
}

export async function assertProjectWriteAccessTx(
    tx: DbTransaction,
    projectId: string,
    userId: string,
): Promise<{ project: { id: string; ownerId: string; visibility: string | null }; isOwner: boolean }> {
    const projectResult = await tx.execute<{
        id: string;
        owner_id: string;
        visibility: string | null;
        deleted_at: Date | string | null;
    }>(sql`
        SELECT id, owner_id, visibility, deleted_at
        FROM projects
        WHERE id = ${projectId}
        FOR UPDATE
    `);
    const project = Array.from(projectResult)[0];
    if (!project || project.deleted_at) {
        throw new ForbiddenError("Forbidden");
    }

    const isOwner = project.owner_id === userId;
    if (isOwner) {
        return {
            project: { id: project.id, ownerId: project.owner_id, visibility: project.visibility },
            isOwner: true,
        };
    }

    const memberResult = await tx.execute<{ role: string | null }>(sql`
        SELECT role
        FROM project_members
        WHERE project_id = ${projectId}
          AND user_id = ${userId}
        FOR UPDATE
    `);
    const member = Array.from(memberResult)[0];
    if (!member) {
        throw new ForbiddenError("Forbidden");
    }
    if (!projectMemberCan(member.role, "upload_files")) {
        throw new ForbiddenError("Forbidden");
    }

    return {
        project: { id: project.id, ownerId: project.owner_id, visibility: project.visibility },
        isOwner: false,
    };
}

export async function assertProjectManageFilesAccessTx(
    tx: DbTransaction,
    projectId: string,
    userId: string,
): Promise<{ project: { id: string; ownerId: string; visibility: string | null }; isOwner: boolean }> {
    const projectResult = await tx.execute<{
        id: string;
        owner_id: string;
        visibility: string | null;
        deleted_at: Date | string | null;
    }>(sql`
        SELECT id, owner_id, visibility, deleted_at
        FROM projects
        WHERE id = ${projectId}
        FOR UPDATE
    `);
    const project = Array.from(projectResult)[0];
    if (!project || project.deleted_at) throw new ForbiddenError("Forbidden");
    if (project.owner_id === userId) {
        return {
            project: { id: project.id, ownerId: project.owner_id, visibility: project.visibility },
            isOwner: true,
        };
    }

    const memberResult = await tx.execute<{ role: string | null }>(sql`
        SELECT role
        FROM project_members
        WHERE project_id = ${projectId}
          AND user_id = ${userId}
        FOR UPDATE
    `);
    const member = Array.from(memberResult)[0];
    if (!member || !projectMemberCan(member.role, "manage_files")) throw new ForbiddenError("Forbidden");
    return {
        project: { id: project.id, ownerId: project.owner_id, visibility: project.visibility },
        isOwner: false,
    };
}

export async function assertProjectUploadAccessTx(
    tx: DbTransaction,
    projectId: string,
    userId: string,
): Promise<{ project: { id: string; ownerId: string; visibility: string | null }; isOwner: boolean }> {
    const projectResult = await tx.execute<{
        id: string;
        owner_id: string;
        visibility: string | null;
        deleted_at: Date | string | null;
    }>(sql`
        SELECT id, owner_id, visibility, deleted_at
        FROM projects
        WHERE id = ${projectId}
        FOR UPDATE
    `);
    const project = Array.from(projectResult)[0];
    if (!project || project.deleted_at) {
        throw new ForbiddenError("Forbidden");
    }

    const isOwner = project.owner_id === userId;
    if (isOwner) {
        return {
            project: { id: project.id, ownerId: project.owner_id, visibility: project.visibility },
            isOwner: true,
        };
    }

    const memberResult = await tx.execute<{ role: string | null; file_upload_enabled: boolean | null }>(sql`
        SELECT role, file_upload_enabled
        FROM project_members
        WHERE project_id = ${projectId}
          AND user_id = ${userId}
        FOR UPDATE
    `);
    const member = Array.from(memberResult)[0];
    if (!member || !canProjectMemberUploadFiles({ role: member.role, fileUploadEnabled: member.file_upload_enabled })) {
        throw new ForbiddenError("File uploads are disabled for this project member.");
    }

    return {
        project: { id: project.id, ownerId: project.owner_id, visibility: project.visibility },
        isOwner: false,
    };
}

export async function getTaskProjectId(taskId: string): Promise<string> {
    const rows = await db
        .select({ projectId: tasks.projectId })
        .from(tasks)
        .where(eq(tasks.id, taskId))
        .limit(1);

    const projectId = rows[0]?.projectId;
    if (!projectId) throw new NotFoundError("Task not found");
    return projectId;
}

export async function ensureSystemRootFolder(projectId: string, userId: string, fallbackName: string) {
    return await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`files-system-root:${projectId}`}))`);

        const existing = await tx.query.projectNodes.findFirst({
            where: and(
                eq(projectNodes.projectId, projectId),
                isNull(projectNodes.parentId),
                eq(projectNodes.type, "folder"),
                isNull(projectNodes.deletedAt),
                sql`coalesce(${projectNodes.metadata}->>'isSystem', 'false') = 'true'`
            ),
        });
        if (existing) return existing;

        const [created] = await tx
            .insert(projectNodes)
            .values({
                projectId,
                parentId: null,
                type: "folder",
                name: fallbackName,
                createdBy: userId,
                metadata: { isSystem: true },
                createdAt: new Date(),
                updatedAt: new Date(),
            })
            .returning();
        return created;
    });
}

export async function assertNodeNotLockedByAnotherUser(
    projectId: string,
    nodeId: string,
    userId: string,
    tx: { query: typeof db.query } = db
) {
    const now = new Date();
    const lock = await tx.query.projectNodeLocks.findFirst({
        where: and(
            eq(projectNodeLocks.projectId, projectId),
            eq(projectNodeLocks.nodeId, nodeId),
            ne(projectNodeLocks.lockedBy, userId),
            gt(projectNodeLocks.expiresAt, now)
        ),
        columns: { lockedBy: true, expiresAt: true },
    });

    if (lock) {
        throw new ConflictError("File has an active editing lease");
    }
}

export async function assertValidParentFolder(projectId: string, parentId: string | null, tx: { query: typeof db.query } = db) {
    if (!parentId) return null;
    const parent = await tx.query.projectNodes.findFirst({
        where: and(
            eq(projectNodes.id, parentId),
            eq(projectNodes.projectId, projectId),
            isNull(projectNodes.deletedAt)
        ),
        columns: { id: true, type: true, parentId: true, path: true, taskId: true, metadata: true }
    });
    if (!parent) throw new NotFoundError("Destination folder not found");
    if (parent.type !== 'folder') throw new Error("Destination must be a folder");
    return parent;
}

export async function assertValidMoveDestination(
    projectId: string,
    parentId: string | null,
    sourceTaskId: string | null,
    tx: { query: typeof db.query } = db,
) {
    if (sourceTaskId) {
        throw new Error("Task working files must be published to Project Files before they can be relocated");
    }
    const parent = await assertValidParentFolder(projectId, parentId, tx);
    if (!parent) return null;
    const isSystem =
        parent.path === "/.system" ||
        parent.path.startsWith("/.system/") ||
        (parent.metadata as { isSystem?: unknown } | null)?.isSystem === true;
    if (isSystem || parent.taskId) {
        throw new Error("The internal task workspace cannot be used as a destination");
    }
    return parent;
}

export async function assertUniqueSiblingName(
    projectId: string,
    parentId: string | null,
    name: string,
    tx: { query: typeof db.query } = db,
    ignoreNodeId?: string
) {
    const conditions: SQL[] = [
        eq(projectNodes.projectId, projectId),
        isWithParent(parentId),
        isNull(projectNodes.deletedAt),
        sql`lower(${projectNodes.name}) = lower(${name})`,
    ];
    if (ignoreNodeId) {
        conditions.push(ne(projectNodes.id, ignoreNodeId));
    }

    const duplicate = await tx.query.projectNodes.findFirst({
        where: and(...conditions),
        columns: { id: true },
    });

    if (duplicate) {
        throw new ConflictError("A file/folder with this name already exists in this location");
    }
}

export async function assertNotMovingIntoDescendant(
    projectId: string,
    nodeId: string,
    targetParentId: string | null,
    tx: any = db
) {
    if (!targetParentId) return;
    if (targetParentId === nodeId) {
        throw new Error("Cannot move a folder into itself or its descendant");
    }

    // PURE OPTIMIZATION (Item 24): Single recursive CTE checks entire ancestry chain in 1 round-trip instead of N queries in a loop.
    const result = (await tx.execute(sql`
        WITH RECURSIVE ancestors AS (
            SELECT id, parent_id, 1 AS depth
            FROM project_nodes
            WHERE id = ${targetParentId}::uuid
              AND project_id = ${projectId}::uuid
              AND deleted_at IS NULL
            UNION ALL
            SELECT p.id, p.parent_id, a.depth + 1
            FROM project_nodes p
            JOIN ancestors a ON p.id = a.parent_id
            WHERE p.project_id = ${projectId}::uuid
              AND p.deleted_at IS NULL
              AND a.depth < 256
        )
        SELECT id, depth FROM ancestors
    `)) as Array<{ id: string; depth: number }>;

    const ancestry = Array.from(result);
    if (ancestry.length === 0) {
        throw new NotFoundError("Destination folder not found");
    }

    const visited = new Set<string>();
    for (const row of ancestry) {
        const cursor = row.id;
        const depth = row.depth;
        if (depth >= 256 || visited.has(cursor)) {
            throw new Error("Folder hierarchy is inconsistent; move cancelled");
        }
        visited.add(cursor);
        if (cursor === nodeId) {
            throw new Error("Cannot move a folder into itself or its descendant");
        }
    }
}

export async function recordNodeEvent(
    projectId: string,
    actorId: string | null,
    nodeId: string | null,
    type: string,
    metadata: Record<string, unknown> = {},
    clientTx?: DbTransaction
) {
    const run = async (tx: any) => {
        const [counter] = await tx
            .insert(projectEventCounters)
            .values({ projectId, nextSequence: 1 })
            .onConflictDoUpdate({
                target: projectEventCounters.projectId,
                set: {
                    nextSequence: sql`${projectEventCounters.nextSequence} + 1`,
                    updatedAt: new Date(),
                },
            })
            .returning({
                newSequenceNumber: projectEventCounters.nextSequence,
            });

        if (!counter) {
            throw new Error(`Project ${projectId} not found`);
        }

        const [event] = await tx
            .insert(projectNodeEvents)
            .values({
                projectId,
                actorId,
                nodeId,
                type,
                sequenceNumber: counter.newSequenceNumber,
                metadata,
                createdAt: new Date(),
            })
            .returning();

        return { sequenceNumber: counter.newSequenceNumber, event };
    };

    if (clientTx) {
        return await run(clientTx);
    }
    return await db.transaction(async (tx) => {
        return await run(tx);
    });
}

export async function recordNodeEventsBatch(
    projectId: string,
    actorId: string | null,
    nodeIds: (string | null)[],
    type: string,
    metadata: Record<string, unknown> | Record<string, unknown>[] = {},
    clientTx?: DbTransaction
) {
    const run = async (tx: any) => {
        const count = Math.max(1, nodeIds.length);
        const [counter] = await tx
            .insert(projectEventCounters)
            .values({ projectId, nextSequence: count })
            .onConflictDoUpdate({
                target: projectEventCounters.projectId,
                set: {
                    nextSequence: sql`${projectEventCounters.nextSequence} + ${count}`,
                    updatedAt: new Date(),
                },
            })
            .returning({
                newSequenceNumber: projectEventCounters.nextSequence,
            });

        if (!counter) {
            throw new Error(`Project ${projectId} not found`);
        }

        const startSeq = Number(counter.newSequenceNumber) - count;
        const now = new Date();
        const targets = nodeIds.length > 0 ? nodeIds : [null];
        const values = targets.map((nodeId, idx) => ({
            projectId,
            actorId,
            nodeId,
            type,
            sequenceNumber: startSeq + idx + 1,
            metadata: Array.isArray(metadata) ? metadata[idx] ?? {} : metadata,
            createdAt: now,
        }));

        await tx.insert(projectNodeEvents).values(values);
        return { sequenceNumber: counter.newSequenceNumber };
    };

    if (clientTx) {
        return await run(clientTx);
    }
    return await db.transaction(async (tx) => {
        return await run(tx);
    });
}

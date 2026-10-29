import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors/domain";
import { workspaceEventCounters, workspaceMembers, workspaceNodeEvents, workspaceNodeLocks, workspaceNodes, workspaces, tasks } from "@/lib/db/schema";
import { assertWorkspaceTabReadAccess, canReadWorkspaceTab, getWorkspaceAccessById, type WorkspaceAccess } from "@/lib/data/workspace-access";
import { eq, and, isNull, sql, ne, gt, type SQL } from "drizzle-orm";
import { isWithParent } from "@/app/actions/files/_constants";
import { requireWorkspaceCapability } from "@/lib/workspaces/collaborator-lifecycle";
import { canWorkspaceMemberUploadFiles, projectMemberCan } from "@/lib/workspaces/settings-policies";

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type ExistingProjectAccess = WorkspaceAccess & { project: NonNullable<WorkspaceAccess["project"]> };

async function getProjectAccess(projectId: string, userId: string | null): Promise<ExistingProjectAccess> {
    const access = await getWorkspaceAccessById(projectId, userId);
    if (!access.project) throw new NotFoundError("Workspace not found");
    return access as ExistingProjectAccess;
}

export async function assertWorkspaceReadAccess(projectId: string, userId: string | null) {
    const access = await getProjectAccess(projectId, userId);
    if (!access.canRead) throw new ForbiddenError("You don’t have access to this");
    return access;
}

export async function assertWorkspaceFileReadAccess(projectId: string, userId: string | null) {
    return assertWorkspaceTabReadAccess(projectId, userId, "files");
}

/** Files visibility does not implicitly publish task-only attachments. */
export function canReadWorkspaceTaskFiles(access: ExistingProjectAccess): boolean {
    return canReadWorkspaceTab(access, "tasks");
}

/** SQL: ordinary project content, i.e. not owned by a task and not under /.system. */
export const projectContentNodeSql = sql`${workspaceNodes.taskId} IS NULL AND ${workspaceNodes.path} NOT LIKE '/.system%'`;

type NodeRef = { projectId: SQL | typeof workspaceNodes.projectId; path: SQL | typeof workspaceNodes.path; taskId: SQL | typeof workspaceNodes.taskId };
const NODE_COLUMNS: NodeRef = { projectId: workspaceNodes.projectId, path: workspaceNodes.path, taskId: workspaceNodes.taskId };

/**
 * Org Files (report §23.3, §23.5), mirroring app_private.nb_org_node_access_ok (0247): in an organization,
 * members and guests never see Admins-only folders or other people's assignment copies, and visitors see only
 * what sits under a Public folder. Owners and admins see everything. Other projects: no extra rule.
 */
type OrgFileViewer = Pick<WorkspaceAccess, "isOwner" | "isMember" | "memberRole" | "viewerId"> & { project: { kind?: string | null } | null };

export function orgFileAccessSql(access: OrgFileViewer, node: NodeRef = NODE_COLUMNS): SQL | undefined {
    if (access.project?.kind !== "organization" || access.isOwner || access.memberRole === "admin") return undefined;
    const viewerId = access.viewerId ?? null;
    const marked = (level: "admins" | "members" | "public") => sql`EXISTS (
        SELECT 1 FROM workspace_nodes nb_f
        WHERE nb_f.workspace_id = ${node.projectId} AND nb_f.type = 'folder' AND nb_f.deleted_at IS NULL
          AND nb_f.metadata->>'access' = ${level}
          AND (${node.path} = nb_f.path OR starts_with(${node.path}, nb_f.path || '/'))
    )`;
    // Decision-19 read rule for task files: masters, and copies the viewer holds or shares as a team.
    // Aliases are unusual on purpose: callers pass outer columns such as t.id or n.path.
    const taskVisible = sql`(${node.taskId} IS NULL OR EXISTS (
        SELECT 1 FROM tasks nb_vt WHERE nb_vt.id = ${node.taskId} AND (
            (nb_vt.kind = 'assignment' AND nb_vt.assignment_id IS NULL)
            OR nb_vt.assignee_id = ${viewerId}
            OR EXISTS (SELECT 1 FROM task_team_members nb_tm WHERE nb_tm.task_id = nb_vt.id AND nb_tm.user_id = ${viewerId})
        )
    ))`;
    const inside = access.isOwner || access.isMember;
    return and(
        taskVisible,
        sql`NOT ${marked("admins")}`,
        inside ? undefined : and(marked("public"), sql`NOT ${marked("members")}`),
    );
}

/** Listing filter for file readers: task-file readers see all nodes, everyone else project content only. */
export function visibleFileNodesSql(access: ExistingProjectAccess): SQL | undefined {
    return and(canReadWorkspaceTaskFiles(access) ? undefined : projectContentNodeSql, orgFileAccessSql(access));
}

export function assertTaskFileNodeVisible(access: ExistingProjectAccess, node: { taskId?: string | null; path?: string | null; deletedAt?: unknown }) {
    if (node.deletedAt) throw new NotFoundError("File not found");
    if ((node.taskId || node.path?.startsWith("/.system/")) && !canReadWorkspaceTaskFiles(access)) {
        throw new ForbiddenError("Task files are not available to this viewer.");
    }
}

/** One file or folder by its row: task-file visibility plus the org rule. Hidden org files read as "not found" (§23.9 #3). */
export async function assertFileNodeVisible(access: ExistingProjectAccess, node: { taskId?: string | null; path?: string | null; deletedAt?: unknown }) {
    assertTaskFileNodeVisible(access, node);
    if (!orgFileAccessSql(access)) return;
    if (typeof node.path !== "string") throw new NotFoundError("File not found"); // fail closed without a path
    const rule = orgFileAccessSql(access, {
        projectId: sql`${access.project.id}::uuid`,
        path: sql`${node.path}::text`,
        taskId: sql`${node.taskId ?? null}::uuid`,
    })!;
    const [row] = Array.from(await db.execute<{ ok: boolean }>(sql`SELECT (${rule}) AS ok`));
    if (!row?.ok) throw new NotFoundError("File not found");
}

type OwnCopyTarget = { taskId?: string | null; nodeId?: string | null; anyOwnCopy?: boolean };
type Executor = typeof db | DbTransaction;

/**
 * In an organization only owners and admins write the org tree (report §23.4). Members and guests may add
 * files to their own assignment copy (or their team's), even with the upload switch off (§23.5).
 */
async function assertOrgWrite(executor: Executor, projectId: string, userId: string, isAdmin: boolean, target: OwnCopyTarget = {}) {
    if (isAdmin) return;
    const taskScope = target.anyOwnCopy
        ? sql`true`
        : target.taskId
            ? sql`t.id = ${target.taskId}::uuid`
            : target.nodeId
                ? sql`t.id = (SELECT n.task_id FROM workspace_nodes n WHERE n.id = ${target.nodeId}::uuid AND n.workspace_id = ${projectId}::uuid)`
                : sql`false`;
    const rows = Array.from(await executor.execute<{ id: string }>(sql`
        SELECT t.id FROM tasks t
        WHERE t.workspace_id = ${projectId}::uuid AND t.deleted_at IS NULL AND t.assignment_id IS NOT NULL AND ${taskScope}
          AND (t.assignee_id = ${userId}::uuid OR EXISTS (SELECT 1 FROM task_team_members tm WHERE tm.task_id = t.id AND tm.user_id = ${userId}::uuid))
        LIMIT 1
    `));
    if (rows.length === 0) throw new ForbiddenError("Only organization owners and admins can change the organization’s files.");
}

export async function assertWorkspaceWriteAccess(projectId: string, userId: string, target?: OwnCopyTarget) {
    const access = await getProjectAccess(projectId, userId);
    if (!access.canWrite) throw new ForbiddenError("You don’t have access to this");
    if (access.project.kind === "organization") await assertOrgWrite(db, projectId, userId, access.isOwner || access.memberRole === "admin", target);
    await requireWorkspaceCapability(projectId, userId, "upload_files");
    return { ...access, canWrite: true };
}

export async function assertWorkspaceManageFilesAccess(projectId: string, userId: string) {
    const access = await getProjectAccess(projectId, userId);
    if (!access.canWrite) throw new ForbiddenError("You don’t have access to this");
    if (access.project.kind === "organization") await assertOrgWrite(db, projectId, userId, access.isOwner || access.memberRole === "admin");
    await requireWorkspaceCapability(projectId, userId, "manage_files");
    return { ...access, canManageFiles: true };
}

export async function assertWorkspaceUploadAccess(projectId: string, userId: string, target?: OwnCopyTarget) {
    const access = await getProjectAccess(projectId, userId);
    if (access.isOwner) return { ...access, canUpload: true };
    if (access.project.kind === "organization") {
        if (!access.isMember) throw new ForbiddenError("You don’t have access to this");
        await assertOrgWrite(db, projectId, userId, access.memberRole === "admin", target);
        return { ...access, canUpload: true };
    }
    const [member] = access.isMember
        ? await db
            .select({ fileUploadEnabled: workspaceMembers.fileUploadEnabled })
            .from(workspaceMembers)
            .where(and(eq(workspaceMembers.projectId, projectId), eq(workspaceMembers.userId, userId)))
            .limit(1)
        : [];
    if (!canWorkspaceMemberUploadFiles({ role: access.memberRole, fileUploadEnabled: member?.fileUploadEnabled ?? null })) {
        throw new ForbiddenError("File uploads are disabled for this workspace member.");
    }
    return { ...access, canUpload: true };
}

export async function assertWorkspaceWriteAccessTx(
    tx: DbTransaction,
    projectId: string,
    userId: string,
    target?: OwnCopyTarget,
): Promise<{ project: { id: string; ownerId: string; visibility: string | null }; isOwner: boolean }> {
    const projectResult = await tx.execute<{
        id: string;
        owner_id: string;
        visibility: string | null;
        deleted_at: Date | string | null;
        kind: string;
    }>(sql`
        SELECT id, owner_id, visibility, deleted_at, kind
        FROM workspaces
        WHERE id = ${projectId}
        FOR UPDATE
    `);
    const project = Array.from(projectResult)[0];
    if (!project || project.deleted_at) {
        throw new ForbiddenError("You don’t have access to this");
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
        FROM workspace_members
        WHERE workspace_id = ${projectId}
          AND user_id = ${userId}
        FOR UPDATE
    `);
    const member = Array.from(memberResult)[0];
    if (!member) {
        throw new ForbiddenError("You don’t have access to this");
    }
    if (project.kind === "organization") {
        await assertOrgWrite(tx, projectId, userId, member.role === "admin", target);
    } else if (!projectMemberCan(member.role, "upload_files")) {
        throw new ForbiddenError("You don’t have access to this");
    }

    return {
        project: { id: project.id, ownerId: project.owner_id, visibility: project.visibility },
        isOwner: false,
    };
}

export async function assertWorkspaceManageFilesAccessTx(
    tx: DbTransaction,
    projectId: string,
    userId: string,
): Promise<{ project: { id: string; ownerId: string; visibility: string | null }; isOwner: boolean }> {
    const projectResult = await tx.execute<{
        id: string;
        owner_id: string;
        visibility: string | null;
        deleted_at: Date | string | null;
        kind: string;
    }>(sql`
        SELECT id, owner_id, visibility, deleted_at, kind
        FROM workspaces
        WHERE id = ${projectId}
        FOR UPDATE
    `);
    const project = Array.from(projectResult)[0];
    if (!project || project.deleted_at) throw new ForbiddenError("You don’t have access to this");
    if (project.owner_id === userId) {
        return {
            project: { id: project.id, ownerId: project.owner_id, visibility: project.visibility },
            isOwner: true,
        };
    }

    const memberResult = await tx.execute<{ role: string | null }>(sql`
        SELECT role
        FROM workspace_members
        WHERE workspace_id = ${projectId}
          AND user_id = ${userId}
        FOR UPDATE
    `);
    const member = Array.from(memberResult)[0];
    if (!member || !projectMemberCan(member.role, "manage_files")) throw new ForbiddenError("You don’t have access to this");
    if (project.kind === "organization") await assertOrgWrite(tx, projectId, userId, member.role === "admin");
    return {
        project: { id: project.id, ownerId: project.owner_id, visibility: project.visibility },
        isOwner: false,
    };
}

export async function assertWorkspaceUploadAccessTx(
    tx: DbTransaction,
    projectId: string,
    userId: string,
    target?: OwnCopyTarget,
): Promise<{ project: { id: string; ownerId: string; visibility: string | null }; isOwner: boolean }> {
    const projectResult = await tx.execute<{
        id: string;
        owner_id: string;
        visibility: string | null;
        deleted_at: Date | string | null;
        kind: string;
    }>(sql`
        SELECT id, owner_id, visibility, deleted_at, kind
        FROM workspaces
        WHERE id = ${projectId}
        FOR UPDATE
    `);
    const project = Array.from(projectResult)[0];
    if (!project || project.deleted_at) {
        throw new ForbiddenError("You don’t have access to this");
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
        FROM workspace_members
        WHERE workspace_id = ${projectId}
          AND user_id = ${userId}
        FOR UPDATE
    `);
    const member = Array.from(memberResult)[0];
    if (project.kind === "organization") {
        if (!member) throw new ForbiddenError("You don’t have access to this");
        await assertOrgWrite(tx, projectId, userId, member.role === "admin", target);
    } else if (!member || !canWorkspaceMemberUploadFiles({ role: member.role, fileUploadEnabled: member.file_upload_enabled })) {
        throw new ForbiddenError("File uploads are disabled for this workspace member.");
    }

    return {
        project: { id: project.id, ownerId: project.owner_id, visibility: project.visibility },
        isOwner: false,
    };
}

export async function getTaskWorkspaceId(taskId: string): Promise<string> {
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
    // Fast-path read check without transaction or advisory lock
    const fastExisting = await db.query.workspaceNodes.findFirst({
        where: and(
            eq(workspaceNodes.projectId, projectId),
            isNull(workspaceNodes.parentId),
            eq(workspaceNodes.type, "folder"),
            isNull(workspaceNodes.deletedAt),
            sql`coalesce(${workspaceNodes.metadata}->>'isSystem', 'false') = 'true'`
        ),
    });
    if (fastExisting) return fastExisting;

    return await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`files-system-root:${projectId}`}))`);

        const existing = await tx.query.workspaceNodes.findFirst({
            where: and(
                eq(workspaceNodes.projectId, projectId),
                isNull(workspaceNodes.parentId),
                eq(workspaceNodes.type, "folder"),
                isNull(workspaceNodes.deletedAt),
                sql`coalesce(${workspaceNodes.metadata}->>'isSystem', 'false') = 'true'`
            ),
        });
        if (existing) return existing;

        const [created] = await tx
            .insert(workspaceNodes)
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
    const lock = await tx.query.workspaceNodeLocks.findFirst({
        where: and(
            eq(workspaceNodeLocks.projectId, projectId),
            eq(workspaceNodeLocks.nodeId, nodeId),
            ne(workspaceNodeLocks.lockedBy, userId),
            gt(workspaceNodeLocks.expiresAt, now)
        ),
        columns: { lockedBy: true, expiresAt: true },
    });

    if (lock) {
        throw new ConflictError("File has an active editing lease");
    }
}

export async function assertValidParentFolder(projectId: string, parentId: string | null, tx: { query: typeof db.query } = db) {
    if (!parentId) return null;
    const parent = await tx.query.workspaceNodes.findFirst({
        where: and(
            eq(workspaceNodes.id, parentId),
            eq(workspaceNodes.projectId, projectId),
            isNull(workspaceNodes.deletedAt)
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
        throw new Error("Task draft files must be published to Workspace Files before they can be relocated");
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
        eq(workspaceNodes.projectId, projectId),
        isWithParent(parentId),
        isNull(workspaceNodes.deletedAt),
        sql`lower(${workspaceNodes.name}) = lower(${name})`,
    ];
    if (ignoreNodeId) {
        conditions.push(ne(workspaceNodes.id, ignoreNodeId));
    }

    const duplicate = await tx.query.workspaceNodes.findFirst({
        where: and(...conditions),
        columns: { id: true },
    });

    if (duplicate) {
        throw new ConflictError("A file/folder with this name already exists in this location");
    }
}

/**
 * PERF-003: set-based guards for bulk move and restore. One read each instead of one per node
 * while the project lock is held.
 */
export async function assertNodesNotLockedByAnotherUser(projectId: string, nodeIds: string[], userId: string, tx: any) {
    if (!nodeIds.length) return;
    const [lock] = Array.from(await tx.execute(sql`
        SELECT 1 FROM workspace_node_locks
        WHERE workspace_id = ${projectId}::uuid
          AND node_id IN (${sql.join(nodeIds.map((id) => sql`${id}::uuid`), sql`, `)})
          AND locked_by <> ${userId}::uuid
          AND expires_at > now()
        LIMIT 1
    `));
    if (lock) throw new ConflictError("File has an active editing lease");
}

/** Every (parent, name) pair must be free among live siblings outside the batch itself. */
export async function assertUniqueSiblingNames(
    projectId: string,
    entries: { id: string; parentId: string | null; name: string }[],
    tx: any,
) {
    if (!entries.length) return;
    const pairs = sql.join(entries.map((entry) => sql`(${entry.parentId}::uuid, lower(${entry.name}))`), sql`, `);
    const [duplicate] = Array.from(await tx.execute(sql`
        SELECT 1 FROM workspace_nodes n
        JOIN (VALUES ${pairs}) AS wanted(parent_id, name)
          ON n.parent_id IS NOT DISTINCT FROM wanted.parent_id AND lower(n.name) = wanted.name
        WHERE n.workspace_id = ${projectId}::uuid
          AND n.deleted_at IS NULL
          AND n.id NOT IN (${sql.join(entries.map((entry) => sql`${entry.id}::uuid`), sql`, `)})
        LIMIT 1
    `));
    if (duplicate) throw new ConflictError("A file/folder with this name already exists in this location");
}

/** One ancestry walk of the destination, checked against every selected folder. */
export async function assertNotMovingAnyIntoDescendant(projectId: string, folderIds: string[], targetParentId: string | null, tx: any) {
    if (!targetParentId || !folderIds.length) return;
    if (folderIds.includes(targetParentId)) throw new Error("Cannot move a folder into itself or its descendant");
    const [hit] = Array.from(await tx.execute(sql`
        WITH RECURSIVE ancestors AS (
            SELECT id, parent_id, 1 AS depth FROM workspace_nodes
            WHERE id = ${targetParentId}::uuid AND workspace_id = ${projectId}::uuid AND deleted_at IS NULL
            UNION ALL
            SELECT p.id, p.parent_id, a.depth + 1 FROM workspace_nodes p
            JOIN ancestors a ON p.id = a.parent_id
            WHERE p.workspace_id = ${projectId}::uuid AND p.deleted_at IS NULL AND a.depth < 256
        )
        SELECT 1 FROM ancestors WHERE id IN (${sql.join(folderIds.map((id) => sql`${id}::uuid`), sql`, `)}) LIMIT 1
    `));
    if (hit) throw new Error("Cannot move a folder into itself or its descendant");
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
            .insert(workspaceEventCounters)
            .values({ projectId, nextSequence: 1 })
            .onConflictDoUpdate({
                target: workspaceEventCounters.projectId,
                set: {
                    nextSequence: sql`${workspaceEventCounters.nextSequence} + 1`,
                    updatedAt: new Date(),
                },
            })
            .returning({
                newSequenceNumber: workspaceEventCounters.nextSequence,
            });

        if (!counter) {
            throw new Error(`Workspace ${projectId} not found`);
        }

        const [event] = await tx
            .insert(workspaceNodeEvents)
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
            .insert(workspaceEventCounters)
            .values({ projectId, nextSequence: count })
            .onConflictDoUpdate({
                target: workspaceEventCounters.projectId,
                set: {
                    nextSequence: sql`${workspaceEventCounters.nextSequence} + ${count}`,
                    updatedAt: new Date(),
                },
            })
            .returning({
                newSequenceNumber: workspaceEventCounters.nextSequence,
            });

        if (!counter) {
            throw new Error(`Workspace ${projectId} not found`);
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

        await tx.insert(workspaceNodeEvents).values(values);
        return { sequenceNumber: counter.newSequenceNumber };
    };

    if (clientTx) {
        return await run(clientTx);
    }
    return await db.transaction(async (tx) => {
        return await run(tx);
    });
}

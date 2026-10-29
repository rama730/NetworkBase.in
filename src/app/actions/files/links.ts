"use server";

import { db } from "@/lib/db";
import { profiles, workspaceNodes, workspaces, tasks, taskNodeLinks } from "@/lib/db/schema";
import { escapeLikePattern, MAX_TASK_ATTACHMENTS } from "@/app/actions/files/_constants";
import { eq, and, isNull, inArray, sql, desc, ilike } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
import { notifyTaskParticipantsForFileEvent } from "@/lib/notifications/task-file";
import {
    assertWorkspaceFileReadAccess,
    canReadWorkspaceTaskFiles,
    assertWorkspaceWriteAccess,
    assertWorkspaceWriteAccessTx,
    getTaskWorkspaceId,
} from "@/lib/files/internal-helpers";
import {
    replaceTaskFileRoleTag,
    type TaskFileRole,
} from "@/lib/workspaces/task-file-intelligence";
import { getFileAttributionByNodeId } from "@/lib/files/file-attribution";
import { consumeRateLimit } from "@/lib/security/rate-limit";

const MAX_ANNOTATION_LENGTH = 2000;

async function requireLinkWriter(annotation: string | null | undefined) {
    if (typeof annotation === "string" && annotation.length > MAX_ANNOTATION_LENGTH)
        throw new Error(`Notes are limited to ${MAX_ANNOTATION_LENGTH} characters.`);
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Sign in to continue");
    const { allowed } = await consumeRateLimit(`files:${user.id}`, 60, 60);
    if (!allowed) throw new Error("Too many attempts. Try again in a minute.");
    return user;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// COR-023: authority, the live task and the live file are re-read in the write transaction.
async function assertLinkTargetsTx(tx: Tx, projectId: string, userId: string, taskId: string, nodeId: string) {
    await assertWorkspaceWriteAccessTx(tx, projectId, userId);
    const [task] = await tx.select({ id: tasks.id }).from(tasks)
        .where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId), isNull(tasks.deletedAt))).limit(1);
    if (!task) throw new Error("Task not found");
    const [node] = await tx.select({ id: workspaceNodes.id }).from(workspaceNodes)
        .where(and(eq(workspaceNodes.id, nodeId), eq(workspaceNodes.projectId, projectId), isNull(workspaceNodes.deletedAt))).limit(1);
    if (!node) throw new Error("File not found");
}

// Approval tags are server-owned. User edits may change classification and
// labels, but cannot manufacture approval or erase a concurrent approval.
function withStoredApprovalTags(tags: readonly string[]) {
    const editable = tags.filter(tag => !tag.startsWith("approved_version:") && !tag.startsWith("approved_revision_at:"));
    return sql<string[]>`${JSON.stringify(editable)}::jsonb || coalesce((
        SELECT jsonb_agg(tag) FROM jsonb_array_elements_text(coalesce(${taskNodeLinks.tags}, '[]'::jsonb)) AS tag
        WHERE tag LIKE 'approved_version:%' OR tag LIKE 'approved_revision_at:%'
    ), '[]'::jsonb)`;
}

export async function getTaskLinkCounts(projectId: string, nodeIds: string[]) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const access = await assertWorkspaceFileReadAccess(projectId, user?.id ?? null);
    if (!canReadWorkspaceTaskFiles(access)) return {} as Record<string, number>;

    const unique = Array.from(new Set(nodeIds)).filter(Boolean);
    if (unique.length === 0) return {} as Record<string, number>;

    const out: Record<string, number> = {};
    const chunkSize = 500;
    for (let i = 0; i < unique.length; i += chunkSize) {
        const chunk = unique.slice(i, i + chunkSize);
        const rows = await db
            .select({
                nodeId: taskNodeLinks.nodeId,
                count: sql<number>`count(*)`,
            })
            .from(taskNodeLinks)
            .innerJoin(workspaceNodes, eq(taskNodeLinks.nodeId, workspaceNodes.id))
            .innerJoin(tasks, eq(taskNodeLinks.taskId, tasks.id))
            .where(and(eq(workspaceNodes.projectId, projectId), eq(tasks.projectId, projectId), isNull(workspaceNodes.deletedAt), isNull(tasks.deletedAt), inArray(taskNodeLinks.nodeId, chunk)))
            .groupBy(taskNodeLinks.nodeId);

        for (const r of rows) out[r.nodeId] = Number(r.count) || 0;
    }
    return out;
}

export interface LinkedTask {
    taskId: string;
    title: string;
    status: string;
    reviewStatus?: string | null;
    priority: string;
    assigneeId: string | null;
    assigneeName: string | null;
    annotation: string | null;
    linkedAt: string;
}

export async function getTaskLinksForNode(projectId: string, nodeId: string): Promise<LinkedTask[]> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const access = await assertWorkspaceFileReadAccess(projectId, user?.id ?? null);
    if (!canReadWorkspaceTaskFiles(access)) return [];

    // Confirm the node belongs to the project
    const node = await db.query.workspaceNodes.findFirst({
        where: and(eq(workspaceNodes.id, nodeId), eq(workspaceNodes.projectId, projectId)),
        columns: { id: true },
    });
    if (!node) throw new Error("File not found");

    const rows = await db
        .select({
            taskId: tasks.id,
            title: tasks.title,
            status: tasks.status,
            reviewStatus: tasks.reviewStatus,
            priority: tasks.priority,
            assigneeId: tasks.assigneeId,
            assigneeName: profiles.fullName,
            annotation: taskNodeLinks.annotation,
            linkedAt: taskNodeLinks.linkedAt,
        })
        .from(taskNodeLinks)
        .innerJoin(tasks, eq(taskNodeLinks.taskId, tasks.id))
        .leftJoin(profiles, eq(tasks.assigneeId, profiles.id))
        .where(and(eq(taskNodeLinks.nodeId, nodeId), isNull(tasks.deletedAt)))
        .orderBy(desc(taskNodeLinks.linkedAt));

    return rows.map((r) => ({
        taskId: r.taskId,
        title: r.title,
        status: r.status,
        reviewStatus: r.reviewStatus,
        priority: r.priority,
        assigneeId: r.assigneeId,
        assigneeName: r.assigneeName,
        annotation: r.annotation,
        linkedAt: r.linkedAt.toISOString(),
    }));
}

export async function linkNodeToTask(
    taskId: string,
    nodeId: string,
    options?: {
        notificationKind?: "task_file_replaced" | "task_file_needs_review";
        annotation?: string | null;
        role?: TaskFileRole;
    },
) {
    if (options?.role && !["reference", "working", "deliverable"].includes(options.role))
        throw new Error("Invalid file role");
    const user = await requireLinkWriter(options?.annotation);
    const projectId = await getTaskWorkspaceId(taskId);

    const { row, changed } = await db.transaction(async (tx) => {
        await assertLinkTargetsTx(tx, projectId, user.id, taskId, nodeId);
        const [link] = await tx.select().from(taskNodeLinks)
            .where(and(eq(taskNodeLinks.taskId, taskId), eq(taskNodeLinks.nodeId, nodeId))).limit(1);
        if (!link) {
            const [usage] = await tx
                .select({ count: sql<number>`count(*)::int`, maxOrder: sql<number>`coalesce(max(${taskNodeLinks.order}), 0)::int` })
                .from(taskNodeLinks)
                .where(eq(taskNodeLinks.taskId, taskId));
            // ponytail: a cap instead of a cursor bounds every attachment read. ceiling: MAX_TASK_ATTACHMENTS links per task; add keyset paging if it is raised.
            if ((usage?.count ?? 0) >= MAX_TASK_ATTACHMENTS) throw new Error(`A task can have at most ${MAX_TASK_ATTACHMENTS} linked files.`);
            const [inserted] = await tx.insert(taskNodeLinks).values({
                taskId,
                nodeId,
                createdBy: user.id,
                order: (usage?.maxOrder ?? 0) + 1,
                annotation: options?.annotation ?? null,
                // A task link is context supplied to a task unless the caller says otherwise.
                tags: replaceTaskFileRoleTag([], options?.role ?? "reference"),
            }).onConflictDoNothing({
                target: [taskNodeLinks.taskId, taskNodeLinks.nodeId],
            }).returning();
            if (inserted) return { row: inserted, changed: true };
        } else if (options?.annotation !== undefined || options?.role) {
            const [updated] = await tx.update(taskNodeLinks)
                .set({
                    ...(options.annotation !== undefined && { annotation: options.annotation }),
                    ...(options.role && { tags: withStoredApprovalTags(replaceTaskFileRoleTag(link.tags, options.role)) }),
                })
                .where(and(eq(taskNodeLinks.taskId, taskId), eq(taskNodeLinks.nodeId, nodeId)))
                .returning();
            if (updated) return { row: updated, changed: true };
        } else {
            return { row: link, changed: false };
        }
        const [existing] = await tx.select().from(taskNodeLinks)
            .where(and(eq(taskNodeLinks.taskId, taskId), eq(taskNodeLinks.nodeId, nodeId))).limit(1);
        if (!existing) throw new Error("Couldn’t link file to task");
        return { row: existing, changed: false };
    });

    // Delivery runs after commit, outside the project lock.
    if (changed && options?.notificationKind) {
        await notifyTaskParticipantsForFileEvent({
            actorUserId: user.id,
            projectId,
            nodeId,
            kind: options.notificationKind,
        });
    }
    return row;
}

export async function unlinkNodeFromTask(taskId: string, nodeId: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Sign in to continue");

    const projectId = await getTaskWorkspaceId(taskId);
    await assertWorkspaceWriteAccess(projectId, user.id);

    // Ensure node belongs to the same project (prevents unlinking arbitrary links across projects)
    const node = await db.query.workspaceNodes.findFirst({
        where: and(eq(workspaceNodes.id, nodeId), eq(workspaceNodes.projectId, projectId)),
        columns: { id: true, taskId: true }
    });
    if (!node) throw new Error("File not found");

    // Removing from a task must never delete a project file. Deletion remains an
    // explicit Files action; this operation only removes the task relationship.
    await db.transaction(async tx => {
        await assertWorkspaceWriteAccessTx(tx, projectId, user.id);
        // PURE OPTIMIZATION (Item 11): Consolidate link deletion and node metadata detachment into 1 atomic query.
        await tx.execute(sql`
            WITH deleted_link AS (
                DELETE FROM task_node_links
                WHERE task_id = ${taskId}::uuid AND node_id = ${nodeId}::uuid
                RETURNING 1
            )
            UPDATE workspace_nodes
            SET metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('taskFileDetachedFrom', ${taskId}::text)
            WHERE id = ${nodeId}::uuid
              AND workspace_id = ${projectId}::uuid
              AND (task_id = ${taskId}::uuid OR path LIKE ${`/.system/tasks/${taskId}/%`})
        `);
    });
}

export async function getTaskAttachments(projectId: string, taskId: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Sign in to continue");

    const access = await assertWorkspaceFileReadAccess(projectId, user.id);
    if (!canReadWorkspaceTaskFiles(access)) throw new Error("Task files are not available to this viewer.");

    const rows = await db
        .select({
            node: workspaceNodes,
            linkedAt: taskNodeLinks.linkedAt,
            order: taskNodeLinks.order,
            annotation: taskNodeLinks.annotation,
            tags: taskNodeLinks.tags,
        })
        .from(taskNodeLinks)
        .innerJoin(tasks, eq(taskNodeLinks.taskId, tasks.id))
        .innerJoin(workspaceNodes, eq(taskNodeLinks.nodeId, workspaceNodes.id))
        .where(and(eq(taskNodeLinks.taskId, taskId), eq(tasks.projectId, projectId), isNull(tasks.deletedAt), eq(workspaceNodes.projectId, projectId), isNull(workspaceNodes.deletedAt)))
        .orderBy(taskNodeLinks.order, desc(taskNodeLinks.linkedAt))
        .limit(MAX_TASK_ATTACHMENTS);

    const attributionByNodeId = await getFileAttributionByNodeId(
        rows.map((row) => row.node),
    );

    return rows.map((r) => ({
        ...r.node,
        linkedAt: r.linkedAt,
        order: r.order,
        annotation: r.annotation,
        tags: r.tags,
        ...(attributionByNodeId.get(r.node.id) ?? {}),
    }));
}

export async function updateTaskNodeLink(taskId: string, nodeId: string, updates: { order?: number, annotation?: string | null, tags?: string[] }) {
    if (updates.tags !== undefined && (!Array.isArray(updates.tags) || updates.tags.length > 100 || updates.tags.some(tag => typeof tag !== "string" || tag.length > 200)))
        throw new Error("Invalid file labels");
    if (updates.order !== undefined && !Number.isSafeInteger(updates.order)) throw new Error("Invalid file order");
    const user = await requireLinkWriter(updates.annotation);
    const projectId = await getTaskWorkspaceId(taskId);
    if (Object.keys(updates).length === 0) return;

    const needsReview = await db.transaction(async (tx) => {
        await assertLinkTargetsTx(tx, projectId, user.id, taskId, nodeId);
        const [previous] = await tx.select({ annotation: taskNodeLinks.annotation }).from(taskNodeLinks)
            .where(and(eq(taskNodeLinks.taskId, taskId), eq(taskNodeLinks.nodeId, nodeId))).limit(1);
        if (!previous) return false;
        await tx.update(taskNodeLinks)
            .set({
                ...(updates.order !== undefined && { order: updates.order }),
                ...(updates.annotation !== undefined && { annotation: updates.annotation }),
                ...(updates.tags !== undefined && { tags: withStoredApprovalTags(updates.tags) }),
            })
            .where(and(eq(taskNodeLinks.taskId, taskId), eq(taskNodeLinks.nodeId, nodeId)));
        const nextAnnotation = typeof updates.annotation === "string" ? updates.annotation.toLowerCase() : "";
        return nextAnnotation.includes("review") && !(previous.annotation?.toLowerCase() ?? "").includes("review");
    });

    if (needsReview) {
        await notifyTaskParticipantsForFileEvent({
            actorUserId: user.id,
            projectId,
            nodeId,
            kind: "task_file_needs_review",
        });
    }
}

export interface SearchableTask {
    id: string;
    title: string;
    status: string;
    reviewStatus?: string | null;
    priority: string;
    taskNumber: number | null;
    projectKey: string | null;
    assigneeName: string | null;
}

export async function searchWorkspaceTasks(
    projectId: string,
    query: string,
    limit: number = 30,
): Promise<SearchableTask[]> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const access = await assertWorkspaceFileReadAccess(projectId, user?.id ?? null);
    // Task titles, status and assignees are Tasks-tab data, not Files data (COR-003).
    if (!canReadWorkspaceTaskFiles(access)) return [];

    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const trimmed = (query || "").trim();
    const rows = await db
        .select({
            id: tasks.id,
            title: tasks.title,
            status: tasks.status,
            reviewStatus: tasks.reviewStatus,
            priority: tasks.priority,
            taskNumber: tasks.taskNumber,
            projectKey: workspaces.key,
            assigneeName: profiles.fullName,
        })
        .from(tasks)
        .innerJoin(workspaces, eq(workspaces.id, tasks.projectId))
        .leftJoin(profiles, eq(tasks.assigneeId, profiles.id))
        .where(and(
            eq(tasks.projectId, projectId),
            isNull(tasks.deletedAt),
            // Empty query: most recently updated tasks.
            trimmed ? ilike(tasks.title, `%${escapeLikePattern(trimmed)}%`) : undefined,
        ))
        .orderBy(desc(tasks.updatedAt))
        .limit(safeLimit);

    return rows.map((r) => ({ ...r, projectKey: r.projectKey ?? null }));
}

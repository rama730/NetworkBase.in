"use server";

import { db } from "@/lib/db";
import { profiles, projectNodes, projects, tasks, taskNodeLinks } from "@/lib/db/schema";
import { escapeLikePattern, MAX_TASK_ATTACHMENTS } from "@/app/actions/files/_constants";
import { eq, and, isNull, inArray, sql, desc, ilike } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
import { notifyTaskParticipantsForFileEvent } from "@/lib/notifications/task-file";
import {
    assertProjectFileReadAccess,
    canReadProjectTaskFiles,
    assertProjectWriteAccess,
    assertProjectWriteAccessTx,
    getTaskProjectId,
} from "@/lib/files/internal-helpers";
import {
    replaceTaskFileRoleTag,
    type TaskFileRole,
} from "@/lib/projects/task-file-intelligence";
import { getFileAttributionByNodeId } from "@/lib/files/file-attribution";

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
    const access = await assertProjectFileReadAccess(projectId, user?.id ?? null);
    if (!canReadProjectTaskFiles(access)) return {} as Record<string, number>;

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
            .innerJoin(projectNodes, eq(taskNodeLinks.nodeId, projectNodes.id))
            .innerJoin(tasks, eq(taskNodeLinks.taskId, tasks.id))
            .where(and(eq(projectNodes.projectId, projectId), eq(tasks.projectId, projectId), isNull(projectNodes.deletedAt), isNull(tasks.deletedAt), inArray(taskNodeLinks.nodeId, chunk)))
            .groupBy(taskNodeLinks.nodeId);

        for (const r of rows) out[r.nodeId] = Number(r.count) || 0;
    }
    return out;
}

export interface LinkedTask {
    taskId: string;
    title: string;
    status: string;
    priority: string;
    assigneeId: string | null;
    assigneeName: string | null;
    annotation: string | null;
    linkedAt: string;
}

export async function getTaskLinksForNode(projectId: string, nodeId: string): Promise<LinkedTask[]> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const access = await assertProjectFileReadAccess(projectId, user?.id ?? null);
    if (!canReadProjectTaskFiles(access)) return [];

    // Confirm the node belongs to the project
    const node = await db.query.projectNodes.findFirst({
        where: and(eq(projectNodes.id, nodeId), eq(projectNodes.projectId, projectId)),
        columns: { id: true },
    });
    if (!node) throw new Error("File not found");

    const rows = await db
        .select({
            taskId: tasks.id,
            title: tasks.title,
            status: tasks.status,
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
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");

    const projectId = await getTaskProjectId(taskId);
    await assertProjectWriteAccess(projectId, user.id);

    // Ensure node belongs to same project and is not deleted
    const node = await db.query.projectNodes.findFirst({
        where: and(eq(projectNodes.id, nodeId), eq(projectNodes.projectId, projectId), isNull(projectNodes.deletedAt)),
        columns: { id: true }
    });
    if (!node) throw new Error("File not found");

    const link = await db.query.taskNodeLinks.findFirst({
        where: and(eq(taskNodeLinks.taskId, taskId), eq(taskNodeLinks.nodeId, nodeId)),
        columns: { nodeId: true, order: true, tags: true, annotation: true },
    });

    let inserted;
    if (!link) {
        const [usage] = await db
            .select({ count: sql<number>`count(*)::int`, maxOrder: sql<number>`coalesce(max(${taskNodeLinks.order}), 0)::int` })
            .from(taskNodeLinks)
            .where(eq(taskNodeLinks.taskId, taskId));
        // ponytail: a cap instead of a cursor bounds every attachment read. ceiling: MAX_TASK_ATTACHMENTS links per task; add keyset paging if it is raised.
        if ((usage?.count ?? 0) >= MAX_TASK_ATTACHMENTS) throw new Error(`A task can have at most ${MAX_TASK_ATTACHMENTS} linked files.`);
        const order = (usage?.maxOrder ?? 0) + 1;
        inserted = await db.insert(taskNodeLinks).values({
            taskId,
            nodeId,
            createdBy: user.id,
            order,
            annotation: options?.annotation ?? null,
            // A task link is context supplied to a task unless the caller says otherwise.
            tags: replaceTaskFileRoleTag([], options?.role ?? "reference"),
        }).onConflictDoNothing({
            target: [taskNodeLinks.taskId, taskNodeLinks.nodeId],
        }).returning();
    } else if (options?.annotation !== undefined || options?.role) {
        inserted = await db.update(taskNodeLinks)
            .set({
                ...(options.annotation !== undefined && { annotation: options.annotation }),
                ...(options.role && { tags: withStoredApprovalTags(replaceTaskFileRoleTag(link.tags, options.role)) }),
            })
            .where(and(eq(taskNodeLinks.taskId, taskId), eq(taskNodeLinks.nodeId, nodeId)))
            .returning();
    } else {
        inserted = [link];
    }

    if (inserted[0]) {
        if (options?.notificationKind) {
            await notifyTaskParticipantsForFileEvent({
                actorUserId: user.id,
                projectId,
                nodeId,
                kind: options.notificationKind,
            });
        }
        return inserted[0];
    }

    const existing = await db.query.taskNodeLinks.findFirst({
        where: and(eq(taskNodeLinks.taskId, taskId), eq(taskNodeLinks.nodeId, nodeId)),
    });
    if (!existing) throw new Error("Failed to link file to task");
    return existing;
}

export async function unlinkNodeFromTask(taskId: string, nodeId: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");

    const projectId = await getTaskProjectId(taskId);
    await assertProjectWriteAccess(projectId, user.id);

    // Ensure node belongs to the same project (prevents unlinking arbitrary links across projects)
    const node = await db.query.projectNodes.findFirst({
        where: and(eq(projectNodes.id, nodeId), eq(projectNodes.projectId, projectId)),
        columns: { id: true, taskId: true }
    });
    if (!node) throw new Error("File not found");

    // Removing from a task must never delete a project file. Deletion remains an
    // explicit Files action; this operation only removes the task relationship.
    await db.transaction(async tx => {
        await assertProjectWriteAccessTx(tx, projectId, user.id);
        // PURE OPTIMIZATION (Item 11): Consolidate link deletion and node metadata detachment into 1 atomic query.
        await tx.execute(sql`
            WITH deleted_link AS (
                DELETE FROM task_node_links
                WHERE task_id = ${taskId}::uuid AND node_id = ${nodeId}::uuid
                RETURNING 1
            )
            UPDATE project_nodes
            SET metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('taskFileDetachedFrom', ${taskId}::text)
            WHERE id = ${nodeId}::uuid
              AND project_id = ${projectId}::uuid
              AND (task_id = ${taskId}::uuid OR path LIKE ${`/.system/tasks/${taskId}/%`})
        `);
    });
}

export async function getTaskAttachments(projectId: string, taskId: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");

    const access = await assertProjectFileReadAccess(projectId, user.id);
    if (!canReadProjectTaskFiles(access)) throw new Error("Task files are not available to this viewer.");

    const rows = await db
        .select({
            node: projectNodes,
            linkedAt: taskNodeLinks.linkedAt,
            order: taskNodeLinks.order,
            annotation: taskNodeLinks.annotation,
            tags: taskNodeLinks.tags,
        })
        .from(taskNodeLinks)
        .innerJoin(tasks, eq(taskNodeLinks.taskId, tasks.id))
        .innerJoin(projectNodes, eq(taskNodeLinks.nodeId, projectNodes.id))
        .where(and(eq(taskNodeLinks.taskId, taskId), eq(tasks.projectId, projectId), isNull(tasks.deletedAt), eq(projectNodes.projectId, projectId), isNull(projectNodes.deletedAt)))
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
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");

    const projectId = await getTaskProjectId(taskId);
    await assertProjectWriteAccess(projectId, user.id);

    // Ensure node belongs to same project and is not deleted
    const node = await db.query.projectNodes.findFirst({
        where: and(eq(projectNodes.id, nodeId), eq(projectNodes.projectId, projectId), isNull(projectNodes.deletedAt)),
        columns: { id: true }
    });
    if (!node) throw new Error("File not found");

    if (Object.keys(updates).length === 0) return;

    const previous = typeof updates.annotation === "string"
        ? await db.query.taskNodeLinks.findFirst({
            where: and(eq(taskNodeLinks.taskId, taskId), eq(taskNodeLinks.nodeId, nodeId)),
            columns: { annotation: true, tags: true },
        })
        : null;

    const updated = await db.update(taskNodeLinks)
        .set({
            ...(updates.order !== undefined && { order: updates.order }),
            ...(updates.annotation !== undefined && { annotation: updates.annotation }),
            ...(updates.tags !== undefined && { tags: withStoredApprovalTags(updates.tags) }),
        })
        .where(and(eq(taskNodeLinks.taskId, taskId), eq(taskNodeLinks.nodeId, nodeId)))
        .returning({ annotation: taskNodeLinks.annotation, tags: taskNodeLinks.tags });

    if (updated.length === 0) return;

    const nextAnnotation = typeof updates.annotation === "string" ? updates.annotation.toLowerCase() : "";
    const previousAnnotation = previous?.annotation?.toLowerCase() ?? "";
    if (nextAnnotation.includes("review") && !previousAnnotation.includes("review")) {
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
    priority: string;
    taskNumber: number | null;
    projectKey: string | null;
    assigneeName: string | null;
}

export async function searchProjectTasks(
    projectId: string,
    query: string,
    limit: number = 30,
): Promise<SearchableTask[]> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const access = await assertProjectFileReadAccess(projectId, user?.id ?? null);
    // Task titles, status and assignees are Tasks-tab data, not Files data (COR-003).
    if (!canReadProjectTaskFiles(access)) return [];

    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const trimmed = (query || "").trim();
    const rows = await db
        .select({
            id: tasks.id,
            title: tasks.title,
            status: tasks.status,
            priority: tasks.priority,
            taskNumber: tasks.taskNumber,
            projectKey: projects.key,
            assigneeName: profiles.fullName,
        })
        .from(tasks)
        .innerJoin(projects, eq(projects.id, tasks.projectId))
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

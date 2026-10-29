"use server";

import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { projectWorkflowColumns, tasks } from "@/lib/db/schema";
import { getProjectAccessById } from "@/lib/data/project-access";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { TASK_STATUS_PRESENTATION, TASK_WORKFLOW_STATUSES } from "@/lib/projects/task-workflow";

type WorkflowStatus = (typeof TASK_WORKFLOW_STATUSES)[number];

const columnSchema = z.object({
    id: z.string().uuid(),
    status: z.enum(TASK_WORKFLOW_STATUSES),
    title: z.string().trim().min(1).max(120),
    accentClassName: z.string().trim().min(1).max(160),
    emptyTitle: z.string().trim().min(1).max(160),
    emptyDescription: z.string().trim().min(1).max(320),
    position: z.number().int().min(0).max(5),
    isDefault: z.boolean(),
});

const workflowSchema = z.array(columnSchema).min(4).max(6).superRefine((columns, context) => {
    const ids = new Set(columns.map((column) => column.id));
    if (ids.size !== columns.length) context.addIssue({ code: z.ZodIssueCode.custom, message: "Column IDs must be unique" });
    for (const status of TASK_WORKFLOW_STATUSES) {
        if (!columns.some((column) => column.isDefault && column.status === status)) {
            context.addIssue({ code: z.ZodIssueCode.custom, message: `Missing default ${status} column` });
        }
    }
});

const createColumnSchema = z.object({
    projectId: z.string().uuid(),
    title: z.string().trim().min(1).max(120),
    status: z.enum(TASK_WORKFLOW_STATUSES).default("in_progress"),
    accentClassName: z.string().optional(),
});

function defaultColumns(projectId: string) {
    return TASK_WORKFLOW_STATUSES.map((status, position) => ({
        projectId,
        status,
        title: TASK_STATUS_PRESENTATION[status].columnTitle,
        accentClassName: TASK_STATUS_PRESENTATION[status].accentClassName,
        emptyTitle: TASK_STATUS_PRESENTATION[status].emptyTitle,
        emptyDescription: TASK_STATUS_PRESENTATION[status].emptyDescription,
        position,
        isDefault: true,
    }));
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function requireWorkflowUser() {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) throw new Error("Sign in to continue");
    const { allowed } = await consumeRateLimit(`project:${user.id}`, 60, 60);
    if (!allowed) throw new Error("Too many attempts. Try again in a minute.");
    return user;
}

// COR-023/024: leadership is checked under the project row lock, which also serializes every
// workflow write for the project, so count-then-insert cannot overshoot the six-section limit.
async function lockWorkflowForLeader(tx: Tx, projectId: string, userId: string) {
    const rows = await tx.execute<{ owner_id: string; role: string | null }>(sql`
        SELECT p.owner_id, m.role
        FROM projects p
        LEFT JOIN project_members m ON m.project_id = p.id AND m.user_id = ${userId}
        WHERE p.id = ${projectId} AND p.deleted_at IS NULL
        FOR UPDATE OF p
    `);
    const row = Array.from(rows)[0];
    if (!row) throw new Error("Not found");
    if (row.owner_id !== userId && row.role !== "admin") throw new Error("Only leaders can modify workflow");
}

async function ensureWorkflowColumns(projectId: string, tx: Tx | typeof db = db) {
    await tx.insert(projectWorkflowColumns).values(defaultColumns(projectId)).onConflictDoNothing();
    return tx.query.projectWorkflowColumns.findMany({
        where: eq(projectWorkflowColumns.projectId, projectId),
        orderBy: [asc(projectWorkflowColumns.position), asc(projectWorkflowColumns.id)],
    });
}

export async function getProjectWorkflowColumnsAction(projectId: string) {
    try {
        const parsed = z.string().uuid().safeParse(projectId);
        if (!parsed.success) return { success: false as const, error: "Invalid workspace" };
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        const access = await getProjectAccessById(parsed.data, user?.id ?? null);
        if (!access.canRead) return { success: false as const, error: "Not found" };
        return { success: true as const, columns: await ensureWorkflowColumns(parsed.data) };
    } catch (error) {
        return { success: false as const, error: error instanceof Error ? error.message : "Couldn’t load workflow" };
    }
}

export async function updateProjectWorkflowColumnsAction(projectId: string, workflow: unknown) {
    try {
        const parsedProjectId = z.string().uuid().safeParse(projectId);
        const parsedWorkflow = workflowSchema.safeParse(workflow);
        if (!parsedProjectId.success || !parsedWorkflow.success) return { success: false as const, error: "Invalid task board configuration" };
        const user = await requireWorkflowUser();
        const rows = sql.join(parsedWorkflow.data.map((column, index) => sql`(${column.id}::uuid, ${100 + index}::int, ${column.title}::text, ${column.accentClassName}::text, ${column.emptyTitle}::text, ${column.emptyDescription}::text, ${column.position}::int)`), sql`, `);
        const values = sql`(VALUES ${rows}) AS v(id, temporary_position, title, accent_class_name, empty_title, empty_description, position)`;
        const changedElsewhere = await db.transaction(async (tx) => {
            await lockWorkflowForLeader(tx, parsedProjectId.data, user.id);
            const existing = await ensureWorkflowColumns(parsedProjectId.data, tx);
            if (existing.length !== parsedWorkflow.data.length || !parsedWorkflow.data.every((column) => existing.some((row) => row.id === column.id))) {
                return true;
            }
            await tx.execute(sql`UPDATE project_workflow_columns c SET position = v.temporary_position FROM ${values} WHERE c.id = v.id AND c.project_id = ${parsedProjectId.data}::uuid`);
            await tx.execute(sql`UPDATE project_workflow_columns c SET title = v.title, accent_class_name = v.accent_class_name, empty_title = v.empty_title, empty_description = v.empty_description, position = v.position, updated_at = now() FROM ${values} WHERE c.id = v.id AND c.project_id = ${parsedProjectId.data}::uuid`);
            return false;
        });
        if (changedElsewhere) return { success: false as const, error: "Workflow changed elsewhere. Reload and try again." };
        revalidatePath(`/projects/${projectId}`);
        return { success: true as const };
    } catch (error) {
        return { success: false as const, error: error instanceof Error ? error.message : "Couldn’t save workflow" };
    }
}

export async function createProjectWorkflowColumnAction(input: unknown) {
    try {
        const parsed = createColumnSchema.safeParse(input);
        if (!parsed.success) return { success: false as const, error: "Invalid workflow column" };
        const user = await requireWorkflowUser();
        const status = parsed.data.status as WorkflowStatus;
        const presentation = TASK_STATUS_PRESENTATION[status];
        const column = await db.transaction(async (tx) => {
            await lockWorkflowForLeader(tx, parsed.data.projectId, user.id);
            const columns = await ensureWorkflowColumns(parsed.data.projectId, tx);
            if (columns.length >= 6) return null;
            const [created] = await tx.insert(projectWorkflowColumns).values({
                projectId: parsed.data.projectId,
                status,
                title: parsed.data.title,
                accentClassName: parsed.data.accentClassName || presentation.accentClassName,
                emptyTitle: "No tasks here",
                emptyDescription: "Drag tasks into this section",
                position: (columns.at(-1)?.position ?? -1) + 1,
                isDefault: false,
            }).returning();
            return created;
        });
        if (!column) return { success: false as const, error: "A task board supports up to six sections" };
        return { success: true as const, column };
    } catch (error) {
        return { success: false as const, error: error instanceof Error ? error.message : "Couldn’t add section" };
    }
}

export async function deleteProjectWorkflowColumnAction(projectId: string, columnId: string) {
    try {
        if (!z.string().uuid().safeParse(projectId).success || !z.string().uuid().safeParse(columnId).success) return { success: false as const, error: "Invalid workflow column" };
        const user = await requireWorkflowUser();
        const refusal = await db.transaction(async (tx) => {
            await lockWorkflowForLeader(tx, projectId, user.id);
            const column = await tx.query.projectWorkflowColumns.findFirst({ where: and(eq(projectWorkflowColumns.id, columnId), eq(projectWorkflowColumns.projectId, projectId)) });
            if (!column) return "Section not found";
            if (column.isDefault) return "Default sections cannot be removed";
            const [taskCount] = await tx.select({ count: sql<number>`count(*)::int` }).from(tasks).where(eq(tasks.workflowColumnId, columnId));
            if ((taskCount?.count ?? 0) > 0) return "Move tasks out of this section before deleting it";
            await tx.delete(projectWorkflowColumns).where(eq(projectWorkflowColumns.id, columnId));
            return null;
        });
        if (refusal) return { success: false as const, error: refusal };
        return { success: true as const };
    } catch (error) {
        return { success: false as const, error: error instanceof Error ? error.message : "Couldn’t delete section" };
    }
}

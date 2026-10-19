"use server";

import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { projectMembers, projects, taskSubtasks, tasks } from "@/lib/db/schema";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { taskSubtaskTitleSchema } from "@/lib/validations/task";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// COR-023: authority and the live task are read in the write transaction. FOR SHARE on the project
// and membership rows waits out a concurrent owner transfer or removal instead of racing it.
async function lockSubtaskWriteScope(
    tx: Tx,
    target: { taskId: string } | { subtaskId: string },
    projectId: string,
    userId: string,
): Promise<string> {
    const match = "taskId" in target
        ? sql`t.id = ${target.taskId}`
        : sql`t.id = (SELECT s.task_id FROM ${taskSubtasks} s WHERE s.id = ${target.subtaskId})`;
    const rows = await tx.execute<{ id: string; project_id: string; owner_id: string; role: string | null }>(sql`
        SELECT t.id, t.project_id, p.owner_id, m.role
        FROM ${tasks} t
        JOIN ${projects} p ON p.id = t.project_id AND p.deleted_at IS NULL
        LEFT JOIN ${projectMembers} m ON m.project_id = p.id AND m.user_id = ${userId}
        WHERE ${match} AND t.deleted_at IS NULL
        LIMIT 1
        FOR SHARE OF t, p
    `);
    const row = Array.from(rows)[0];
    if (!row || row.project_id !== projectId) {
        throw new Error("taskId" in target ? "Task not found" : "Subtask not found");
    }
    const role = row.owner_id === userId ? "owner" : row.role;
    if (!role || (role !== "owner" && role !== "admin" && role !== "member")) {
        throw new Error("You do not have permission to perform this project action");
    }
    return row.id;
}

async function requireSubtaskWriter() {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error("Unauthorized");
    const { allowed } = await consumeRateLimit(`task:${user.id}`, 60, 60);
    if (!allowed) throw new Error("Rate limit exceeded");
    return user;
}

/**
 * Create a subtask
 */
export async function createSubtaskAction(
    taskId: string,
    title: string,
    projectId: string
) {
    try {
        const parsedTitle = taskSubtaskTitleSchema.safeParse(title);
        if (!parsedTitle.success) {
            return { success: false, error: parsedTitle.error.issues[0]?.message || "Invalid subtask title" };
        }
        const user = await requireSubtaskWriter();

        const created = await db.transaction(async (tx) => {
            await lockSubtaskWriteScope(tx, { taskId }, projectId, user.id);
            // ponytail: serialize only appends for this task. ceiling: one append at a time per task. upgrade: fractional positions if subtask drag-and-drop is added.
            await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`task-subtask:${taskId}`}, 0))`);
            const currentMax = await tx.query.taskSubtasks.findFirst({
                where: eq(taskSubtasks.taskId, taskId),
                columns: { position: true },
                orderBy: [desc(taskSubtasks.position)],
            });
            const [next] = await tx.insert(taskSubtasks).values({
                taskId,
                title: parsedTitle.data,
                completed: false,
                position: (currentMax?.position ?? -1) + 1,
            }).returning();
            return next;
        });

        return { success: true, data: created };
    } catch (error: any) {
        console.error("Unexpected error:", error);
        return { success: false, error: error?.message || "Failed to create subtask" };
    }
}

/**
 * Toggle subtask completion
 */
export async function toggleSubtaskAction(
    subtaskId: string,
    completed: boolean,
    projectId: string
) {
    try {
        const user = await requireSubtaskWriter();
        const updated = await db.transaction(async (tx) => {
            await lockSubtaskWriteScope(tx, { subtaskId }, projectId, user.id);
            const [row] = await tx.update(taskSubtasks).set({
                completed,
                updatedAt: new Date(),
            }).where(eq(taskSubtasks.id, subtaskId)).returning();
            if (!row) throw new Error("Subtask not found");
            return row;
        });

        return { success: true, data: updated };
    } catch (error: any) {
        console.error("Unexpected error:", error);
        return { success: false, error: error?.message || "Failed to toggle subtask" };
    }
}

/** Update a subtask title without expanding the checklist data model. */
export async function updateSubtaskAction(
    subtaskId: string,
    title: string,
    projectId: string,
) {
    try {
        const parsedTitle = taskSubtaskTitleSchema.safeParse(title);
        if (!parsedTitle.success) {
            return { success: false, error: parsedTitle.error.issues[0]?.message || "Invalid subtask title" };
        }
        const user = await requireSubtaskWriter();
        const updated = await db.transaction(async (tx) => {
            await lockSubtaskWriteScope(tx, { subtaskId }, projectId, user.id);
            const [row] = await tx.update(taskSubtasks).set({
                title: parsedTitle.data,
                updatedAt: new Date(),
            }).where(eq(taskSubtasks.id, subtaskId)).returning();
            if (!row) throw new Error("Subtask not found");
            return row;
        });

        return { success: true, data: updated };
    } catch (error: any) {
        console.error("Unexpected error:", error);
        return { success: false, error: error?.message || "Failed to update subtask" };
    }
}

/**
 * Delete a subtask
 */
export async function deleteSubtaskAction(
    subtaskId: string,
    projectId: string
) {
    try {
        const user = await requireSubtaskWriter();
        await db.transaction(async (tx) => {
            await lockSubtaskWriteScope(tx, { subtaskId }, projectId, user.id);
            await tx.delete(taskSubtasks).where(eq(taskSubtasks.id, subtaskId));
        });

        return { success: true };
    } catch (error: any) {
        console.error("Unexpected error:", error);
        return { success: false, error: error?.message || "Failed to delete subtask" };
    }
}

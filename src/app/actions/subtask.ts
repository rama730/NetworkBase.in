"use server";

import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { projectMembers, projects, taskSubtasks, tasks } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { taskSubtaskTitleSchema } from "@/lib/validations/task";

async function assertTaskWriteAccess(taskId: string, projectId: string, userId: string) {
    const rows = await db.execute<{
        id: string;
        project_id: string;
        owner_id: string;
        role: string | null;
    }>(sql`
        SELECT t.id, t.project_id, p.owner_id, m.role
        FROM ${tasks} t
        JOIN ${projects} p ON p.id = t.project_id AND p.deleted_at IS NULL
        LEFT JOIN ${projectMembers} m ON m.project_id = p.id AND m.user_id = ${userId}
        WHERE t.id = ${taskId} AND t.deleted_at IS NULL
        LIMIT 1
    `);
    const row = Array.from(rows)[0];
    if (!row || row.project_id !== projectId) {
        throw new Error("Task not found");
    }
    const role = row.owner_id === userId ? "owner" : row.role;
    if (!role || (role !== "owner" && role !== "admin" && role !== "member")) {
        throw new Error("You do not have permission to perform this project action");
    }
}

async function assertSubtaskWriteAccess(subtaskId: string, projectId: string, userId: string) {
    const rows = await db.execute<{
        id: string;
        project_id: string;
        owner_id: string;
        role: string | null;
    }>(sql`
        SELECT s.id, t.project_id, p.owner_id, m.role
        FROM ${taskSubtasks} s
        JOIN ${tasks} t ON t.id = s.task_id AND t.deleted_at IS NULL
        JOIN ${projects} p ON p.id = t.project_id AND p.deleted_at IS NULL
        LEFT JOIN ${projectMembers} m ON m.project_id = p.id AND m.user_id = ${userId}
        WHERE s.id = ${subtaskId}
        LIMIT 1
    `);
    const row = Array.from(rows)[0];
    if (!row || row.project_id !== projectId) {
        throw new Error("Subtask not found");
    }
    const role = row.owner_id === userId ? "owner" : row.role;
    if (!role || (role !== "owner" && role !== "admin" && role !== "member")) {
        throw new Error("You do not have permission to perform this project action");
    }
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
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return { success: false, error: "Unauthorized" };
        }

        const parsedTitle = taskSubtaskTitleSchema.safeParse(title);
        if (!parsedTitle.success) {
            return { success: false, error: parsedTitle.error.issues[0]?.message || "Invalid subtask title" };
        }
        const trimmedTitle = parsedTitle.data;

        await assertTaskWriteAccess(taskId, projectId, user.id);

        const created = await db.transaction(async (tx) => {
            // ponytail: serialize only appends for this task; drag-and-drop is not a requirement.
            await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`task-subtask:${taskId}`}, 0))`);
            const currentMax = await tx.query.taskSubtasks.findFirst({
                where: eq(taskSubtasks.taskId, taskId),
                columns: { position: true },
                orderBy: [desc(taskSubtasks.position)],
            });
            const [next] = await tx.insert(taskSubtasks).values({
                taskId,
                title: trimmedTitle,
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
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return { success: false, error: "Unauthorized" };
        }

        await assertSubtaskWriteAccess(subtaskId, projectId, user.id);

        const [updated] = await db.update(taskSubtasks).set({
            completed,
            updatedAt: new Date(),
        }).where(eq(taskSubtasks.id, subtaskId)).returning();
        if (!updated) throw new Error("Subtask not found");

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
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) return { success: false, error: "Unauthorized" };

        const parsedTitle = taskSubtaskTitleSchema.safeParse(title);
        if (!parsedTitle.success) {
            return { success: false, error: parsedTitle.error.issues[0]?.message || "Invalid subtask title" };
        }
        const trimmedTitle = parsedTitle.data;

        await assertSubtaskWriteAccess(subtaskId, projectId, user.id);
        const [updated] = await db.update(taskSubtasks).set({
            title: trimmedTitle,
            updatedAt: new Date(),
        }).where(eq(taskSubtasks.id, subtaskId)).returning();
        if (!updated) throw new Error("Subtask not found");

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
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return { success: false, error: "Unauthorized" };
        }

        await assertSubtaskWriteAccess(subtaskId, projectId, user.id);

        await db.delete(taskSubtasks).where(eq(taskSubtasks.id, subtaskId));

        return { success: true };
    } catch (error: any) {
        console.error("Unexpected error:", error);
        return { success: false, error: error?.message || "Failed to delete subtask" };
    }
}

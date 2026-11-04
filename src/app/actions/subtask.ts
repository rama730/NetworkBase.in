"use server";

import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { workspaceMembers, workspaces, taskSubtasks, tasks } from "@/lib/db/schema";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { taskSubtaskTitleSchema } from "@/lib/validations/task";

import { lockSubtaskWriteScope } from "@/lib/workspaces/subtask-write-scope";

async function requireSubtaskWriter() {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error("Sign in to continue");
    const { allowed } = await consumeRateLimit(`task:${user.id}`, 60, 60);
    if (!allowed) throw new Error("Too many attempts. Try again in a minute.");
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
        // Review UX 1.9: a step on a main assignment goes to every copy, as Add step does.
        const [owner] = await db.select({ kind: tasks.kind, assignmentId: tasks.assignmentId }).from(tasks).where(eq(tasks.id, taskId)).limit(1);
        if (owner?.kind === "assignment" && !owner.assignmentId) {
            const { addAssignmentStepAction } = await import("@/app/actions/assignments");
            const added = await addAssignmentStepAction(taskId, parsedTitle.data);
            return added.success ? { success: true } : { success: false, error: added.error };
        }

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
        return { success: false, error: error?.message || "Couldn’t create subtask" };
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
                // Shared team copies show who ticked each step (report §16.11).
                completedBy: completed ? user.id : null,
                updatedAt: new Date(),
            }).where(eq(taskSubtasks.id, subtaskId)).returning();
            if (!row) throw new Error("Subtask not found");
            return row;
        });

        return { success: true, data: updated };
    } catch (error: any) {
        console.error("Unexpected error:", error);
        return { success: false, error: error?.message || "Couldn’t toggle subtask" };
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
        return { success: false, error: error?.message || "Couldn’t update subtask" };
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
        return { success: false, error: error?.message || "Couldn’t delete subtask" };
    }
}

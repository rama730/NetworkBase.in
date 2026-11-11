"use server";

import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { labelScope, visibleVia } from "@/lib/agents/via-scope";
import type { ViaShown } from "@/lib/agents/via-visibility";
import { assertTaskAccess } from "@/lib/domain/task-comments";
import { db } from "@/lib/db";
import { workspaceMembers, workspaces, taskSubtasks, tasks } from "@/lib/db/schema";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { taskSubtaskTitleSchema } from "@/lib/validations/task";

import { lockSubtaskWriteScope } from "@/lib/workspaces/subtask-write-scope";
import { startCopyOnWork } from "@/lib/organizations/assignments";

/** Rows go back to whoever acted, who may not be allowed to see the label: labels come from readTaskSubtaskLabelsAction. */
function withoutVia<T extends { via?: unknown; agentName?: unknown } | undefined>(row: T) {
    if (!row) return row;
    const { via: _via, agentName: _agentName, ...rest } = row;
    return rest;
}

async function requireSubtaskWriter() {
    // Browser session or a CLI/agent token on an allowed route (report A2.1).
    const { user } = await requireAuthenticatedUser();
    if (!user) throw new Error("Sign in to continue");
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
                createdBy: user.id,
                title: parsedTitle.data,
                completed: false,
                position: (currentMax?.position ?? -1) + 1,
            }).returning();
            return next;
        });

        return { success: true, data: withoutVia(created) };
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
            // Assignment flow decision 1: ticking the first step on a copy in To do starts it.
            if (completed) await startCopyOnWork(tx, row.taskId, user.id, { kind: "step", name: row.title });
            return row;
        });

        return { success: true, data: withoutVia(updated) };
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

        return { success: true, data: withoutVia(updated) };
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

/**
 * "with Claude Code" on a task's subtasks, for this viewer (report Part B). Browsers can't read via / agent_name
 * (0086), so the task panel asks here; only labels this viewer may see come back.
 */
export async function readTaskSubtaskLabelsAction(projectId: string, taskId: string, subtaskIds: string[]): Promise<Record<string, ViaShown>> {
    const ids = z.array(z.string().uuid()).max(200).parse(subtaskIds);
    z.string().uuid().parse(projectId);
    z.string().uuid().parse(taskId);
    const { user } = await requireAuthenticatedUser();
    if (!user || !ids.length) return {};
    await assertTaskAccess({ taskId, projectId, userId: user.id, mode: "read" });
    const rows = await db.select({ id: taskSubtasks.id, via: taskSubtasks.via, agentName: taskSubtasks.agentName, createdBy: taskSubtasks.createdBy })
        .from(taskSubtasks)
        .where(and(eq(taskSubtasks.taskId, taskId), inArray(taskSubtasks.id, ids), isNotNull(taskSubtasks.via)));
    if (!rows.length) return {};
    const labels = await labelScope(user.id, projectId, taskId);
    const out: Record<string, ViaShown> = {};
    for (const r of rows) {
        const shown = visibleVia(labels, { via: r.via, agentName: r.agentName, authorId: r.createdBy });
        if (shown.via) out[r.id] = shown;
    }
    return out;
}

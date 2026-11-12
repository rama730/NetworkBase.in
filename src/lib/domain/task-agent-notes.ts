import "server-only";

import { and, desc, eq, notInArray, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { taskAgentNotes } from "@/lib/db/schema";
import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { readableTask, TaskMetaError } from "@/lib/domain/task-meta";

/**
 * Report D16 (0089): where an agent stopped on a task, so the next session (any computer) carries on. Anyone who can
 * read the task reads them, with the task; writing one needs the same; the note's person or the workspace's
 * owner and admins delete them.
 */
export const AGENT_NOTES_KEPT = 20;
const columns = { id: taskAgentNotes.id, note: taskAgentNotes.note, agentName: taskAgentNotes.agentName, sessionId: taskAgentNotes.sessionId, userId: taskAgentNotes.userId, createdAt: taskAgentNotes.createdAt };

export async function listAgentNotes(userId: string, taskId: string) {
  await readableTask(taskId, userId);
  return db.select(columns).from(taskAgentNotes).where(eq(taskAgentNotes.taskId, taskId)).orderBy(desc(taskAgentNotes.createdAt), desc(taskAgentNotes.id)).limit(AGENT_NOTES_KEPT);
}

export async function addAgentNote(userId: string, taskId: string, input: { note: string; agentName: string | null; sessionId: string | null }) {
  const task = await readableTask(taskId, userId);
  // A note is shown to everyone on the task, like a comment: it needs the right to change the task.
  if (!(await getWorkspaceAccessById(task.projectId, userId)).canWrite) throw new TaskMetaError("Only people who can change this task can leave agent notes on it", 403);
  return db.transaction(async (tx) => {
    // One writer at a time per task, so the trim below never races another insert.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`agent-notes:${taskId}`}, 0))`);
    const [row] = await tx.insert(taskAgentNotes).values({ taskId, userId, note: input.note, agentName: input.agentName, sessionId: input.sessionId }).returning(columns);
    const keep = tx.select({ id: taskAgentNotes.id }).from(taskAgentNotes).where(eq(taskAgentNotes.taskId, taskId)).orderBy(desc(taskAgentNotes.createdAt), desc(taskAgentNotes.id)).limit(AGENT_NOTES_KEPT);
    await tx.delete(taskAgentNotes).where(and(eq(taskAgentNotes.taskId, taskId), notInArray(taskAgentNotes.id, keep)));
    return row!;
  });
}

export async function deleteAgentNote(userId: string, taskId: string, noteId: string) {
  const task = await readableTask(taskId, userId);
  const [note] = await db.select({ userId: taskAgentNotes.userId }).from(taskAgentNotes).where(and(eq(taskAgentNotes.id, noteId), eq(taskAgentNotes.taskId, taskId))).limit(1);
  if (!note) throw new TaskMetaError("Note not found", 404);
  if (note.userId !== userId) {
    const access = await getWorkspaceAccessById(task.projectId, userId);
    if (!access.isOwner && access.member?.role !== "admin") throw new TaskMetaError("Only the note's person or the workspace's owner and admins can delete it", 403);
  }
  await db.delete(taskAgentNotes).where(eq(taskAgentNotes.id, noteId));
}

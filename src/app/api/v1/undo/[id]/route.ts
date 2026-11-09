import { and, eq, isNull, sql } from "drizzle-orm";

import { routeErrorResponse } from "@/app/api/v1/_error";
import { denyOutsideTokenWorkspace, getRequestId, idempotentWrite, jsonError, jsonSuccess, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { bulkTrashNodes } from "@/app/actions/files/mutations";
import { updateSubtaskAction } from "@/app/actions/subtask";
import { assignTaskAction, updateTaskFieldAction } from "@/app/actions/task";
import { findUndo, type UndoInverse } from "@/lib/agents/policy";
import { db } from "@/lib/db";
import { fileVersions, taskComments, taskSubtasks, tasks, undoOperations, workspaceNodes } from "@/lib/db/schema";
import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { applyFileRevision } from "@/lib/files/apply-file-revision";
import { withTransientFileLease } from "@/lib/files/file-lock-service";
import { validateCsrf } from "@/lib/security/csrf";
import { deleteTaskAs } from "@/lib/workspaces/server/tasks";
import { lockSubtaskWriteScope } from "@/lib/workspaces/subtask-write-scope";
import { afterTaskTransition, lockTaskForWrite, transitionTaskTx } from "@/lib/workspaces/task-transition-service";
import type { TaskStatus } from "@/lib/workspaces/task-transition-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

class Changed extends Error {
  constructor(message: string, readonly code: "TASK_CHANGED" | "VERSION_CONFLICT" = "TASK_CHANGED") {
    super(message);
  }
}

/** Runs the inverse of one change made with a token, if nothing has happened since that it would undo (A2.9). */
async function runInverse(user: { id: string; email?: string; user_metadata?: Record<string, unknown> }, inverse: UndoInverse) {
  switch (inverse.kind) {
    case "task.delete": {
      const [task] = await db.select({ creatorId: tasks.creatorId, deletedAt: tasks.deletedAt }).from(tasks).where(eq(tasks.id, inverse.taskId)).limit(1);
      if (!task || task.deletedAt) throw new Changed("The task is already gone");
      if (task.creatorId !== user.id) throw new Changed("Only the person who created the task can undo it");
      const result = await deleteTaskAs(user, inverse.taskId, inverse.projectId, { undoOwnCreate: true });
      if (!result.success) throw new Error(result.error ?? "Couldn’t remove the task");
      return "Removed the task";
    }
    case "subtask.delete":
    case "subtask.set": {
      await db.transaction(async (tx) => {
        await lockSubtaskWriteScope(tx, { subtaskId: inverse.subtaskId }, inverse.projectId, user.id);
        const [current] = await tx.select({ completed: taskSubtasks.completed }).from(taskSubtasks).where(eq(taskSubtasks.id, inverse.subtaskId)).limit(1);
        if (!current) throw new Changed("The subtask is already gone");
        if (inverse.kind === "subtask.delete") await tx.delete(taskSubtasks).where(eq(taskSubtasks.id, inverse.subtaskId));
        else {
          if (current.completed === inverse.completed) throw new Changed("Someone already changed that subtask back");
          await tx.update(taskSubtasks).set({ completed: inverse.completed, updatedAt: new Date() }).where(eq(taskSubtasks.id, inverse.subtaskId));
        }
      });
      return inverse.kind === "subtask.delete" ? "Removed the subtask" : `${inverse.completed ? "Ticked" : "Unticked"} the subtask again`;
    }
    case "comment.delete": {
      const removed = await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${inverse.commentId}, 0))`);
        const [replies] = await tx.select({ n: sql<number>`count(*)::int` }).from(taskComments).where(and(eq(taskComments.parentCommentId, inverse.commentId)));
        if ((replies?.n ?? 0) > 0) throw new Changed("Someone replied to the comment, so it stays");
        return tx.delete(taskComments).where(and(eq(taskComments.id, inverse.commentId), eq(taskComments.userId, user.id))).returning({ id: taskComments.id });
      });
      if (!removed.length) throw new Changed("The comment is already gone");
      return "Removed the comment";
    }
    case "task.status": {
      const changed = await db.transaction(async (tx) => {
        const locked = await lockTaskForWrite(tx, inverse.taskId, user.id);
        if (locked.currentStatus !== inverse.expectFrom) throw new Changed(`The task is ${locked.currentStatus} now, not ${inverse.expectFrom}`);
        const result = await transitionTaskTx(tx, locked, { taskId: inverse.taskId, userId: user.id, status: inverse.to as TaskStatus });
        return { locked, result };
      });
      await afterTaskTransition(user as Parameters<typeof afterTaskTransition>[0], changed.locked, inverse.taskId, changed.result);
      return `Moved the task back to ${inverse.to.replace("_", " ")}`;
    }
    case "task.field": {
      const [task] = await db.select({ title: tasks.title, description: tasks.description, priority: tasks.priority, dueDate: tasks.dueDate }).from(tasks).where(eq(tasks.id, inverse.taskId)).limit(1);
      const current = task ? task[inverse.field] : undefined;
      const now = current instanceof Date ? current.toISOString() : current ?? null;
      const same = inverse.field === "dueDate" ? (now ? Date.parse(now) : null) === (inverse.expect ? Date.parse(inverse.expect) : null) : now === inverse.expect;
      if (!same) throw new Changed(`Someone changed the ${inverse.field} since`);
      const result = await updateTaskFieldAction(inverse.taskId, inverse.field, inverse.value, inverse.projectId);
      if (!result.success) throw new Error(result.error ?? "Couldn’t change it back");
      return `Changed the ${inverse.field} back`;
    }
    case "task.assign": {
      const [task] = await db.select({ assigneeId: tasks.assigneeId }).from(tasks).where(eq(tasks.id, inverse.taskId)).limit(1);
      if ((task?.assigneeId ?? null) !== inverse.expect) throw new Changed("Someone reassigned the task since");
      const result = await assignTaskAction(inverse.taskId, inverse.assigneeId, inverse.projectId);
      if (!result.success) throw new Error(result.error ?? "Couldn’t reassign it");
      return inverse.assigneeId ? "Gave the task back to who had it" : "Unassigned the task again";
    }
    case "subtask.title": {
      const [sub] = await db.select({ title: taskSubtasks.title }).from(taskSubtasks).where(eq(taskSubtasks.id, inverse.subtaskId)).limit(1);
      if (!sub) throw new Changed("The subtask is already gone");
      if (sub.title !== inverse.expect) throw new Changed("Someone renamed the subtask since");
      const result = await updateSubtaskAction(inverse.subtaskId, inverse.title, inverse.projectId);
      if (!result.success) throw new Error(result.error ?? "Couldn’t rename it back");
      return "Renamed the subtask back";
    }
    case "files.restore": {
      const created = inverse.files.filter((f) => f.created).map((f) => f.nodeId);
      // Check every file first, so undo is all or nothing.
      for (const f of inverse.files) {
        const [node] = await db.select({ version: workspaceNodes.currentVersion, deletedAt: workspaceNodes.deletedAt }).from(workspaceNodes).where(eq(workspaceNodes.id, f.nodeId)).limit(1);
        if (!node || node.deletedAt) throw new Changed("A pushed file is already gone", "VERSION_CONFLICT");
        if (node.version !== f.version) throw new Changed("Someone saved a newer version of a pushed file since", "VERSION_CONFLICT");
      }
      for (const f of inverse.files.filter((x) => !x.created && x.previousVersion)) {
        const [source] = await db.select().from(fileVersions).where(and(eq(fileVersions.nodeId, f.nodeId), eq(fileVersions.version, f.previousVersion!))).limit(1);
        if (!source) throw new Changed("The earlier version is gone", "VERSION_CONFLICT");
        await withTransientFileLease({ projectId: inverse.projectId, nodeId: f.nodeId, userId: user.id }, (lease) =>
          applyFileRevision({
            projectId: inverse.projectId, nodeId: f.nodeId, actorUserId: user.id, storageKey: source.s3Key, assetId: source.assetId ?? null, size: source.size,
            mimeType: source.mimeType, contentHash: source.contentHash, mode: "new_revision", comment: `Undo: back to version ${f.previousVersion}`, lease,
            accessRequirement: "write", eventType: "restore_file_version", eventMetadata: { restoredFrom: f.previousVersion, undo: true },
          }));
      }
      if (created.length) await bulkTrashNodes(created, inverse.projectId);
      return `Undid the push of ${inverse.files.length} file${inverse.files.length === 1 ? "" : "s"}`;
    }
  }
}

/** Undo a change made with a token in the last 24 hours (report A2.9): `nb undo`, the MCP tool, or the app. */
async function handlePost(request: Request, context: { params: Promise<{ id: string }> }) {
  const csrf = validateCsrf(request);
  if (csrf) return csrf;
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    const { id } = await context.params;
    const op = await findUndo(id, auth.user.id);
    if (!op) return jsonError("Nothing to undo: it was undone already, is older than 24 hours, or isn't yours", 410, "EXPIRED");
    const outside = await denyOutsideTokenWorkspace(auth, { projectId: op.workspaceId });
    if (outside) return outside;
    if (!(await getWorkspaceAccessById(op.workspaceId, auth.user.id)).canWrite) return jsonError("You can't change this workspace any more", 403, "FORBIDDEN");
    // Claim it first, so two undos of the same change can't both run.
    const [claimed] = await db.update(undoOperations).set({ usedAt: new Date() }).where(and(eq(undoOperations.id, op.id), isNull(undoOperations.usedAt))).returning({ id: undoOperations.id });
    if (!claimed) return jsonError("That was undone already", 410, "EXPIRED");
    try {
      const done = await runInverse(auth.user, op.inverse as unknown as UndoInverse);
      return jsonSuccess({ undone: op.summary, result: done, operation: op.operation });
    } catch (error) {
      await db.update(undoOperations).set({ usedAt: null }).where(eq(undoOperations.id, op.id));
      if (error instanceof Changed) return jsonError(error.message, 409, error.code);
      throw error;
    }
  } catch (error) {
    return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/undo", fallback: "Couldn’t undo that" });
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return idempotentWrite(request, "undo", (req) => handlePost(req, context));
}

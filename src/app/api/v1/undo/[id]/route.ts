import { and, eq, isNull, sql } from "drizzle-orm";

import { routeErrorResponse } from "@/app/api/v1/_error";
import { journeyError } from "@/app/api/v1/_member-journey";
import { denyOutsideTokenWorkspace, getRequestId, idempotentWrite, jsonError, jsonSuccess, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { bulkTrashNodes } from "@/app/actions/files/mutations";
import { updateSubtaskAction } from "@/app/actions/subtask";
import { assignTaskAction, updateTaskFieldAction } from "@/app/actions/task";
import { findUndo, STATUS_WORDS, taskList, type UndoInverse } from "@/lib/agents/policy";
import { db } from "@/lib/db";
import { ChangeSetError, undoFromToken } from "@/lib/domain/change-sets";
import { taskComments, taskSubtasks, tasks, undoOperations, workspaceNodes } from "@/lib/db/schema";
import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { ActiveVersionChangedError, activateFileVersion } from "@/lib/files/activate-file-version";
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

/** A bulk undo's step is only taken when its task is still as the change left it (checked for all first). */
async function stillAsLeft(step: Extract<UndoInverse, { kind: "tasks.bulk" }>["steps"][number]) {
  const [task] = await db.select({ status: tasks.status, assigneeId: tasks.assigneeId, priority: tasks.priority, dueDate: tasks.dueDate }).from(tasks).where(eq(tasks.id, step.taskId)).limit(1);
  if (!task) return false;
  if (step.kind === "task.status") return task.status === step.expectFrom;
  if (step.kind === "task.assign") return (task.assigneeId ?? null) === step.expect;
  if (step.field === "dueDate") return (task.dueDate ? task.dueDate.getTime() : null) === (step.expect ? Date.parse(step.expect) : null);
  return (task[step.field as "priority"] ?? null) === step.expect;
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
      const [numbered] = await db.select({ n: tasks.taskNumber }).from(tasks).where(eq(tasks.id, inverse.taskId)).limit(1);
      // Plain words (report C16 #6): "Moved #1 back to In progress".
      return `Moved ${numbered?.n ? `#${numbered.n}` : "the task"} back to ${STATUS_WORDS[inverse.to] ?? inverse.to}`;
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
    case "tasks.bulk": {
      // All or nothing (report C2): if any task moved on since, none is put back.
      for (const [i, step] of inverse.steps.entries()) {
        if (!(await stillAsLeft(step))) throw new Changed(`#${inverse.numbers[i] ?? "?"} changed since, so nothing was put back`);
      }
      for (const step of inverse.steps) await runInverse(user, step);
      const which = taskList(inverse.numbers);
      // One status for all of them reads "back to In progress"; different ones (found live) just "back".
      const to = new Set(inverse.steps.map((s) => (s.kind === "task.status" ? s.to : null)));
      const [only] = [...to];
      return to.size === 1 && only ? `Moved ${which} back to ${STATUS_WORDS[only] ?? only}` : `Put ${which} back`;
    }
    case "files.restore": {
      const created = inverse.files.filter((f) => f.created).map((f) => f.nodeId);
      // Check every file first, so undo is all or nothing.
      for (const f of inverse.files) {
        const [node] = await db.select({ version: workspaceNodes.currentVersion, deletedAt: workspaceNodes.deletedAt }).from(workspaceNodes).where(eq(workspaceNodes.id, f.nodeId)).limit(1);
        if (!node || node.deletedAt) throw new Changed("A pushed file is already gone", "VERSION_CONFLICT");
        if (node.version !== f.version) throw new Changed("Someone saved a newer version of a pushed file since", "VERSION_CONFLICT");
      }
      // Back to the version that was active before the push: the pushed version stays in the history, not active.
      for (const f of inverse.files.filter((x) => !x.created && x.previousVersion)) {
        await withTransientFileLease({ projectId: inverse.projectId, nodeId: f.nodeId, userId: user.id }, (lease) =>
          activateFileVersion({
            projectId: inverse.projectId, nodeId: f.nodeId, actorUserId: user.id, version: f.previousVersion!, lease, expectActive: f.version,
            eventMetadata: { undo: true },
          })).catch((error) => {
          if (error instanceof ActiveVersionChangedError) throw new Changed("Someone saved a newer version of a pushed file since", "VERSION_CONFLICT");
          if (error instanceof Error && error.message === "Version not found") throw new Changed("The earlier version is gone", "VERSION_CONFLICT");
          throw error;
        });
      }
      if (created.length) await bulkTrashNodes(created, inverse.projectId);
      if (inverse.use) return `v${inverse.files[0]?.previousVersion} is active again`;
      return `Undid the push of ${inverse.files.length} file${inverse.files.length === 1 ? "" : "s"}`;
    }
    case "changeset.undo":
      throw new Error("Change set undos run through undoFromToken");
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
    // Member settings §3/§4: undoing your own completion or leave is about your membership, which is read-only or gone.
    const memberJourney = op.operation === "member.complete" || op.operation === "member.leave";
    if (!memberJourney && !(await getWorkspaceAccessById(op.workspaceId, auth.user.id)).canWrite) return jsonError("You can't change this workspace any more", 403, "FORBIDDEN");
    // Claim it first, so two undos of the same change can't both run.
    const [claimed] = await db.update(undoOperations).set({ usedAt: new Date() }).where(and(eq(undoOperations.id, op.id), isNull(undoOperations.usedAt))).returning({ id: undoOperations.id });
    if (!claimed) return jsonError("That was undone already", 410, "EXPIRED");
    try {
      if (memberJourney) {
        const { undoMemberJourney } = await import("@/lib/workspaces/member-journey");
        await undoMemberJourney(op.inverse as never, auth.user.id);
        return jsonSuccess({ undone: op.summary, result: { undone: true }, operation: op.operation });
      }
      const inverse = op.inverse as unknown as UndoInverse;
      const done = inverse.kind === "changeset.undo" ? await undoFromToken(auth, inverse.changeSetId) : await runInverse(auth.user, inverse);
      return jsonSuccess({ undone: op.summary, result: done, operation: op.operation });
    } catch (error) {
      await db.update(undoOperations).set({ usedAt: null }).where(eq(undoOperations.id, op.id));
      if (error instanceof Changed) return jsonError(error.message, 409, error.code);
      if (error instanceof ChangeSetError) return jsonError(error.message, error.status, error.code as never, error.details);
      return journeyError(error); // a member-journey refusal as its error; anything else is rethrown

    }
  } catch (error) {
    return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/undo", fallback: "Couldn’t undo that" });
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return idempotentWrite(request, "undo", (req) => handlePost(req, context));
}

/** What an undo would do, before doing it (report C10, `nb undo --list`): the change's summary and when it expires. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    const { id } = await context.params;
    const op = await findUndo(id, auth.user.id);
    if (!op) return jsonError("Nothing to undo: it was undone already, is older than 24 hours, or isn't yours", 410, "EXPIRED");
    // An agent only sees changes in its own workspace, as with POST.
    const outside = await denyOutsideTokenWorkspace(auth, { projectId: op.workspaceId });
    if (outside) return outside;
    return jsonSuccess({ id: op.id, summary: op.summary, operation: op.operation, createdAt: op.createdAt, expiresAt: op.expiresAt }, undefined, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/undo", fallback: "Couldn’t read the undo" });
  }
}

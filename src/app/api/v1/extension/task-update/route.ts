import { validateCsrf } from "@/lib/security/csrf";
import {requireAuthenticatedUser,
  requireTokenScope,
  jsonSuccess,
  jsonError,
  getRequestId,
  idempotentWrite, denyOutsideTokenWorkspace
} from "@/app/api/v1/_shared";
import { routeErrorResponse } from "@/app/api/v1/_error";
import { db } from "@/lib/db";
import {
  taskActivityEvents,
  workspaceNodeEvents,
  workspaceNodes,
  fileVersions,
  taskSubtasks,
  tasks,
} from "@/lib/db/schema";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import {
  lockTaskForWrite,
  transitionTaskTx,
  afterTaskTransition,
} from "@/lib/workspaces/task-transition-service";
import { lockSubtaskWriteScope } from "@/lib/workspaces/subtask-write-scope";
import { approveTaskReviewAction, assignTaskAction, requestTaskChangesAction, resubmitTaskReviewAction, updateTaskFieldAction } from "@/app/actions/task";
import { deleteSubtaskAction, updateSubtaskAction } from "@/app/actions/subtask";
import { deleteTaskAs } from "@/lib/workspaces/server/tasks";
import {
  extensionReviewEvidenceSchema,
  classifyReportedCheck,
} from "@/lib/extension/review-evidence";
import { viaPayload } from "@/lib/server/request-via";
import { taskUpdateSchema } from "@/lib/api/v1-schemas";
import { agentGate, isOthersTask, recordUndo, type ChangeKind } from "@/lib/agents/policy";
export const runtime = "nodejs";
async function handlePatch(request: Request) {
  const csrf = validateCsrf(request);
  if (csrf) return csrf;
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    const user = auth.user;
    if (!user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    const parsed = taskUpdateSchema.safeParse(await request.json());
    if (!parsed.success)
      return jsonError("Invalid task update", 400, "BAD_REQUEST");
    const input = parsed.data;
    const outside = await denyOutsideTokenWorkspace(auth, { projectId: input.projectId, taskId: input.taskId });
    if (outside) return outside;
    // Finishing and reviewing need their own token permissions (report A3.6).
    const scopeDenied =
      input.kind === "approve" || input.kind === "request_changes"
        ? requireTokenScope(auth, "task:review")
        : input.kind === "resubmit" || (input.kind === "status" && input.status === "done")
          ? requireTokenScope(auth, "task:complete")
          : null;
    if (scopeDenied) return scopeDenied;
    // Which changes an agent's person has to agree to first (report §26.6).
    const others = await isOthersTask(input.taskId, user.id);
    const kinds: ChangeKind[] = [
      input.kind === "approve" || input.kind === "request_changes" ? "review" : input.kind === "resubmit" || (input.kind === "status" && input.status === "done") ? "done" : input.kind === "delete" ? "delete" : "small",
      others || (input.kind === "assign" && input.assigneeId && input.assigneeId !== user.id) ? "others-task" : "small",
    ];
    const what =
      input.kind === "status" ? (input.status === "done" ? "Finish the task" : `Move the task to ${input.status.replace("_", " ")}`)
      : input.kind === "subtask" ? `${input.completed ? "Tick" : "Untick"} a subtask`
      : input.kind === "edit" ? `Change the task's ${input.field}`
      : input.kind === "assign" ? (input.assigneeId ? "Assign the task" : "Unassign the task")
      : input.kind === "delete" ? "Delete the task"
      : input.kind === "subtask_edit" ? "Rename a subtask" : input.kind === "subtask_delete" ? "Delete a subtask" : input.kind === "subtask_move" ? "Reorder a subtask"
      : input.kind === "approve" ? "Approve the task" : input.kind === "request_changes" ? "Ask for changes on the task" : "Send the task for review again";
    // The yes covers this change and its report, not each check's id and run times: `nb task done --check` makes new
    // ones on every run, so a yes for the first run never matched the confirmed one (found 2026-11-10).
    const bound = "evidence" in input && input.evidence
      ? { ...input, evidence: { ...input.evidence, checks: input.evidence.checks?.map(({ id: _id, startedAt: _s, endedAt: _e, ...check }) => check) } }
      : input;
    const held = await agentGate(auth, request, bound, { workspaceId: input.projectId, kinds, summary: `${what}${others ? " (assigned to someone else)" : ""}`, taskId: input.taskId });
    if (held) return held;
    if (input.kind === "request_changes" || input.kind === "resubmit") {
      const result = input.kind === "resubmit"
        ? await resubmitTaskReviewAction(input.taskId, input.projectId, input.expectedUpdatedAt)
        : await requestTaskChangesAction(input.taskId, input.projectId, input.reason, input.expectedUpdatedAt);
      return result.success ? jsonSuccess(result) : jsonError(result.error || "Review update failed", 409, "CONFLICT");
    }
    if (input.kind === "approve") {
      const result = await approveTaskReviewAction(
        input.taskId,
        input.projectId,
        input.expectedUpdatedAt,
      );
      return result.success
        ? jsonSuccess(result)
        : jsonError(result.error || "Approval failed", 409, "CONFLICT");
    }
    const limit = await consumeRateLimit(`task:${user.id}`, 60, 60);
    if (!limit.allowed)
      return jsonError("Too many attempts. Try again in a minute.", 429, "RATE_LIMITED");
    if (input.kind === "edit" || input.kind === "assign" || input.kind === "delete") {
      const [before] = await db.select({ title: tasks.title, description: tasks.description, priority: tasks.priority, dueDate: tasks.dueDate, assigneeId: tasks.assigneeId }).from(tasks).where(and(eq(tasks.id, input.taskId), eq(tasks.projectId, input.projectId))).limit(1);
      if (!before) return jsonError("Task not found", 404, "NOT_FOUND");
      if (input.kind === "delete") {
        const result = await deleteTaskAs(user, input.taskId, input.projectId);
        return result.success ? jsonSuccess({ deleted: true }) : jsonError(result.error ?? "Couldn’t delete the task", 403, "FORBIDDEN");
      }
      if (input.kind === "assign") {
        const result = await assignTaskAction(input.taskId, input.assigneeId, input.projectId);
        if (!result.success) return jsonError(result.error ?? "Couldn’t assign the task", 400, "BAD_REQUEST");
        const undoToken = await recordUndo(auth, { workspaceId: input.projectId, operation: "task.assign", summary: input.assigneeId ? "Assigned the task" : "Unassigned the task", inverse: { kind: "task.assign", taskId: input.taskId, projectId: input.projectId, assigneeId: before.assigneeId, expect: input.assigneeId } });
        return jsonSuccess({ ...result, undoToken });
      }
      const previous = before[input.field] instanceof Date ? (before[input.field] as Date).toISOString() : (before[input.field] as string | null);
      const result = await updateTaskFieldAction(input.taskId, input.field, input.value, input.projectId);
      if (!result.success) return jsonError(result.error ?? "Couldn’t change the task", 400, "BAD_REQUEST");
      const undoToken = await recordUndo(auth, { workspaceId: input.projectId, operation: "task.edit", summary: `Changed the task's ${input.field}`, inverse: { kind: "task.field", taskId: input.taskId, projectId: input.projectId, field: input.field, value: previous, expect: input.value } });
      return jsonSuccess({ ...result, undoToken });
    }
    if (input.kind === "subtask_edit" || input.kind === "subtask_delete" || input.kind === "subtask_move") {
      const [sub] = await db.select({ title: taskSubtasks.title, taskId: taskSubtasks.taskId }).from(taskSubtasks).where(eq(taskSubtasks.id, input.subtaskId)).limit(1);
      if (!sub || sub.taskId !== input.taskId) return jsonError("Subtask not found", 404, "NOT_FOUND");
      if (input.kind === "subtask_edit") {
        const result = await updateSubtaskAction(input.subtaskId, input.title, input.projectId);
        if (!result.success) return jsonError(result.error ?? "Couldn’t rename the subtask", 400, "BAD_REQUEST");
        const undoToken = await recordUndo(auth, { workspaceId: input.projectId, operation: "subtask.edit", summary: `Renamed "${sub.title}"`, inverse: { kind: "subtask.title", subtaskId: input.subtaskId, taskId: input.taskId, projectId: input.projectId, title: sub.title, expect: input.title } });
        return jsonSuccess({ ...result, undoToken });
      }
      if (input.kind === "subtask_delete") {
        const result = await deleteSubtaskAction(input.subtaskId, input.projectId);
        return result.success ? jsonSuccess({ deleted: true }) : jsonError(result.error ?? "Couldn’t delete the subtask", 400, "BAD_REQUEST");
      }
      const order = await db.transaction(async (tx) => {
        await lockSubtaskWriteScope(tx, { subtaskId: input.subtaskId }, input.projectId, user.id);
        const rows = await tx.select({ id: taskSubtasks.id }).from(taskSubtasks).where(eq(taskSubtasks.taskId, input.taskId)).orderBy(asc(taskSubtasks.position), asc(taskSubtasks.createdAt));
        const ids = rows.map((r) => r.id).filter((id) => id !== input.subtaskId);
        ids.splice(Math.min(input.position, ids.length), 0, input.subtaskId);
        for (const [position, id] of ids.entries()) await tx.update(taskSubtasks).set({ position, updatedAt: new Date() }).where(eq(taskSubtasks.id, id));
        return ids;
      });
      return jsonSuccess({ order });
    }
    if (input.kind === "subtask") {
      const row = await db.transaction(async (tx) => {
        const taskId = await lockSubtaskWriteScope(
          tx,
          { subtaskId: input.subtaskId },
          input.projectId,
          user.id,
        );
        if (taskId !== input.taskId) throw new Error("Task mismatch");
        const current = await tx.query.taskSubtasks.findFirst({
          where: eq(taskSubtasks.id, input.subtaskId),
        });
        if (
          !current ||
          // Exact, like the task check below: a 5 s window let a stale client undo someone else's change (F59).
          current.updatedAt.getTime() !== new Date(input.expectedUpdatedAt).getTime()
        )
          return null;
        const [updated] = await tx
          .update(taskSubtasks)
          .set({ completed: input.completed, updatedAt: new Date() })
          .where(eq(taskSubtasks.id, input.subtaskId))
          .returning();
        return updated;
      });
      const subtaskUndo = row
        ? await recordUndo(auth, { workspaceId: input.projectId, operation: "subtask.set", summary: `${input.completed ? "Ticked" : "Unticked"} "${row.title}"`, inverse: { kind: "subtask.set", subtaskId: row.id, taskId: input.taskId, projectId: input.projectId, completed: !input.completed } })
        : null;
      return row
        ? jsonSuccess({ subtask: row, undoToken: subtaskUndo })
        : jsonError(
            "Subtask changed elsewhere. Reload before retrying.",
            409,
            "CONFLICT",
          );
    }
    const changed = await db.transaction(async (tx) => {
      const locked = await lockTaskForWrite(tx, input.taskId, user.id);
      if (locked.projectId !== input.projectId)
        throw new Error("Task mismatch");
      if (
        new Date(locked.currentUpdatedAt).getTime() !==
        new Date(input.expectedUpdatedAt).getTime()
      )
        return null;
      const result = await transitionTaskTx(tx, locked, {
        taskId: input.taskId,
        userId: user.id,
        status: input.status,
      });
      if (input.evidence) {
        if (input.status !== "done")
          throw new Error(
            "Completion evidence is only attached to an explicit completion attempt",
          );
        for (const receipt of input.evidence.receipts) {
          const event = await tx.query.workspaceNodeEvents.findFirst({
            where: and(
              eq(workspaceNodeEvents.projectId, input.projectId),
              eq(workspaceNodeEvents.nodeId, receipt.nodeId),
              eq(workspaceNodeEvents.actorId, user.id),
              sql`${workspaceNodeEvents.metadata}->>'operationId' LIKE ${receipt.operationId + ":%"}`,
              sql`${workspaceNodeEvents.metadata}->>'hash' = ${receipt.contentHash}`,
              sql`(${workspaceNodeEvents.metadata}->>'version')::integer = ${receipt.version}`,
            ),
          });
          if (!event)
            throw new Error(
              "A selected publication receipt could not be verified",
            );
        }
        await tx
          .insert(taskActivityEvents)
          .values({
            taskId: input.taskId,
            projectId: input.projectId,
            sprintId: locked.previousSprintId,
            actorId: user.id,
            eventType: result.reviewStatus === "pending" ? "extension_review_evidence" : "extension_completion_evidence",
            payload: { ...(await viaPayload()),
              version: 1,
              summary: input.evidence.summary,
              issues: input.evidence.issues,
              fingerprint: input.evidence.fingerprint,
              checks: input.evidence.checks.map((check) => ({
                ...check,
                meaning: classifyReportedCheck(
                  check,
                  input.evidence!.fingerprint,
                ),
                source: "signed_in_client_report",
              })),
              receipts: input.evidence.receipts,
              expectedTaskVersion: input.expectedUpdatedAt,
              approval: false,
              outcome: result.outcome,
              reviewRequired: result.reviewRequired,
            },
          });
      }
      return { locked, result };
    });
    if (!changed)
      return jsonError(
        "Task changed elsewhere. Reload before retrying.",
        409,
        "CONFLICT",
      );
    const warnings = await afterTaskTransition(
      user,
      changed.locked,
      input.taskId,
      changed.result,
    );
    const from = changed.locked.currentStatus;
    const to = (changed.result as { status?: string }).status ?? input.status;
    const undoToken = from && to && from !== to
      ? await recordUndo(auth, { workspaceId: input.projectId, operation: "task.status", summary: `Moved the task from ${from} to ${to}`, inverse: { kind: "task.status", taskId: input.taskId, projectId: input.projectId, to: from, expectFrom: to } })
      : null;
    return jsonSuccess({ ...changed.result, warnings, undoToken });
  } catch (error) {
    return routeErrorResponse(error, {
      requestId: getRequestId(request),
      scope: "api/v1/extension/task-update",
      fallback: "Task update failed",
    });
  }
}

/** Retries with the same Idempotency-Key and body write once (report A2.4, F72). */
export async function PATCH(request: Request) {
  return idempotentWrite(request, "extension.task-update", handlePatch);
}

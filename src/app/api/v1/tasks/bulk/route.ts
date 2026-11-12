import { and, eq, inArray, isNull } from "drizzle-orm";

import { routeErrorResponse } from "@/app/api/v1/_error";
import { denyOutsideTokenWorkspace, getRequestId, idempotentWrite, jsonError, jsonSuccess, requireAuthenticatedUser, requireTokenScope } from "@/app/api/v1/_shared";
import { assignTaskAction, updateTaskFieldAction } from "@/app/actions/task";
import { agentGate, recordUndo, STATUS_WORDS, taskList as list, type ChangeKind, type UndoInverse } from "@/lib/agents/policy";
import { bulkTaskSchema } from "@/lib/api/v1-schemas";
import { db } from "@/lib/db";
import { tasks } from "@/lib/db/schema";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { validateCsrf } from "@/lib/security/csrf";
import { afterTaskTransition, lockTaskForWrite, transitionTaskTx } from "@/lib/workspaces/task-transition-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Step = Extract<UndoInverse, { kind: "task.status" | "task.field" | "task.assign" }>;

class StepFailed extends Error {}

/** `nb task move 3 4 5 done`, `assign 3 4 --to sam`, `edit 3 4 --due friday` (report C2): all or nothing, one undo. */
async function handlePost(request: Request) {
  const csrf = validateCsrf(request);
  if (csrf) return csrf;
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    const user = auth.user;
    if (!user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    const parsed = bulkTaskSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError("Invalid bulk change", 400, "BAD_REQUEST");
    const { projectId, change } = parsed.data;
    const ids = [...new Set(parsed.data.taskIds)].sort();
    const outside = await denyOutsideTokenWorkspace(auth, { projectId });
    if (outside) return outside;
    if (change.kind === "status" && change.status === "done") {
      const denied = await requireTokenScope(auth, "task:complete");
      if (denied) return denied;
    }
    const rows = await db
      .select({ id: tasks.id, number: tasks.taskNumber, status: tasks.status, assigneeId: tasks.assigneeId, priority: tasks.priority, dueDate: tasks.dueDate })
      .from(tasks)
      .where(and(inArray(tasks.id, ids), eq(tasks.projectId, projectId), isNull(tasks.deletedAt)));
    if (rows.length !== ids.length) return jsonError("Some of those tasks aren’t in this workspace", 404, "NOT_FOUND");
    rows.sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
    const numbers = rows.map((r) => r.number ?? 0);

    const others = rows.some((r) => r.assigneeId && r.assigneeId !== user.id);
    const what = change.kind === "status" ? (change.status === "done" ? "Finish" : `Move to ${STATUS_WORDS[change.status]}`) : change.kind === "assign" ? (change.assigneeId ? "Assign" : "Unassign") : `Change the ${change.field === "dueDate" ? "due date" : "priority"} of`;
    const kinds: ChangeKind[] = [change.kind === "status" && change.status === "done" ? "done" : "small", others || (change.kind === "assign" && change.assigneeId && change.assigneeId !== user.id) ? "others-task" : "small"];
    const held = await agentGate(auth, request, parsed.data, { workspaceId: projectId, kinds, summary: `${what} ${list(numbers)}${others ? " (some assigned to someone else)" : ""}` });
    if (held) return held;
    const limit = await consumeRateLimit(`task:${user.id}`, 60, 60);
    if (!limit.allowed) return jsonError("Too many attempts. Try again in a minute.", 429, "RATE_LIMITED");

    const steps: Step[] = [];
    const numberOf = new Map(rows.map((r) => [r.id, r.number ?? 0]));
    if (change.kind === "status") {
      // One transaction, tasks locked in id order: every task moves, or none does.
      const moved = await db.transaction(async (tx) => {
        const out = [];
        for (const row of [...rows].sort((a, b) => a.id.localeCompare(b.id))) {
          const locked = await lockTaskForWrite(tx, row.id, user.id);
          if (locked.projectId !== projectId) throw new StepFailed(`#${row.number} isn’t in this workspace`);
          const result = await transitionTaskTx(tx, locked, { taskId: row.id, userId: user.id, status: change.status, ...(change.note ? { note: change.note } : {}) });
          out.push({ row, locked, result });
        }
        return out;
      });
      // Undo steps follow the task numbers, so "#2 changed since" names the right task.
      for (const m of moved.sort((a, b) => (a.row.number ?? 0) - (b.row.number ?? 0))) {
        await afterTaskTransition(user, m.locked, m.row.id, m.result);
        const to = (m.result as { status?: string }).status ?? change.status;
        if (m.locked.currentStatus && m.locked.currentStatus !== to) steps.push({ kind: "task.status", taskId: m.row.id, projectId, to: m.locked.currentStatus, expectFrom: to });
      }
    } else {
      // ponytail: assign and edit reuse the one-task actions (permissions, notifications, history), so "all or
      // nothing" is done by putting finished ones back when a later one fails. One transaction needs those
      // actions to take a transaction first.
      const done: Extract<Step, { kind: "task.assign" | "task.field" }>[] = [];
      for (const row of rows) {
        const result = change.kind === "assign"
          ? await assignTaskAction(row.id, change.assigneeId, projectId)
          : await updateTaskFieldAction(row.id, change.field, change.value, projectId);
        if (!result.success) {
          for (const step of done.reverse()) {
            await (step.kind === "task.assign" ? assignTaskAction(step.taskId, step.assigneeId, projectId) : updateTaskFieldAction(step.taskId, step.field, step.value, projectId));
          }
          return jsonError(`#${row.number}: ${result.error ?? "couldn’t change it"}. No task was changed.`, 409, "CONFLICT");
        }
        done.push(change.kind === "assign"
          ? { kind: "task.assign", taskId: row.id, projectId, assigneeId: row.assigneeId, expect: change.assigneeId }
          : { kind: "task.field", taskId: row.id, projectId, field: change.field, value: change.field === "dueDate" ? row.dueDate?.toISOString() ?? null : row.priority, expect: change.value });
      }
      steps.push(...done);
    }
    const summary = `${what} ${list(numbers)}`;
    const undoToken = steps.length ? await recordUndo(auth, { workspaceId: projectId, operation: "tasks.bulk", summary, inverse: { kind: "tasks.bulk", projectId, numbers: steps.map((s) => numberOf.get(s.taskId) ?? 0), steps } }) : null;
    return jsonSuccess({ changed: rows.length, tasks: rows.map((r) => ({ id: r.id, number: r.number })), summary, undoToken });
  } catch (error) {
    if (error instanceof StepFailed) return jsonError(`${error.message}. No task was changed.`, 409, "CONFLICT");
    return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/tasks/bulk", fallback: "Couldn’t change those tasks. No task was changed." });
  }
}

export async function POST(request: Request) {
  return idempotentWrite(request, "tasks.bulk", handlePost);
}

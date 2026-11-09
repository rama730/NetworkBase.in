import { validateCsrf } from "@/lib/security/csrf";
import {requireAuthenticatedUser,
  jsonSuccess,
  jsonError,
  getRequestId,
  idempotentWrite, denyOutsideTokenWorkspace
} from "@/app/api/v1/_shared";
import { routeErrorResponse } from "@/app/api/v1/_error";
import { db } from "@/lib/db";
import { tasks, taskSubtasks, workspaces } from "@/lib/db/schema";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { lockSubtaskWriteScope } from "@/lib/workspaces/subtask-write-scope";
import { taskSubtaskTitleSchema } from "@/lib/validations/task";
import { viaColumns } from "@/lib/server/request-via";
import { addSubtaskSchema } from "@/lib/api/v1-schemas";
import { agentGate, isOthersTask, recordUndo } from "@/lib/agents/policy";

export const runtime = "nodejs";

async function handlePost(request: Request) {
  const csrf = validateCsrf(request);
  if (csrf) return csrf;

  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    const user = auth.user;
    if (!user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");

    const body = await request.json().catch(() => null);
    const parsed = addSubtaskSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message || "Invalid subtask payload", 400, "BAD_REQUEST");
    }

    const { projectId, taskId: rawTaskId, title } = parsed.data;
    const outside = await denyOutsideTokenWorkspace(auth, { projectId, taskId: rawTaskId });
    if (outside) return outside;

    const limit = await consumeRateLimit(`task:${user.id}`, 60, 60);
    if (!limit.allowed) {
      return jsonError("Too many attempts. Try again in a minute.", 429, "RATE_LIMITED");
    }

    // Resolve taskId if provided as task number (e.g. "#4" or "4")
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    let resolvedTaskId = rawTaskId;

    if (!UUID_REGEX.test(rawTaskId)) {
      const numCandidate = rawTaskId.replace(/^(?:[a-zA-Z]+-)?#?/, "");
      if (/^\d+$/.test(numCandidate)) {
        const [found] = await db
          .select({ id: tasks.id })
          .from(tasks)
          .where(and(eq(tasks.projectId, projectId), eq(tasks.taskNumber, Number(numCandidate))))
          .limit(1);
        if (found) {
          resolvedTaskId = found.id;
        } else {
          return jsonError(`Task #${numCandidate} not found in this workspace`, 404, "NOT_FOUND");
        }
      } else {
        return jsonError("Invalid task identifier", 400, "BAD_REQUEST");
      }
    }

    // Verify task belongs to project
    const [targetTask] = await db
      .select({ id: tasks.id, kind: tasks.kind, assignmentId: tasks.assignmentId })
      .from(tasks)
      .where(and(eq(tasks.id, resolvedTaskId), eq(tasks.projectId, projectId)))
      .limit(1);

    if (!targetTask) {
      return jsonError("Task not found in this workspace", 404, "NOT_FOUND");
    }

    // Adding to someone else's task needs a yes from an agent's person (report §26.6).
    const held = await agentGate(auth, request, parsed.data, {
      workspaceId: projectId,
      kinds: [(await isOthersTask(resolvedTaskId, user.id)) ? "others-task" : "small"],
      summary: `Add the subtask "${title}"`,
    });
    if (held) return held;

    // Handle course assignment steps if applicable
    if (targetTask.kind === "assignment" && !targetTask.assignmentId) {
      const { addAssignmentStepAction } = await import("@/app/actions/assignments");
      const added = await addAssignmentStepAction(resolvedTaskId, title);
      return added.success
        ? jsonSuccess({ success: true, message: "Assignment step added" })
        : jsonError(added.error || "Couldn’t add assignment step", 400, "BAD_REQUEST");
    }

    const created = await db.transaction(async (tx) => {
      await lockSubtaskWriteScope(tx, { taskId: resolvedTaskId }, projectId, user.id);
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`task-subtask:${resolvedTaskId}`}, 0))`);

      const currentMax = await tx.query.taskSubtasks.findFirst({
        where: eq(taskSubtasks.taskId, resolvedTaskId),
        columns: { position: true },
        orderBy: [desc(taskSubtasks.position)],
      });

      const nextPosition = (currentMax?.position ?? -1) + 1;

      const [next] = await tx
        .insert(taskSubtasks)
        .values({
          ...(await viaColumns()),
          taskId: resolvedTaskId,
          title,
          completed: false,
          position: nextPosition,
        })
        .returning();

      if (!next) {
        throw new Error("Failed to insert subtask");
      }

      return next;
    });

    const undoToken = await recordUndo(auth, { workspaceId: projectId, operation: "subtask.add", summary: `Added the subtask "${created.title}"`, inverse: { kind: "subtask.delete", subtaskId: created.id, taskId: created.taskId, projectId } });
    return jsonSuccess({
      success: true,
      undoToken,
      subtask: {
        id: created.id,
        taskId: created.taskId,
        title: created.title,
        completed: created.completed,
        position: created.position,
        updatedAt: created.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    return routeErrorResponse(error, {
      requestId: getRequestId(request),
      scope: "api/v1/extension/task-subtask",
      fallback: "Subtask creation failed",
    });
  }
}

/** Retries with the same Idempotency-Key and body write once (report A2.4, F72). */
export async function POST(request: Request) {
  return idempotentWrite(request, "extension.task-subtask", handlePost);
}

import { validateCsrf } from "@/lib/security/csrf";
import {
  requireAuthenticatedUser,
  jsonSuccess,
  jsonError,
  getRequestId,
} from "@/app/api/v1/_shared";
import { routeErrorResponse } from "@/app/api/v1/_error";
import { db } from "@/lib/db";
import {
  taskActivityEvents,
  projectNodeEvents,
  projectNodes,
  fileVersions,
  taskSubtasks,
} from "@/lib/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import {
  lockTaskForWrite,
  transitionTaskTx,
  afterTaskTransition,
} from "@/lib/workspaces/task-transition-service";
import { lockSubtaskWriteScope } from "@/lib/workspaces/subtask-write-scope";
import { approveTaskReviewAction, requestTaskChangesAction, resubmitTaskReviewAction } from "@/app/actions/task";
import {
  extensionReviewEvidenceSchema,
  classifyReportedCheck,
} from "@/lib/extension/review-evidence";
export const runtime = "nodejs";
const inputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("request_changes"), projectId: z.string().uuid(), taskId: z.string().uuid(), reason: z.string().trim().min(1).max(2000), expectedUpdatedAt: z.string().datetime() }),
  z.object({ kind: z.literal("resubmit"), projectId: z.string().uuid(), taskId: z.string().uuid(), expectedUpdatedAt: z.string().datetime() }),
  z.object({
    kind: z.literal("approve"),
    projectId: z.string().uuid(),
    taskId: z.string().uuid(),
    expectedUpdatedAt: z.string().datetime(),
  }),
  z.object({
    kind: z.literal("status"),
    projectId: z.string().uuid(),
    taskId: z.string().uuid(),
    status: z.enum(["todo", "in_progress", "done", "blocked"]),
    expectedUpdatedAt: z.string().datetime(),
    evidence: extensionReviewEvidenceSchema.optional(),
  }),
  z.object({
    kind: z.literal("subtask"),
    projectId: z.string().uuid(),
    taskId: z.string().uuid(),
    subtaskId: z.string().uuid(),
    completed: z.boolean(),
    expectedUpdatedAt: z.string().datetime(),
  }),
]);
export async function PATCH(request: Request) {
  const csrf = validateCsrf(request);
  if (csrf) return csrf;
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    const user = auth.user;
    if (!user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    const parsed = inputSchema.safeParse(await request.json());
    if (!parsed.success)
      return jsonError("Invalid task update", 400, "BAD_REQUEST");
    const input = parsed.data;
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
          current.updatedAt.getTime() !==
            new Date(input.expectedUpdatedAt).getTime()
        )
          return null;
        const [updated] = await tx
          .update(taskSubtasks)
          .set({ completed: input.completed, updatedAt: new Date() })
          .where(
            and(
              eq(taskSubtasks.id, input.subtaskId),
              eq(taskSubtasks.updatedAt, current.updatedAt),
            ),
          )
          .returning();
        return updated;
      });
      return row
        ? jsonSuccess({ subtask: row })
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
          const event = await tx.query.projectNodeEvents.findFirst({
            where: and(
              eq(projectNodeEvents.projectId, input.projectId),
              eq(projectNodeEvents.nodeId, receipt.nodeId),
              eq(projectNodeEvents.actorId, user.id),
              sql`${projectNodeEvents.metadata}->>'operationId' LIKE ${receipt.operationId + ":%"}`,
              sql`${projectNodeEvents.metadata}->>'hash' = ${receipt.contentHash}`,
              sql`(${projectNodeEvents.metadata}->>'version')::integer = ${receipt.version}`,
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
            payload: {
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
    return jsonSuccess({ ...changed.result, warnings });
  } catch (error) {
    return routeErrorResponse(error, {
      requestId: getRequestId(request),
      scope: "api/v1/extension/task-update",
      fallback: "Task update failed",
    });
  }
}

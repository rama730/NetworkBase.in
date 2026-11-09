import { validateCsrf } from "@/lib/security/csrf";
import {requireAuthenticatedUser,
  jsonSuccess,
  jsonError,
  getRequestId,
  idempotentWrite, denyOutsideTokenWorkspace
} from "@/app/api/v1/_shared";
import { routeErrorResponse } from "@/app/api/v1/_error";
import { createTaskAction } from "@/app/actions/workspace";
import { z } from "zod";
import { createTaskSchema } from "@/lib/api/v1-schemas";
import { agentGate, recordUndo } from "@/lib/agents/policy";
export const runtime = "nodejs";
async function handlePost(request: Request) {
  const csrf = validateCsrf(request);
  if (csrf) return csrf;
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    const parsed = createTaskSchema.safeParse(await request.json());
    if (!parsed.success) return jsonError("Invalid task", 400, "BAD_REQUEST");
    const outside = await denyOutsideTokenWorkspace(auth, { projectId: parsed.data.projectId });
    if (outside) return outside;
    // Small change for agents (report §26.6); only "Ask for everything" holds it for a yes.
    const held = await agentGate(auth, request, parsed.data, { workspaceId: parsed.data.projectId, kinds: ["small"], summary: `Create the task "${parsed.data.title}"` });
    if (held) return held;
    const result = await createTaskAction({
      ...parsed.data,
      status: "todo",
      priority: parsed.data.priority || "medium",
    });
    if (!result.success) return jsonError(result.error || "Couldn’t create task", 400, "BAD_REQUEST");
    const taskId = (result as { task?: { id?: string } }).task?.id;
    const undoToken = taskId
      ? await recordUndo(auth, { workspaceId: parsed.data.projectId, operation: "task.create", summary: `Created "${parsed.data.title}"`, inverse: { kind: "task.delete", taskId, projectId: parsed.data.projectId } })
      : null;
    return jsonSuccess({ ...result, undoToken });
  } catch (error) {
    return routeErrorResponse(error, {
      requestId: getRequestId(request),
      scope: "api/v1/extension/create-task",
      fallback: "Task creation failed",
    });
  }
}

/** Retries with the same Idempotency-Key and body write once (report A2.4, F72). */
export async function POST(request: Request) {
  return idempotentWrite(request, "extension.create-task", handlePost);
}

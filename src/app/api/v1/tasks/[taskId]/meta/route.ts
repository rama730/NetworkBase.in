import { routeErrorResponse } from "@/app/api/v1/_error";
import { denyOutsideTokenWorkspace, getRequestId, idempotentWrite, jsonError, jsonSuccess, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { agentGate } from "@/lib/agents/policy";
import { readTaskMeta, TaskMetaError, taskMetaSchema, updateTaskMeta } from "@/lib/domain/task-meta";
import { validateCsrf } from "@/lib/security/csrf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ taskId: string }> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function metaError(error: unknown, request: Request) {
  if (error instanceof TaskMetaError) return jsonError(error.message, error.status, error.status === 404 ? "NOT_FOUND" : error.status === 403 ? "FORBIDDEN" : "CONFLICT");
  if (error instanceof Error && /permission|can.t|only|not allowed|access/i.test(error.message)) return jsonError(error.message, 403, "FORBIDDEN");
  return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/tasks/meta", fallback: "Couldn’t change the task" });
}

/** A task's labels, "blocked by", links, and whether you watch or starred it (report C2, C12). */
export async function GET(request: Request, context: Context) {
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    const { taskId } = await context.params;
    if (!UUID.test(taskId)) return jsonError("Task not found", 404, "NOT_FOUND");
    const outside = await denyOutsideTokenWorkspace(auth, { taskId });
    if (outside) return outside;
    return jsonSuccess(await readTaskMeta(taskId, auth.user.id), undefined, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return metaError(error, request);
  }
}

async function handlePatch(request: Request, context: Context) {
  const csrf = validateCsrf(request);
  if (csrf) return csrf;
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    const { taskId } = await context.params;
    if (!UUID.test(taskId)) return jsonError("Task not found", 404, "NOT_FOUND");
    const parsed = taskMetaSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? "Invalid change", 400, "BAD_REQUEST");
    const outside = await denyOutsideTokenWorkspace(auth, { taskId });
    if (outside) return outside;
    const meta = await readTaskMeta(taskId, auth.user.id);
    const held = await agentGate(auth, request, parsed.data, { workspaceId: meta.projectId, kinds: ["small"], summary: "Change the task's labels, links or what it waits on", taskId });
    if (held) return held;
    return jsonSuccess(await updateTaskMeta(auth.user.id, taskId, parsed.data));
  } catch (error) {
    return metaError(error, request);
  }
}

export async function PATCH(request: Request, context: Context) {
  return idempotentWrite(request, "tasks.meta", (req) => handlePatch(req, context));
}

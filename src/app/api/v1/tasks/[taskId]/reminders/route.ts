import { routeErrorResponse } from "@/app/api/v1/_error";
import { denyOutsideTokenWorkspace, getRequestId, idempotentWrite, jsonError, jsonSuccess, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { taskReminderSchema } from "@/lib/api/v1-schemas";
import { TaskMetaError } from "@/lib/domain/task-meta";
import { addTaskReminder, cancelTaskReminders, listTaskReminders } from "@/lib/domain/task-reminders";
import { validateCsrf } from "@/lib/security/csrf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ taskId: string }> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One handler shape for the three verbs: signed in, a real task id, inside the token's workspace. */
async function withTask(request: Request, context: Context, run: (userId: string, taskId: string) => Promise<Response>) {
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    const { taskId } = await context.params;
    if (!UUID.test(taskId)) return jsonError("Task not found", 404, "NOT_FOUND");
    const outside = await denyOutsideTokenWorkspace(auth, { taskId });
    if (outside) return outside;
    return await run(auth.user.id, taskId);
  } catch (error) {
    if (error instanceof TaskMetaError) return jsonError(error.message, error.status, error.status === 404 ? "NOT_FOUND" : error.status === 403 ? "FORBIDDEN" : "CONFLICT");
    return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/tasks/reminders", fallback: "Couldn’t change the reminder" });
  }
}

/** Your reminders on a task (report C2, 0088). */
export async function GET(request: Request, context: Context) {
  return withTask(request, context, async (userId, taskId) => jsonSuccess({ reminders: await listTaskReminders(userId, taskId) }, undefined, { headers: { "Cache-Control": "private, no-store" } }));
}

export async function POST(request: Request, context: Context) {
  const csrf = validateCsrf(request);
  if (csrf) return csrf;
  return idempotentWrite(request, "tasks.reminders", (req) => withTask(req, context, async (userId, taskId) => {
    const parsed = taskReminderSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError("Say when: an ISO date and time", 400, "BAD_REQUEST");
    const row = await addTaskReminder(userId, taskId, new Date(parsed.data.at), parsed.data.note ?? null);
    return jsonSuccess({ reminder: { id: row.id, remindAt: row.remindAt, note: row.note } });
  }));
}

/** Cancels your reminders on the task that haven't gone off yet. */
export async function DELETE(request: Request, context: Context) {
  const csrf = validateCsrf(request);
  if (csrf) return csrf;
  return withTask(request, context, async (userId, taskId) => jsonSuccess({ cancelled: await cancelTaskReminders(userId, taskId) }));
}

import { routeErrorResponse } from "@/app/api/v1/_error";
import { denyOutsideTokenWorkspace, getRequestId, idempotentWrite, jsonError, jsonSuccess, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { agentNoteDeleteSchema, agentNoteSchema } from "@/lib/api/v1-schemas";
import { agentNameFrom } from "@/lib/agents/presence";
import { addAgentNote, deleteAgentNote, listAgentNotes } from "@/lib/domain/task-agent-notes";
import { TaskMetaError } from "@/lib/domain/task-meta";
import { validateCsrf } from "@/lib/security/csrf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ taskId: string }> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Signed in, a real task id, inside the token's workspace (report D16). */
async function withTask(request: Request, context: Context, run: (auth: Awaited<ReturnType<typeof requireAuthenticatedUser>> & { user: { id: string } }, taskId: string) => Promise<Response>) {
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    const { taskId } = await context.params;
    if (!UUID.test(taskId)) return jsonError("Task not found", 404, "NOT_FOUND");
    const outside = await denyOutsideTokenWorkspace(auth, { taskId });
    if (outside) return outside;
    return await run(auth as typeof auth & { user: { id: string } }, taskId);
  } catch (error) {
    if (error instanceof TaskMetaError) return jsonError(error.message, error.status, error.status === 404 ? "NOT_FOUND" : error.status === 403 ? "FORBIDDEN" : "CONFLICT");
    return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/tasks/agent-notes", fallback: "Couldn’t change the agent notes" });
  }
}

/** A task's agent notes, newest first. */
export async function GET(request: Request, context: Context) {
  return withTask(request, context, async (auth, taskId) => jsonSuccess({ notes: await listAgentNotes(auth.user.id, taskId) }, undefined, { headers: { "Cache-Control": "private, no-store" } }));
}

/** Saves where an agent stopped. An agent sign-in names itself; the person's own sign-in says which agent. */
export async function POST(request: Request, context: Context) {
  const csrf = validateCsrf(request);
  if (csrf) return csrf;
  return idempotentWrite(request, "tasks.agent-notes", (req) => withTask(req, context, async (auth, taskId) => {
    const parsed = agentNoteSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError("Write the note: 1 to 2000 characters", 400, "BAD_REQUEST");
    const tokenAgent = "tokenAgentName" in auth && typeof auth.tokenAgentName === "string" ? auth.tokenAgentName : null;
    const agentName = auth.tokenKind === "agent" ? (tokenAgent ?? "An AI agent") : parsed.data.agentName ? agentNameFrom(parsed.data.agentName) : null;
    const note = await addAgentNote(auth.user.id, taskId, { note: parsed.data.note, agentName, sessionId: parsed.data.sessionId ?? null });
    return jsonSuccess({ note });
  }));
}

export async function DELETE(request: Request, context: Context) {
  const csrf = validateCsrf(request);
  if (csrf) return csrf;
  return withTask(request, context, async (auth, taskId) => {
    const parsed = agentNoteDeleteSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError("Which note?", 400, "BAD_REQUEST");
    await deleteAgentNote(auth.user.id, taskId, parsed.data.id);
    return jsonSuccess({ deleted: parsed.data.id });
  });
}

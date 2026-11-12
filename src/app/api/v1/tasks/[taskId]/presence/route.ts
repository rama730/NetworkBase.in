import { routeErrorResponse } from "@/app/api/v1/_error";
import { denyOutsideTokenWorkspace, getRequestId, jsonError, jsonSuccess, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { agentNameFrom, agentsOnTask, markAgentWorking } from "@/lib/agents/presence";
import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { agentPresenceSchema } from "@/lib/api/v1-schemas";
import { readableTask, TaskMetaError } from "@/lib/domain/task-meta";
import { validateCsrf } from "@/lib/security/csrf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ taskId: string }> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function withTask(request: Request, context: Context, run: (auth: Awaited<ReturnType<typeof requireAuthenticatedUser>> & { user: { id: string } }, taskId: string) => Promise<Response>) {
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    const { taskId } = await context.params;
    if (!UUID.test(taskId)) return jsonError("Task not found", 404, "NOT_FOUND");
    const outside = await denyOutsideTokenWorkspace(auth, { taskId });
    if (outside) return outside;
    const task = await readableTask(taskId, auth.user.id);
    // Saying an agent works here changes what everyone sees on the task: it needs write access (security review).
    if (request.method === "POST" && !(await getWorkspaceAccessById(task.projectId, auth.user.id)).canWrite) return jsonError("Only people who can change this task can say an agent is working on it", 403, "FORBIDDEN");
    return await run(auth as typeof auth & { user: { id: string } }, taskId);
  } catch (error) {
    if (error instanceof TaskMetaError) return jsonError(error.message, error.status, error.status === 404 ? "NOT_FOUND" : "FORBIDDEN");
    return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/tasks/presence", fallback: "Couldn’t read who's working on this" });
  }
}

/** The agents working on this task now (report D5): "Claude Code is working on this". */
export async function GET(request: Request, context: Context) {
  return withTask(request, context, async (_auth, taskId) => {
    const agents = await agentsOnTask(taskId);
    return jsonSuccess({ agents: agents.map(({ agentName, at }) => ({ agentName, at: new Date(at).toISOString() })) }, undefined, { headers: { "Cache-Control": "private, no-store" } });
  });
}

/** An agent's heartbeat on the task, every 60 seconds while it works (report D5, D17); answers with the others. */
export async function POST(request: Request, context: Context) {
  const csrf = validateCsrf(request);
  if (csrf) return csrf;
  return withTask(request, context, async (auth, taskId) => {
    const parsed = agentPresenceSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError("Send the agent's session id", 400, "BAD_REQUEST");
    const tokenAgent = "tokenAgentName" in auth && typeof auth.tokenAgentName === "string" ? auth.tokenAgentName : null;
    // An agent sign-in names itself; a person's own sign-in may only pick a known agent's name.
    const agentName = auth.tokenKind === "agent" ? (tokenAgent ?? "An AI agent") : agentNameFrom(parsed.data.agentName);
    const { others, full } = await markAgentWorking(taskId, { sessionId: parsed.data.sessionId, agentName, userId: auth.user.id });
    if (full) return jsonError("Too many agents are working on this task right now", 429, "RATE_LIMITED");
    return jsonSuccess({ others: others.map((o) => o.agentName) });
  });
}

import { routeErrorResponse } from "@/app/api/v1/_error";
import { denyOutsideTokenWorkspace, getRequestId, idempotentWrite, jsonError, jsonSuccess, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { askQuestion, askSchema, openQuestionsFor, publicQuestion, QuestionError } from "@/lib/agents/questions";
import { agentWorkspaceFilter } from "@/lib/agents/reachable";
import { validateCsrf } from "@/lib/security/csrf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Questions waiting for this person's answer (`nb ask list`, the app's question card). */
export async function GET(request: Request) {
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    const taskId = new URL(request.url).searchParams.get("task") ?? undefined;
    const outside = await denyOutsideTokenWorkspace(auth, { taskId });
    if (outside) return outside;
    const questions = await openQuestionsFor(auth.user.id, { taskId });
    // A token sees only the workspaces it may reach (one, or all minus paused and agents-off ones).
    const reach = await agentWorkspaceFilter(auth);
    return jsonSuccess({ questions: reach ? questions.filter((q) => reach.has(q.workspaceId)) : questions });
  } catch (error) {
    return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/questions", fallback: "Couldn’t load questions" });
  }
}

/** An agent or the CLI asks a person (report §20.4, §26.4). */
async function handlePost(request: Request) {
  const csrf = validateCsrf(request);
  if (csrf) return csrf;
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    const parsed = askSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? "Invalid question", 400, "BAD_REQUEST");
    const outside = await denyOutsideTokenWorkspace(auth, { projectId: parsed.data.projectId, taskId: parsed.data.taskId });
    if (outside) return outside;
    const asked = await askQuestion({ user: auth.user, extensionSessionId: auth.extensionSessionId, tokenScopes: auth.tokenScopes }, parsed.data);
    return jsonSuccess(publicQuestion(asked));
  } catch (error) {
    if (error instanceof QuestionError) return jsonError(error.message, error.status, error.code);
    return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/questions", fallback: "Couldn’t ask" });
  }
}

export async function POST(request: Request) {
  return idempotentWrite(request, "questions.ask", handlePost);
}

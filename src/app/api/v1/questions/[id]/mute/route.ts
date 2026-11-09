import { routeErrorResponse } from "@/app/api/v1/_error";
import { denyOutsideTokenWorkspace, getRequestId, jsonError, jsonSuccess, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { muteAsker, QuestionError, readQuestion } from "@/lib/agents/questions";
import { validateCsrf } from "@/lib/security/csrf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** "Mute this agent on this task" (report §26.4). */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const csrf = validateCsrf(request);
  if (csrf) return csrf;
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    if (auth.tokenKind === "agent") return jsonError("Agents can't change what people hear", 403, "FORBIDDEN");
    const { id } = await context.params;
    const q = await readQuestion(id);
    if (q) {
      const outside = await denyOutsideTokenWorkspace(auth, { projectId: q.workspaceId });
      if (outside) return outside;
    }
    await muteAsker(auth.user.id, id);
    return jsonSuccess({ muted: true });
  } catch (error) {
    if (error instanceof QuestionError) return jsonError(error.message, error.status, error.code);
    return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/questions/mute", fallback: "Couldn’t mute" });
  }
}

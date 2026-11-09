import { routeErrorResponse } from "@/app/api/v1/_error";
import { denyOutsideTokenWorkspace, getRequestId, jsonError, jsonSuccess, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { answerQuestion, answerSchema, publicQuestion, QuestionError, readQuestion } from "@/lib/agents/questions";
import { validateCsrf } from "@/lib/security/csrf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The person answers (`nb ask answer`; the app uses a server action with the same rules). */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const csrf = validateCsrf(request);
  if (csrf) return csrf;
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    // Agents answer nothing for people (report §26.4): only the person's own token or browser may.
    if (auth.tokenKind === "agent") return jsonError("Agents can't answer questions for people", 403, "FORBIDDEN");
    const { id } = await context.params;
    const q = await readQuestion(id);
    if (q) {
      const outside = await denyOutsideTokenWorkspace(auth, { projectId: q.workspaceId });
      if (outside) return outside;
    }
    const parsed = answerSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError("Invalid answer", 400, "BAD_REQUEST");
    return jsonSuccess(publicQuestion(await answerQuestion(auth.user.id, id, parsed.data)));
  } catch (error) {
    if (error instanceof QuestionError) return jsonError(error.message, error.status, error.code);
    return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/questions/answer", fallback: "Couldn’t save the answer" });
  }
}

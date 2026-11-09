import { routeErrorResponse } from "@/app/api/v1/_error";
import { denyOutsideTokenWorkspace, getRequestId, jsonError, jsonSuccess, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { publicQuestion, readQuestion, waitForAnswer } from "@/lib/agents/questions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One question; `?wait=25` holds the request up to 25 s for an answer (`nb ask wait`, the MCP tool). */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    const { id } = await context.params;
    const first = await readQuestion(id);
    if (!first || (first.askerUserId !== auth.user.id && first.toUserId !== auth.user.id)) return jsonError("Question not found", 404, "NOT_FOUND");
    const outside = await denyOutsideTokenWorkspace(auth, { projectId: first.workspaceId });
    if (outside) return outside;
    const wait = Number(new URL(request.url).searchParams.get("wait") ?? 0);
    const q = wait > 0 ? await waitForAnswer(id, wait * 1000) : first;
    return jsonSuccess(publicQuestion(q ?? first), undefined, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/questions/id", fallback: "Couldn’t read the question" });
  }
}

import { getRequestId, jsonError, jsonSuccess, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { routeErrorResponse } from "@/app/api/v1/_error";
import { listWorkspaceDocsAction } from "@/app/actions/workspace/doc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The workspace's docs (README first) that the caller may read: `nb doc list`, agents' doc lookup. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    const { id } = await context.params;
    const result = await listWorkspaceDocsAction(id);
    if (!result.success) return jsonError(result.error, 400, "BAD_REQUEST");
    return jsonSuccess({ docs: result.docs }, undefined, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/workspaces/docs", fallback: "Couldn’t list docs" });
  }
}

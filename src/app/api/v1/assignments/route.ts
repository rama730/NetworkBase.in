import { routeErrorResponse } from "@/app/api/v1/_error";
import { getRequestId, jsonError, jsonSuccess, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { agentWorkspaceFilter } from "@/lib/agents/reachable";
import { listMyCopies } from "@/lib/organizations/my-assignments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** My assignment copies (`nb assignment list`, report A8.4). An agent token sees only its workspace's. */
export async function GET(request: Request) {
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    const copies = await listMyCopies(auth.user.id);
    const reach = await agentWorkspaceFilter(auth);
    return jsonSuccess({ copies: reach ? copies.filter((c) => reach.has(c.workspaceId)) : copies });
  } catch (error) {
    return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/assignments", fallback: "Couldn’t list your assignments" });
  }
}

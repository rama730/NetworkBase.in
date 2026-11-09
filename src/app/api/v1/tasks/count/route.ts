import { getRequestId, jsonError, jsonSuccess, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { routeErrorResponse } from "@/app/api/v1/_error";
import { countMyOpenTasks } from "@/lib/domain/my-tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** "How many tasks do I have?" (report §18.2): the person's open work across workspaces, as My work counts it. */
export async function GET(request: Request) {
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    return jsonSuccess(await countMyOpenTasks(auth.user.id, new Date(), auth.tokenWorkspaceId), undefined, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/tasks/count", fallback: "Couldn’t count your tasks" });
  }
}

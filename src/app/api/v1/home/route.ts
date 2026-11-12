import { getRequestId, jsonError, jsonSuccess, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { routeErrorResponse } from "@/app/api/v1/_error";
import { countMyOpenTasks } from "@/lib/domain/my-tasks";
import { countUnreadNotifications } from "@/lib/notifications/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The home screen for `nb` on its own (report C1, C2): your open tasks and unread inbox, in one request. */
export async function GET(request: Request) {
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    const [tasks, unread] = await Promise.all([countMyOpenTasks(auth.user.id), countUnreadNotifications(auth.user.id)]);
    return jsonSuccess({ tasks, unread: unread.total }, undefined, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/home", fallback: "Couldn’t load your home screen" });
  }
}

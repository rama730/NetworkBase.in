import { routeErrorResponse } from "@/app/api/v1/_error";
import { getRequestId, jsonError, jsonSuccess, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { readNotificationsPage } from "@/lib/notifications/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The notification tray from the terminal (`nb inbox`, report A11.1): the same items, order and unread counts. */
export async function GET(request: Request) {
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    const url = new URL(request.url);
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit")) || 20));
    const page = await readNotificationsPage(auth.user.id, limit, url.searchParams.get("cursor"), db);
    return jsonSuccess(page, undefined, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/inbox", fallback: "Couldn’t load your inbox" });
  }
}

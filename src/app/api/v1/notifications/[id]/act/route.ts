import { z } from "zod";

import { routeErrorResponse } from "@/app/api/v1/_error";
import { enforceRouteLimit, getRequestId, jsonError, jsonSuccess, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { actOnNotificationAction } from "@/app/actions/notifications";
import { validateCsrf } from "@/lib/security/csrf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ act: z.enum(["accept", "ignore", "allow", "deny"]) }).strict();

/** A push notification's button (notifications mix): the same dispatcher as the tray's row buttons. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const csrf = validateCsrf(request);
  if (csrf) return csrf;
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (!auth.user || auth.tokenScopes) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    const limited = await enforceRouteLimit(request, "api:v1:notifications:act", 30, 60, "default", auth.user.id);
    if (limited) return limited;
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return jsonError("Not found", 404, "NOT_FOUND");
    const body = bodySchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return jsonError("Say which: accept, ignore, allow or deny", 400, "BAD_REQUEST");
    const result = await actOnNotificationAction({ notificationId: id }, { act: body.data.act });
    return result.success ? jsonSuccess({ done: true }) : jsonError(result.error, 409, "CONFLICT");
  } catch (error) {
    return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/notifications/act", fallback: "Couldn’t do that just now" });
  }
}

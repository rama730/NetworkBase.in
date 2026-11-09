import { z } from "zod";

import { routeErrorResponse } from "@/app/api/v1/_error";
import { getRequestId, jsonError, jsonSuccess, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { markNotificationRead, readNotificationsPage } from "@/lib/notifications/service";
import { validateCsrf } from "@/lib/security/csrf";
import { getRedisClient } from "@/lib/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.union([z.object({ ids: z.array(z.string().uuid()).min(1).max(100) }).strict(), z.object({ all: z.literal(true) }).strict()]);

/** Mark inbox items read (`nb inbox read`), one by one or every unread one on the first pages. */
export async function POST(request: Request) {
  const csrf = validateCsrf(request);
  if (csrf) return csrf;
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    const body = bodySchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return jsonError("Say which: { ids } or { all: true }", 400, "BAD_REQUEST");
    let ids = "ids" in body.data ? body.data.ids : [];
    if ("all" in body.data) ids = (await readNotificationsPage(auth.user.id, 50, null, db)).items.filter((i) => !i.readAt).map((i) => i.id);
    let read = 0;
    for (const id of ids) if (await markNotificationRead(auth.user.id, id, db)) read++;
    void getRedisClient()?.del(`unread:notif:${auth.user.id}`).catch(() => undefined);
    return jsonSuccess({ read });
  } catch (error) {
    return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/inbox/read", fallback: "Couldn’t mark them read" });
  }
}

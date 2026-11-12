import { eq } from "drizzle-orm";

import { routeErrorResponse } from "@/app/api/v1/_error";
import { getRequestId, jsonError, jsonSuccess, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { profiles } from "@/lib/db/schema";
import { mergeNotificationPreferences } from "@/lib/notifications/merge";
import { normalizeNotificationPreferences } from "@/lib/notifications/preferences";
import type { NotificationPreferences } from "@/lib/notifications/types";
import { notificationSettingsSchema } from "@/lib/api/v1-schemas";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { validateCsrf } from "@/lib/security/csrf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";


async function current(userId: string) {
  const [row] = await db.select({ notificationPreferences: profiles.notificationPreferences }).from(profiles).where(eq(profiles.id, userId)).limit(1);
  return normalizeNotificationPreferences(row?.notificationPreferences);
}

export async function GET(request: Request) {
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    return jsonSuccess({ preferences: await current(auth.user.id) }, undefined, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/me/notifications", fallback: "Couldn’t read your notification settings" });
  }
}

/** Only the settings named in the body change, on top of what's stored (like the Settings page's saves). */
export async function PATCH(request: Request) {
  const csrf = validateCsrf(request);
  if (csrf) return csrf;
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    const userId = auth.user.id;
    const parsed = notificationSettingsSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? "Invalid settings", 400, "BAD_REQUEST");
    if (!(await consumeRateLimit(`notification-preferences:${userId}`, 60, 60)).allowed) return jsonError("Too many changes. Wait a moment.", 429, "RATE_LIMITED");
    const keys = Object.keys(parsed.data) as Array<keyof NotificationPreferences>;
    const saved = await db.transaction(async (tx) => {
      const [row] = await tx.select({ notificationPreferences: profiles.notificationPreferences }).from(profiles).where(eq(profiles.id, userId)).for("update");
      if (!row) return null;
      const next = mergeNotificationPreferences(row.notificationPreferences, parsed.data as unknown as NotificationPreferences, keys);
      const [out] = await tx.update(profiles).set({ notificationPreferences: next, updatedAt: new Date() }).where(eq(profiles.id, userId)).returning({ notificationPreferences: profiles.notificationPreferences });
      return out ?? null;
    });
    if (!saved) return jsonError("Profile not found", 404, "NOT_FOUND");
    return jsonSuccess({ preferences: normalizeNotificationPreferences(saved.notificationPreferences) });
  } catch (error) {
    return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/me/notifications", fallback: "Couldn’t save your notification settings" });
  }
}

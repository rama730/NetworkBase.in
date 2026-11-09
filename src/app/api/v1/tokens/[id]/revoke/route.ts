import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { routeErrorResponse } from "@/app/api/v1/_error";
import { getRequestId, jsonError, jsonSuccess, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { extensionDeviceSessionEvents, extensionDeviceSessions, personalAccessTokens } from "@/lib/db/schema";
import { EXTENSION_DEVICE_SESSION_EVENTS } from "@/lib/extension/session-events";
import { recordSecurityEventFromHeaders } from "@/lib/security/audit-from-headers";
import { validateCsrf } from "@/lib/security/csrf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Revoke one of your devices, agents or personal tokens (`nb token revoke`). Revoking only takes access away. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const csrf = validateCsrf(request);
  if (csrf) return csrf;
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    const parsed = z.string().uuid().safeParse((await context.params).id);
    if (!parsed.success) return jsonError("Invalid token id", 400, "BAD_REQUEST");
    const id = parsed.data;
    const now = new Date();
    const [session] = await db.update(extensionDeviceSessions).set({ revokedAt: now, revocationReason: "revoked_from_cli" })
      .where(and(eq(extensionDeviceSessions.id, id), eq(extensionDeviceSessions.userId, auth.user.id), isNull(extensionDeviceSessions.revokedAt))).returning({ id: extensionDeviceSessions.id, name: extensionDeviceSessions.deviceName });
    if (session) {
      await db.insert(extensionDeviceSessionEvents).values({ sessionId: session.id, eventType: EXTENSION_DEVICE_SESSION_EVENTS.revocation, metadata: { reason: "revoked_from_cli" }, createdAt: now });
    } else {
      const [pat] = await db.update(personalAccessTokens).set({ revokedAt: now })
        .where(and(eq(personalAccessTokens.id, id), eq(personalAccessTokens.userId, auth.user.id), isNull(personalAccessTokens.revokedAt))).returning({ id: personalAccessTokens.id });
      if (!pat) return jsonError("No such token of yours", 404, "NOT_FOUND");
    }
    await recordSecurityEventFromHeaders({ userId: auth.user.id, eventType: "editor_token_revoked", metadata: { tokenId: id, from: "cli" } });
    return jsonSuccess({ revoked: id });
  } catch (error) {
    return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/tokens/revoke", fallback: "Couldn’t revoke the token" });
  }
}

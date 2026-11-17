import { and, desc, eq, gt, isNull } from "drizzle-orm";

import { getRequestId, jsonError, jsonSuccess, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { routeErrorResponse } from "@/app/api/v1/_error";
import { hasVerifiedMfaFactor } from "@/lib/auth/mfa-gate";
import { db } from "@/lib/db";
import { extensionDeviceSessions } from "@/lib/db/schema";
import { listSecurityActivity } from "@/lib/security/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Words for the log (the app's Security activity list says the same). */
const LABEL: Record<string, string> = {
  authenticator_app_enabled: "Authenticator app turned on", authenticator_app_removed: "Authenticator app removed", recovery_codes_generated: "Recovery codes made",
  recovery_codes_regenerated: "Recovery codes made again", recovery_code_used: "A recovery code was used", recovery_code_redemption_failed: "A recovery code was tried and failed",
  password_set: "Password set", password_changed: "Password changed", other_sessions_revoked: "Other sessions signed out", sign_in_method_linked: "Sign-in method connected",
  sign_in_method_unlinked: "Sign-in method disconnected", editor_token_created: "Editor token made", editor_token_revoked: "Token revoked from the CLI", agent_access_changed: "AI agent access changed",
  account_data_exported: "Account data exported", branch_protection_changed: "Main's protection changed", merge_without_approval: "Merged into main without approval",
  cli_verified: "Terminal verified for risky actions", token_new_country: "Sign-in used from a new country",
};

/**
 * `nb whoami --security` (report F5): your terminal and agent sign-ins (where they were last used), whether two-factor
 * is on, and the last 10 security events. The person's own; agents don't read it.
 */
export async function GET(request: Request) {
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    // Your own sign-in or the app only: never an agent, never a personal access token (CI, scripts).
    if (auth.tokenKind && auth.tokenKind !== "device") return jsonError("Read your security summary from your own sign-in (nb login) or the app", 403, "FORBIDDEN");
    const [signIns, twoFactor, events] = await Promise.all([
      db.select({ name: extensionDeviceSessions.deviceName, kind: extensionDeviceSessions.tokenType, agentName: extensionDeviceSessions.agentName, country: extensionDeviceSessions.lastCountry, lastUsedAt: extensionDeviceSessions.lastSeenAt })
        .from(extensionDeviceSessions)
        .where(and(eq(extensionDeviceSessions.userId, auth.user.id), isNull(extensionDeviceSessions.revokedAt), gt(extensionDeviceSessions.expiresAt, new Date())))
        .orderBy(desc(extensionDeviceSessions.lastSeenAt)).limit(50),
      hasVerifiedMfaFactor(auth.user.id),
      listSecurityActivity(auth.user.id, 10),
    ]);
    return jsonSuccess({
      twoFactor,
      signIns: signIns.map((s) => ({ name: s.kind === "agent" ? `${s.agentName ?? "AI agent"} on ${s.name}` : s.name, kind: s.kind === "agent" ? "agent" : "terminal", country: s.country, lastUsedAt: s.lastUsedAt?.toISOString() ?? null })),
      events: events.map((e) => ({ at: e.createdAt, type: e.eventType, label: LABEL[e.eventType] ?? e.eventType.replace(/_/g, " ") })),
    }, undefined, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/me/security", fallback: "Couldn’t read your security summary" });
  }
}

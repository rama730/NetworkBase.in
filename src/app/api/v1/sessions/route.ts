import { validateCsrf } from "@/lib/security/csrf";
import { isFreshlyVerified } from "@/lib/security/fresh-verification";
import {
  enforceRouteLimit,
  getRequestId,
  getSessionIdentifier,
  jsonError,
  jsonSuccess,
  logApiRoute,
  requireAuthenticatedUser,
} from "@/app/api/v1/_shared";
import { logger } from "@/lib/logger";
import { getProtectedRecoveryCodes } from "@/lib/services/profile-service";
import { recordSecurityEvent } from "@/lib/security/audit";
import { getVerifiedTotpFactors, listSecurityMfaFactors } from "@/lib/security/mfa";
import { countRemainingRecoveryCodes } from "@/lib/security/recovery-codes";
import {
  countOtherActiveSessions,
  listActiveSessions,
  listActiveSessionsPage,
  revokeActiveSession,
  dismissLoginHistoryEntry,
  clearAllLoginHistory,
} from "@/lib/security/session-activity";
import { resolveCurrentSessionRowId } from "@/lib/security/session-current";
import { resolveSecurityStepUp } from "@/lib/security/step-up";
import { revokeAllExtensionSessionsForUser } from "@/lib/security/extension-token-revocation";
import { queueSecurityEmail } from "@/lib/email/security-queue";
import { buildSecurityStepUpMethods } from "@/lib/security/step-up-methods";
import { isLooseUuid } from "@/lib/validations/uuid";

type SessionPayload = {
  id: string;
  device_info: { userAgent: string };
  ip_address: string;
  last_active: string;
  created_at?: string;
  is_current?: boolean;
  aal?: "aal1" | "aal2" | null;
};

function parsePaginationNumber(value: string | null, fallback: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(0, Math.min(Math.trunc(parsed), max));
}

export async function GET(request: Request) {
  const startedAt = Date.now();
  const requestId = getRequestId(request);

  const auth = await requireAuthenticatedUser();
  if (auth.response) {
    logApiRoute(request, {
      requestId,
      action: "sessions.get",
      startedAt,
      success: false,
      status: 401,
      errorCode: "UNAUTHORIZED",
    });
    return auth.response;
  }
  if (!auth.user) {
    logApiRoute(request, {
      requestId,
      action: "sessions.get",
      startedAt,
      success: false,
      status: 401,
      errorCode: "UNAUTHORIZED",
    });
    return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
  }

  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.max(1, parsePaginationNumber(searchParams.get("limit"), 12, 50));
    const offset = parsePaginationNumber(searchParams.get("offset"), 0, 500);
    const {
      data: { session },
    } = await auth.supabase.auth.getSession();
    const currentSessionId =
      session ? getSessionIdentifier(session) ?? null : null;
    const page = await listActiveSessionsPage(auth.user.id, currentSessionId, { limit, offset });
    const sessions: SessionPayload[] = page.sessions;

    logApiRoute(request, {
      requestId,
      action: "sessions.get",
      userId: auth.user.id,
      startedAt,
      success: true,
      status: 200,
    });
    return jsonSuccess(
      {
        sessions,
        pagination: {
          limit,
          offset,
          hasMore: page.hasMore,
          nextOffset: page.nextOffset,
        },
      },
      undefined,
      { headers: { "Cache-Control": "private, no-cache, stale-while-revalidate=10" } },
    );
  } catch (error) {
    logger.error("[api/v1/sessions] failed", { module: 'api', error: error instanceof Error ? error.message : String(error) });
    logApiRoute(request, {
      requestId,
      action: "sessions.get",
      userId: auth.user.id,
      startedAt,
      success: false,
      status: 500,
      errorCode: "INTERNAL_ERROR",
    });
    return jsonError("Couldn’t load sessions", 500, "INTERNAL_ERROR");
  }
}

/** Null once the person has verified this device recently; otherwise the 403 that asks for it. */
async function requireFreshVerification(
  supabase: Awaited<ReturnType<typeof requireAuthenticatedUser>>["supabase"],
  user: NonNullable<Awaited<ReturnType<typeof requireAuthenticatedUser>>["user"]>,
) {
  return (await isFreshlyVerified(supabase, user)) ? null : jsonError("Verify this device first", 403, "STEP_UP_REQUIRED");
}

async function deleteSession(request: Request, id: string) {
  const startedAt = Date.now();
  const requestId = getRequestId(request);
  const csrfError = validateCsrf(request);
  if (csrfError) {
    logApiRoute(request, {
      requestId,
      action: "sessions.delete",
      startedAt,
      success: false,
      status: 403,
      errorCode: "FORBIDDEN",
    });
    return csrfError;
  }

  const limitResponse = await enforceRouteLimit(request, "api:v1:sessions:delete", 60, 60);
  if (limitResponse) {
    logApiRoute(request, {
      requestId,
      action: "sessions.delete",
      startedAt,
      success: false,
      status: 429,
      errorCode: "RATE_LIMITED",
    });
    return limitResponse;
  }

  const auth = await requireAuthenticatedUser();
  if (auth.response) {
    logApiRoute(request, {
      requestId,
      action: "sessions.delete",
      startedAt,
      success: false,
      status: 401,
      errorCode: "UNAUTHORIZED",
    });
    return auth.response;
  }
  if (!auth.user) {
    logApiRoute(request, {
      requestId,
      action: "sessions.delete",
      startedAt,
      success: false,
      status: 401,
      errorCode: "UNAUTHORIZED",
    });
    return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
  }
  // Signing devices out is the person's own act, from a browser: an editor token cannot do it.
  if (auth.extensionSessionId) return jsonError("This needs a browser session", 403, "FORBIDDEN");

  const {
    data: { session },
  } = await auth.supabase.auth.getSession();
  const currentSessionId = getSessionIdentifier(session);
  let resolvedCurrentSessionId = currentSessionId;

  if (!resolvedCurrentSessionId || id !== resolvedCurrentSessionId) {
    const activeSessions = await listActiveSessions(auth.user.id, currentSessionId, 12);
    resolvedCurrentSessionId = resolveCurrentSessionRowId(
      activeSessions.map((activeSession) => activeSession.id),
      currentSessionId,
    );
  }

  if (id === resolvedCurrentSessionId) {
    try {
      const result = await auth.supabase.auth.signOut({ scope: "local" });
      if (result.error) {
        logApiRoute(request, {
          requestId,
          action: "sessions.delete",
          userId: auth.user.id,
          startedAt,
          success: false,
          status: 400,
          errorCode: "SESSION_REVOKE_FAILED",
        });
        return jsonError("Couldn’t revoke session", 400, "SESSION_REVOKE_FAILED");
      }
      logApiRoute(request, {
        requestId,
        action: "sessions.delete",
        userId: auth.user.id,
        startedAt,
        success: true,
        status: 200,
      });
      return jsonSuccess(undefined, "Session revoked");
    } catch (error) {
      logger.error("[api/v1/sessions] delete failed", { module: 'api', error: error instanceof Error ? error.message : String(error) });
      logApiRoute(request, {
        requestId,
        action: "sessions.delete",
        userId: auth.user.id,
        startedAt,
        success: false,
        status: 500,
        errorCode: "INTERNAL_ERROR",
      });
      return jsonError("Couldn’t revoke session", 500, "INTERNAL_ERROR");
    }
  }

  // Revoking a remote device session
  try {
    const revoked = await revokeActiveSession(auth.user.id, id);
    // Not one of this person's sessions (or already gone): nothing was signed out, so nothing is recorded.
    if (!revoked) return jsonError("Session not found", 404, "NOT_FOUND");
    await recordSecurityEvent({
      userId: auth.user.id,
      eventType: "other_sessions_revoked",
      request,
      metadata: {
        revokedCount: 1,
        targetSessionId: id,
      },
    });

    logApiRoute(request, {
      requestId,
      action: "sessions.delete.remote",
      userId: auth.user.id,
      startedAt,
      success: true,
      status: 200,
    });
    return jsonSuccess(undefined, "Device signed out");
  } catch (error) {
    logger.error("[api/v1/sessions] delete remote session failed", { module: "api", error: error instanceof Error ? error.message : String(error) });
    logApiRoute(request, {
      requestId,
      action: "sessions.delete.remote",
      userId: auth.user.id,
      startedAt,
      success: false,
      status: 500,
      errorCode: "INTERNAL_ERROR",
    });
    return jsonError("Couldn’t sign out remote device", 500, "INTERNAL_ERROR");
  }
}

async function deleteLoginHistory(request: Request, target: "all" | string) {
  const startedAt = Date.now();
  const requestId = getRequestId(request);
  const csrfError = validateCsrf(request);
  if (csrfError) return csrfError;

  const auth = await requireAuthenticatedUser();
  if (auth.response) return auth.response;
  if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
  // History is the evidence of a break-in: a stolen editor token must not be able to erase it.
  if (auth.extensionSessionId) return jsonError("This needs a browser session", 403, "FORBIDDEN");
  const historyLimit = await enforceRouteLimit(request, "api:v1:sessions:history-delete", 30, 60, "default", auth.user.id);
  if (historyLimit) return historyLimit;

  try {
    if (target === "all") {
      // Wiping all of it needs the same fresh check as signing every other device out.
      const verification = await requireFreshVerification(auth.supabase, auth.user);
      if (verification) return verification;
      await clearAllLoginHistory(auth.user.id);
    } else {
      await dismissLoginHistoryEntry(auth.user.id, target);
    }

    logApiRoute(request, {
      requestId,
      action: "sessions.history.delete",
      userId: auth.user.id,
      startedAt,
      success: true,
      status: 200,
    });
    return jsonSuccess(undefined, target === "all" ? "Sign-in history cleared" : "Sign-in entry removed");
  } catch (error) {
    logger.error("[api/v1/sessions] delete history failed", { module: "api", error: error instanceof Error ? error.message : String(error) });
    return jsonError("Couldn’t update sign-in history", 500, "INTERNAL_ERROR");
  }
}

async function deleteOtherSessions(request: Request) {
  const startedAt = Date.now();
  const requestId = getRequestId(request);
  const csrfError = validateCsrf(request);
  if (csrfError) {
    logApiRoute(request, {
      requestId,
      action: "sessions.deleteOthers",
      startedAt,
      success: false,
      status: 403,
      errorCode: "FORBIDDEN",
    });
    return csrfError;
  }

  const limitResponse = await enforceRouteLimit(request, "api:v1:sessions:delete-others", 20, 60);
  if (limitResponse) {
    logApiRoute(request, {
      requestId,
      action: "sessions.deleteOthers",
      startedAt,
      success: false,
      status: 429,
      errorCode: "RATE_LIMITED",
    });
    return limitResponse;
  }

  const auth = await requireAuthenticatedUser();
  if (auth.response) {
    logApiRoute(request, {
      requestId,
      action: "sessions.deleteOthers",
      startedAt,
      success: false,
      status: 401,
      errorCode: "UNAUTHORIZED",
    });
    return auth.response;
  }
  const user = auth.user;
  if (!user) {
    logApiRoute(request, {
      requestId,
      action: "sessions.deleteOthers",
      startedAt,
      success: false,
      status: 401,
      errorCode: "UNAUTHORIZED",
    });
    return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
  }
  if (auth.extensionSessionId) return jsonError("This needs a browser session", 403, "FORBIDDEN");

  try {
    const verification = await requireFreshVerification(auth.supabase, user);
    if (verification) {
      logApiRoute(request, {
        requestId,
        action: "sessions.deleteOthers",
        userId: user.id,
        startedAt,
        success: false,
        status: 403,
        errorCode: "STEP_UP_REQUIRED",
      });
      return verification;
    }

    const {
      data: { session },
    } = await auth.supabase.auth.getSession();
    const currentSessionId = session ? getSessionIdentifier(session) ?? null : null;
    const revokedCount = await countOtherActiveSessions(user.id, currentSessionId);

    const result = await auth.supabase.auth.signOut({ scope: "others" });
    if (result.error) {
      logApiRoute(request, {
        requestId,
        action: "sessions.deleteOthers",
        userId: user.id,
        startedAt,
        success: false,
        status: 400,
        errorCode: "SESSION_REVOKE_FAILED",
      });
      return jsonError("Couldn’t revoke other sessions", 400, "SESSION_REVOKE_FAILED");
    }

    await recordSecurityEvent({
      userId: user.id,
      eventType: "other_sessions_revoked",
      request,
      metadata: {
        revokedCount,
      },
    });
    // Editor tokens are sessions too: "other devices" includes the ones in editors.
    await revokeAllExtensionSessionsForUser(user.id).catch((error: unknown) =>
      logger.warn("sessions.extension_revoke_failed", { module: "api", error: error instanceof Error ? error.message : String(error) }));
    // Signing out everywhere also ends "Trust this browser": every browser asks for the code again.
    const { stopTrustingDevices } = await import("@/lib/auth/devices");
    await stopTrustingDevices(user.id).catch(() => null);
    await queueSecurityEmail(user.id, "security_sessions_revoked", { detail: String(revokedCount) });

    logApiRoute(request, {
      requestId,
      action: "sessions.deleteOthers",
      userId: user.id,
      startedAt,
      success: true,
      status: 200,
    });
    return jsonSuccess(undefined, "Other sessions revoked");
  } catch (error) {
    logger.error("[api/v1/sessions] delete others failed", { module: 'api', error: error instanceof Error ? error.message : String(error) });
    logApiRoute(request, {
      requestId,
      action: "sessions.deleteOthers",
      userId: user.id,
      startedAt,
      success: false,
      status: 500,
      errorCode: "INTERNAL_ERROR",
    });
    return jsonError("Couldn’t revoke other sessions", 500, "INTERNAL_ERROR");
  }
}

export async function DELETE(request: Request) {
  const params = new URL(request.url).searchParams;
  const scope = params.get("scope");
  if (scope === "others") return deleteOtherSessions(request);
  if (scope === "history_all") return deleteLoginHistory(request, "all");
  if (scope === "history") {
    const id = params.get("id");
    if (!id || !isLooseUuid(id)) return jsonError("Valid session id is required", 400, "BAD_REQUEST");
    return deleteLoginHistory(request, id);
  }
  const id = params.get("id");
  if (!id || !isLooseUuid(id)) return jsonError("Valid session id is required", 400, "BAD_REQUEST");
  return deleteSession(request, id);
}

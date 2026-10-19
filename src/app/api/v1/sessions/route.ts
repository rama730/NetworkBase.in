import { validateCsrf } from "@/lib/security/csrf";
import { resolvePasswordCredentialState } from "@/lib/auth/account-identity";
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
import { getLatestPasswordChangeAt, recordSecurityEvent } from "@/lib/security/audit";
import { getVerifiedTotpFactors, listSecurityMfaFactors } from "@/lib/security/mfa";
import { countRemainingRecoveryCodes } from "@/lib/security/recovery-codes";
import { countOtherActiveSessions, listActiveSessions, listActiveSessionsPage } from "@/lib/security/session-activity";
import { resolveCurrentSessionRowId } from "@/lib/security/session-current";
import { resolveSecurityStepUp } from "@/lib/security/step-up";
import { buildSecurityStepUpMethods } from "@/lib/security/step-up-methods";

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
    return jsonError("Not authenticated", 401, "UNAUTHORIZED");
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
    return jsonError("Failed to load sessions", 500, "INTERNAL_ERROR");
  }
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
    return jsonError("Not authenticated", 401, "UNAUTHORIZED");
  }

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

  if (id !== resolvedCurrentSessionId) {
    logApiRoute(request, {
      requestId,
      action: "sessions.delete",
      userId: auth.user.id,
      startedAt,
      success: false,
      status: 404,
      errorCode: "NOT_FOUND",
    });
    return jsonError("Session not found", 404, "NOT_FOUND");
  }

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
      return jsonError("Failed to revoke session", 400, "SESSION_REVOKE_FAILED");
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
    return jsonError("Failed to revoke session", 500, "INTERNAL_ERROR");
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
    return jsonError("Not authenticated", 401, "UNAUTHORIZED");
  }

  try {
    const factors = await listSecurityMfaFactors(auth.supabase);
    const hasVerifiedTotp = getVerifiedTotpFactors(factors).length > 0;
    const remainingRecoveryCodes = countRemainingRecoveryCodes(
      (await getProtectedRecoveryCodes(user.id, { authorized: true }))?.securityRecoveryCodes ?? [],
    );
    const passwordLastChangedAt = await getLatestPasswordChangeAt(user.id);
    const availableMethods = buildSecurityStepUpMethods({
      hasTotp: hasVerifiedTotp,
      hasRecoveryCodes: remainingRecoveryCodes > 0,
      hasPassword: resolvePasswordCredentialState(user, passwordLastChangedAt),
    });

    if (availableMethods.length > 0) {
      const stepUp = await resolveSecurityStepUp(user.id, availableMethods);
      if (!stepUp.ok) {
        logApiRoute(request, {
          requestId,
          action: "sessions.deleteOthers",
          userId: user.id,
          startedAt,
          success: false,
          status: 403,
          errorCode: "STEP_UP_REQUIRED",
        });
        return jsonError("Verify this device before logging out other devices", 403, "STEP_UP_REQUIRED");
      }
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
      return jsonError("Failed to revoke other sessions", 400, "SESSION_REVOKE_FAILED");
    }

    await recordSecurityEvent({
      userId: user.id,
      eventType: "other_sessions_revoked",
      request,
      metadata: {
        revokedCount,
      },
    });

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
    return jsonError("Failed to revoke other sessions", 500, "INTERNAL_ERROR");
  }
}

export async function DELETE(request: Request) {
  const params = new URL(request.url).searchParams;
  if (params.get("scope") === "others") return deleteOtherSessions(request);
  const id = params.get("id");
  if (!id) return jsonError("Session id is required", 400, "BAD_REQUEST");
  return deleteSession(request, id);
}

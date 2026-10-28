import {
  enforceRouteLimit,
  getSessionIdentifier,
  getRequestId,
  getRequestIp,
  jsonError,
  jsonSuccess,
  logApiRoute,
  requireAuthenticatedUser,
} from "@/app/api/v1/_shared";
import { validateCsrf } from "@/lib/security/csrf";
import { isFreshlyVerified } from "@/lib/security/fresh-verification";
import { logger } from "@/lib/logger";
import { accountHasPassword } from "@/lib/auth/password-state";
import { getProtectedRecoveryCodes } from "@/lib/services/profile-service";
import {
  getLatestPasswordChangeAt,
  listSecurityActivity,
  deleteSecurityActivityEntry,
  clearAllSecurityActivity,
  recordSecurityEvent,
} from "@/lib/security/audit";
import { getVerifiedTotpFactors, listSecurityMfaFactors } from "@/lib/security/mfa";
import { countRemainingRecoveryCodes } from "@/lib/security/recovery-codes";
import {
  listActiveSessionsPage,
  listLoginHistory,
  enrichSessionDeviceInfo,
} from "@/lib/security/session-activity";
import { isLooseUuid } from "@/lib/validations/uuid";
import type { SecurityData } from "@/types/settingsTypes";

const SESSIONS_PAGE = 12;
const ACTIVITY_PAGE = 20;

export async function GET(request: Request) {
  const startedAt = Date.now();
  const requestId = getRequestId(request);

  const auth = await requireAuthenticatedUser();
  if (auth.response) {
    logApiRoute(request, {
      requestId,
      action: "security.get",
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
      action: "security.get",
      startedAt,
      success: false,
      status: 401,
      errorCode: "UNAUTHORIZED",
    });
    return jsonError("Not authenticated", 401, "UNAUTHORIZED");
  }

  // "Load older" on the activity list asks for just the next page, not the whole tab again.
  const olderThan = new URL(request.url).searchParams.get("activityBefore");
  if (olderThan) {
    const before = new Date(olderThan);
    if (Number.isNaN(before.getTime())) return jsonError("Invalid cursor", 400, "BAD_REQUEST");
    try {
      const rows = await listSecurityActivity(auth.user.id, ACTIVITY_PAGE + 1, before);
      return jsonSuccess({ securityActivity: rows.slice(0, ACTIVITY_PAGE), securityActivityHasMore: rows.length > ACTIVITY_PAGE });
    } catch (error) {
      logger.error("[api/v1/security] activity page failed", { module: "api", error: error instanceof Error ? error.message : String(error) });
      return jsonError("Failed to load security activity", 500, "INTERNAL_ERROR");
    }
  }

  try {
    const [
      passwordLastChangedAt,
      mfaFactors,
      sessionResult,
      loginHistory,
      securityActivity,
      recoveryCodesState,
      assuranceResult,
    ] = await Promise.all([
      getLatestPasswordChangeAt(auth.user.id),
      listSecurityMfaFactors(auth.supabase),
      auth.supabase.auth.getSession(),
      listLoginHistory(auth.user.id, 20),
      listSecurityActivity(auth.user.id, ACTIVITY_PAGE + 1),
      getProtectedRecoveryCodes(auth.user.id, { authorized: true }),
      ((auth.supabase.auth as any)?.mfa?.getAuthenticatorAssuranceLevel?.() ?? Promise.resolve(null)),
    ]);

    const verifiedTotpFactors = getVerifiedTotpFactors(mfaFactors);

    const session = sessionResult.data?.session;
    const currentSessionId =
      session ? getSessionIdentifier(session) ?? null : null;

    if (currentSessionId) {
      const incomingUa = request.headers.get("user-agent");
      const incomingIp = getRequestIp(request);
      if (incomingUa) {
        enrichSessionDeviceInfo(currentSessionId, incomingUa, incomingIp).catch(() => null);
      }
    }

    const sessionsPage = await listActiveSessionsPage(auth.user.id, currentSessionId, { limit: SESSIONS_PAGE });
    const storedRecoveryCodes = recoveryCodesState?.securityRecoveryCodes ?? [];
    const recoveryCodes = verifiedTotpFactors.length === 0 ? {
      configured: false,
      remainingCount: 0,
    } : {
      configured: recoveryCodesState?.hasRecoveryCodes ?? false,
      remainingCount: countRemainingRecoveryCodes(storedRecoveryCodes),
      ...(recoveryCodesState?.recoveryCodesGeneratedAt
        ? { generatedAt: recoveryCodesState.recoveryCodesGeneratedAt.toISOString() }
        : {}),
    };
    const normalizeAssurance = (level: unknown): "aal1" | "aal2" | null => level === "aal1" || level === "aal2" ? level : null;
    const payload: SecurityData = {
      mfaFactors,
      sessions: sessionsPage.sessions,
      sessionsNextOffset: sessionsPage.nextOffset,
      loginHistory,
      password: {
        hasPassword: await accountHasPassword(auth.user),
        ...(passwordLastChangedAt ? { lastChangedAt: passwordLastChangedAt } : {}),
      },
      recoveryCodes,
      securityActivity: securityActivity.slice(0, ACTIVITY_PAGE),
      securityActivityHasMore: securityActivity.length > ACTIVITY_PAGE,
      assurance: {
        currentLevel: normalizeAssurance(assuranceResult?.data?.currentLevel),
        nextLevel: normalizeAssurance(assuranceResult?.data?.nextLevel),
      },
    };

    logApiRoute(request, {
      requestId,
      action: "security.get",
      userId: auth.user.id,
      startedAt,
      success: true,
      status: 200,
    });
    return jsonSuccess(payload);
  } catch (error) {
    logger.error("[api/v1/security] failed", {
      module: 'api',
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    logApiRoute(request, {
      requestId,
      action: "security.get",
      userId: auth.user.id,
      startedAt,
      success: false,
      status: 500,
      errorCode: "INTERNAL_ERROR",
    });
    return jsonError("Failed to load security data", 500, "INTERNAL_ERROR");
  }
}

export async function DELETE(request: Request) {
  const startedAt = Date.now();
  const requestId = getRequestId(request);
  const csrfError = validateCsrf(request);
  if (csrfError) return csrfError;

  const auth = await requireAuthenticatedUser();
  if (auth.response) return auth.response;
  if (!auth.user) return jsonError("Not authenticated", 401, "UNAUTHORIZED");
  // The activity log is the evidence of a break-in: a stolen editor token must not be able to erase it.
  if (auth.extensionSessionId) return jsonError("This needs a browser session", 403, "FORBIDDEN");
  const deleteLimit = await enforceRouteLimit(request, "api:v1:security:delete", 30, 60, "default", auth.user.id);
  if (deleteLimit) return deleteLimit;

  const { searchParams } = new URL(request.url);
  const scope = searchParams.get("scope");
  const id = searchParams.get("id");

  try {
    if (scope === "all") {
      // Wiping the whole log needs a fresh check (the authenticator, when there is one), and leaves a note that it happened.
      if (!(await isFreshlyVerified(auth.supabase, auth.user))) {
        return jsonError("Verify this device before clearing your security activity", 403, "STEP_UP_REQUIRED");
      }
      await clearAllSecurityActivity(auth.user.id);
      await recordSecurityEvent({ userId: auth.user.id, eventType: "security_activity_cleared", request });
      logApiRoute(request, {
        requestId,
        action: "security.activity.clear",
        userId: auth.user.id,
        startedAt,
        success: true,
        status: 200,
      });
      return jsonSuccess(undefined, "All security activity cleared");
    }

    if (!id || !isLooseUuid(id)) {
      return jsonError("Valid activity id is required", 400, "BAD_REQUEST");
    }

    await deleteSecurityActivityEntry(auth.user.id, id);
    logApiRoute(request, {
      requestId,
      action: "security.activity.delete",
      userId: auth.user.id,
      startedAt,
      success: true,
      status: 200,
    });
    return jsonSuccess(undefined, "Security activity entry deleted");
  } catch (error) {
    logger.error("[api/v1/security] delete activity failed", {
      module: "api",
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonError("Failed to delete security activity", 500, "INTERNAL_ERROR");
  }
}

import { z } from "zod";
import { validateCsrf } from "@/lib/security/csrf";
import { accountHasPassword as readAccountHasPassword } from "@/lib/auth/password-state";
import {
  enforceRouteLimit,
  getRequestId,
  jsonError,
  jsonSuccess,
  logApiRoute,
  requireAuthenticatedUser,
} from "@/app/api/v1/_shared";
import { recordSecurityEvent } from "@/lib/security/audit";
import { isEmailVerified } from "@/lib/auth/email-verification";
import { getVerifiedTotpFactors, listSecurityMfaFactors } from "@/lib/security/mfa";
import { verifyPasswordCredential } from "@/lib/security/password-auth";
import { resolveSecurityStepUp } from "@/lib/security/step-up";
import { withIdempotentRoute } from "@/lib/security/idempotency";
import { getPasswordPolicyResult } from "@/lib/security/password-policy";
import { isLeakedPassword } from "@/lib/security/leaked-password";
import { logger } from "@/lib/logger";
import { revokeAllExtensionSessionsForUser } from "@/lib/security/extension-token-revocation";
import { queueSecurityEmail } from "@/lib/email/security-queue";

// Passwords are used exactly as typed (sign-in does not trim), so they are never trimmed here either.
const changePasswordSchema = z.object({
  currentPassword: z.string().max(128).optional(),
  newPassword: z.string().min(1).max(128),
  signOutOtherDevices: z.boolean().optional(),
});

export async function POST(request: Request) {
  const startedAt = Date.now();
  const requestId = getRequestId(request);
  const csrfError = validateCsrf(request);
  if (csrfError) {
    logApiRoute(request, {
      requestId,
      action: "auth.changePassword.post",
      startedAt,
      success: false,
      status: 403,
      errorCode: "FORBIDDEN",
    });
    return csrfError;
  }

  const limitResponse = await enforceRouteLimit(request, "api:v1:auth:change-password", 10, 3600);
  if (limitResponse) {
    logApiRoute(request, {
      requestId,
      action: "auth.changePassword.post",
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
      action: "auth.changePassword.post",
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
      action: "auth.changePassword.post",
      startedAt,
      success: false,
      status: 401,
      errorCode: "UNAUTHORIZED",
    });
    return jsonError("Not authenticated", 401, "UNAUTHORIZED");
  }

  const authUser = auth.user;
  // An editor token must not be able to change the password that protects the account.
  if (auth.extensionSessionId) return jsonError("Changing your password requires a browser session", 403, "FORBIDDEN");
  const userLimit = await enforceRouteLimit(request, "api:v1:auth:change-password:user", 10, 3600, "default", authUser.id);
  if (userLimit) return userLimit;
  return withIdempotentRoute(request, { namespace: 'auth.changePassword', scopeId: authUser.id }, async () => {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    logApiRoute(request, {
      requestId,
      action: "auth.changePassword.post",
      userId: authUser.id,
      startedAt,
      success: false,
      status: 400,
      errorCode: "BAD_REQUEST",
    });
    return jsonError("Malformed JSON body", 400, "BAD_REQUEST");
  }

  const parsed = changePasswordSchema.safeParse(rawBody);
  if (!parsed.success) {
    logApiRoute(request, {
      requestId,
      action: "auth.changePassword.post",
      userId: authUser.id,
      startedAt,
      success: false,
      status: 400,
      errorCode: "BAD_REQUEST",
    });
    return jsonError("Invalid request body", 400, "BAD_REQUEST");
  }

  const currentPassword = parsed.data.currentPassword || "";
  const newPassword = parsed.data.newPassword;
  if (!newPassword.trim()) {
    logApiRoute(request, {
      requestId,
      action: "auth.changePassword.post",
      userId: authUser.id,
      startedAt,
      success: false,
      status: 400,
      errorCode: "BAD_REQUEST",
    });
    return jsonError("A new password is required", 400, "BAD_REQUEST");
  }
  const passwordPolicy = getPasswordPolicyResult(newPassword);
  if (!passwordPolicy.ok) {
    logApiRoute(request, {
      requestId,
      action: "auth.changePassword.post",
      userId: authUser.id,
      startedAt,
      success: false,
      status: 400,
      errorCode: "BAD_REQUEST",
    });
    return jsonError(passwordPolicy.error || "New password does not meet security requirements", 400, "BAD_REQUEST");
  }
  if (newPassword === currentPassword) {
    logApiRoute(request, {
      requestId,
      action: "auth.changePassword.post",
      userId: authUser.id,
      startedAt,
      success: false,
      status: 400,
      errorCode: "BAD_REQUEST",
    });
    return jsonError("New password must be different from current password", 400, "BAD_REQUEST");
  }

  try {
    if (await isLeakedPassword(newPassword)) {
      logApiRoute(request, {
        requestId,
        action: "auth.changePassword.post",
        userId: authUser.id,
        startedAt,
        success: false,
        status: 400,
        errorCode: "LEAKED_PASSWORD",
      });
      return jsonError(
        "This password has appeared in a data breach. Choose a different password.",
        400,
        "LEAKED_PASSWORD",
      );
    }
  } catch {
    return jsonError(
      "Password safety check is temporarily unavailable. Try again.",
      503,
      "PASSWORD_SAFETY_UNAVAILABLE",
    );
  }

  if (!authUser.email || !isEmailVerified(authUser)) {
    logApiRoute(request, {
      requestId,
      action: "auth.changePassword.post",
      userId: authUser.id,
      startedAt,
      success: false,
      status: 400,
      errorCode: "BAD_REQUEST",
    });
    return jsonError("Account is missing a verified email address", 400, "BAD_REQUEST");
  }

  // The stored credential decides, not the activity log (which the person can clear and which is trimmed on a schedule).
  const accountHasPassword = await readAccountHasPassword(authUser);
  if (accountHasPassword && !currentPassword) {
    logApiRoute(request, {
      requestId,
      action: "auth.changePassword.post",
      userId: authUser.id,
      startedAt,
      success: false,
      status: 400,
      errorCode: "BAD_REQUEST",
    });
    return jsonError("Current password is required", 400, "BAD_REQUEST");
  }

  try {
    const mfaFactors = await listSecurityMfaFactors(auth.supabase);
    const hasVerifiedTotp = getVerifiedTotpFactors(mfaFactors).length > 0;

    if (hasVerifiedTotp || !accountHasPassword) {
      const stepUp = await resolveSecurityStepUp(authUser.id, ["totp", "recovery_code"]);
      if (!stepUp.ok) {
        logApiRoute(request, {
          requestId,
          action: "auth.changePassword.post",
          userId: authUser.id,
          startedAt,
          success: false,
          status: 403,
          errorCode: "STEP_UP_REQUIRED",
        });
        return jsonError(
          accountHasPassword
            ? "Verify this device with your authenticator app or a recovery code before changing your password"
            : "Set up MFA and verify this device before setting a password on this account",
          403,
          "STEP_UP_REQUIRED",
        );
      }
    }

    if (accountHasPassword) {
      const verifyResult = await verifyPasswordCredential(authUser.email, currentPassword);
      if (!verifyResult.ok) {
        const invalidCredentials = verifyResult.reason === "invalid_credentials";
        const emailNotConfirmed = verifyResult.reason === "email_not_confirmed";
        logApiRoute(request, {
          requestId,
          action: "auth.changePassword.post",
          userId: authUser.id,
          startedAt,
          success: false,
          status: invalidCredentials ? 400 : emailNotConfirmed ? 403 : 500,
          errorCode: invalidCredentials
            ? "CURRENT_PASSWORD_INVALID"
            : emailNotConfirmed
              ? "EMAIL_NOT_CONFIRMED"
              : "INTERNAL_ERROR",
        });
        return jsonError(
          verifyResult.message || (
            invalidCredentials
              ? "Current password is incorrect"
              : emailNotConfirmed
                ? "Confirm your email address before changing your password"
                : "Unable to verify password"
          ),
          invalidCredentials ? 400 : emailNotConfirmed ? 403 : 500,
          invalidCredentials ? "CURRENT_PASSWORD_INVALID" : emailNotConfirmed ? "EMAIL_NOT_CONFIRMED" : "INTERNAL_ERROR",
        );
      }
    }

    const updateResult = await auth.supabase.auth.updateUser({ password: newPassword });
    if (updateResult.error) {
      logApiRoute(request, {
        requestId,
        action: "auth.changePassword.post",
        userId: authUser.id,
        startedAt,
        success: false,
        status: 400,
        errorCode: "PASSWORD_CHANGE_FAILED",
      });
      return jsonError("Password update failed", 400, "PASSWORD_CHANGE_FAILED");
    }

    // The old password may be in someone else's hands: editor tokens always end, and other browsers by default.
    // Each step on its own: a failure ending the editor tokens must not leave other browsers signed in, or the reverse.
    const revocations = await Promise.allSettled([
      revokeAllExtensionSessionsForUser(authUser.id),
      parsed.data.signOutOtherDevices !== false ? auth.supabase.auth.signOut({ scope: "others" }) : Promise.resolve(null),
    ]);
    for (const outcome of revocations) {
      if (outcome.status === "rejected") {
        logger.warn("auth.change_password.revoke_failed", {
          requestId,
          userId: authUser.id,
          error: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
        });
      }
    }

    try {
      await recordSecurityEvent({
        userId: authUser.id,
        eventType: accountHasPassword ? "password_changed" : "password_set",
        request,
        previousValue: { hasPassword: accountHasPassword },
        nextValue: { hasPassword: true },
        metadata: {
          hasAuthenticatorApp: hasVerifiedTotp,
        },
      });
    } catch (auditError) {
      logger.error("auth.change_password.audit_failed", {
        requestId,
        userId: authUser.id,
        eventType: accountHasPassword ? "password_changed" : "password_set",
        error: auditError,
      });
    }

    await queueSecurityEmail(authUser.id, "security_password_changed");
    logApiRoute(request, {
      requestId,
      action: "auth.changePassword.post",
      userId: authUser.id,
      startedAt,
      success: true,
      status: 200,
    });
    return jsonSuccess(undefined, "Password updated");
  } catch (error) {
    logger.error("[api/v1/auth/change-password] failed", { module: 'api', error: error instanceof Error ? error.message : String(error) });
    logApiRoute(request, {
      requestId,
      action: "auth.changePassword.post",
      userId: authUser.id,
      startedAt,
      success: false,
      status: 500,
      errorCode: "INTERNAL_ERROR",
    });
    return jsonError("Failed to change password", 500, "INTERNAL_ERROR");
  }
  });
}

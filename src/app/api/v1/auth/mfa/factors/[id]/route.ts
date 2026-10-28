import { validateCsrf } from "@/lib/security/csrf";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { profileSecurityStates } from "@/lib/db/schema";
import {
  enforceRouteLimit,
  getRequestId,
  jsonError,
  jsonSuccess,
  logApiRoute,
  requireAuthenticatedUser,
} from "@/app/api/v1/_shared";
import { recordSecurityEvent } from "@/lib/security/audit";
import { queueSecurityEmail } from "@/lib/email/security-queue";
import { getVerifiedTotpFactors, listSecurityMfaFactors } from "@/lib/security/mfa";
import { countRemainingRecoveryCodes, parseStoredRecoveryCodes } from "@/lib/security/recovery-codes";
import { resolveSecurityStepUp } from "@/lib/security/step-up";
import { withIdempotentRoute } from "@/lib/security/idempotency";
import { mapAuthProviderError } from "@/lib/security/auth-provider-error";
import { logger } from "@/lib/logger";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const startedAt = Date.now();
  const requestId = getRequestId(request);
  const csrfError = validateCsrf(request);
  if (csrfError) {
    logApiRoute(request, {
      requestId,
      action: "auth.mfaFactor.delete",
      startedAt,
      success: false,
      status: 403,
      errorCode: "FORBIDDEN",
    });
    return csrfError;
  }

  const limitResponse = await enforceRouteLimit(request, "api:v1:auth:mfa:factors:delete", 40, 60);
  if (limitResponse) {
    logApiRoute(request, {
      requestId,
      action: "auth.mfaFactor.delete",
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
      action: "auth.mfaFactor.delete",
      startedAt,
      success: false,
      status: 401,
      errorCode: "UNAUTHORIZED",
    });
    return auth.response;
  }
  const user = auth.user;
  if (!user) {
    return jsonError("Not authenticated", 401, "UNAUTHORIZED");
  }

  const { id } = await context.params;

  return withIdempotentRoute(request, { namespace: 'auth.mfa.deleteFactor', scopeId: user.id }, async () => {
  try {
    const factors = await listSecurityMfaFactors(auth.supabase);
    const factorToRemove = factors.find((factor) => factor.id === id) ?? null;
    const verifiedTotpFactors = getVerifiedTotpFactors(factors);
    const isVerifiedTotp = factorToRemove?.type === "totp" && factorToRemove.status === "verified";

    if (isVerifiedTotp) {
      const stepUp = await resolveSecurityStepUp(user.id, ["totp", "recovery_code"]);
      if (!stepUp.ok) {
        logApiRoute(request, {
          requestId,
          action: "auth.mfaFactor.delete",
          userId: auth.user?.id ?? null,
          startedAt,
          success: false,
          status: 403,
          errorCode: "STEP_UP_REQUIRED",
        });
        return jsonError(
          "Verify this device with your authenticator app or a recovery code before removing an authenticator app",
          403,
          "STEP_UP_REQUIRED",
        );
      }
    }

    const result = await auth.supabase.auth.mfa.unenroll({ factorId: id });
    if (result.error) {
      const mapped = mapAuthProviderError(result.error, "Failed to remove MFA factor");
      logApiRoute(request, {
        requestId,
        action: "auth.mfaFactor.delete",
        userId: auth.user?.id ?? null,
        startedAt,
        success: false,
        status: mapped.status,
        errorCode: mapped.errorCode,
      });
      return jsonError(mapped.message, mapped.status, mapped.errorCode);
    }

    try {
      const removingLastVerifiedTotp = isVerifiedTotp && verifiedTotpFactors.length === 1;
      let clearedRecoveryCodes = false;
      let previousRemainingRecoveryCodes = 0;
      let bumpedGeneration = false;

      if (isVerifiedTotp) {
        // SEC-H3: any TOTP factor change invalidates recovery codes issued
        // against the old factor. Either (a) the removed factor was the one
        // bound to the stored codes (unbind + clear), or (b) it was a
        // secondary factor (bump generation only, retain codes).
        const existingProfileSecurityState = await db.query.profileSecurityStates.findFirst({
          columns: {
            securityRecoveryCodes: true,
            recoveryCodesFactorId: true,
            recoveryCodesGeneration: true,
          },
          where: eq(profileSecurityStates.userId, user.id),
        });
        const storedCodes = parseStoredRecoveryCodes(existingProfileSecurityState?.securityRecoveryCodes);
        previousRemainingRecoveryCodes = countRemainingRecoveryCodes(storedCodes);
        const boundToThisFactor = existingProfileSecurityState?.recoveryCodesFactorId === id;
        const shouldClear = removingLastVerifiedTotp || boundToThisFactor;
        clearedRecoveryCodes = shouldClear && storedCodes.length > 0;
        const currentGeneration = Number(existingProfileSecurityState?.recoveryCodesGeneration ?? 0) || 0;
        bumpedGeneration = true;

        await db
          .insert(profileSecurityStates)
          .values({
            userId: user.id,
            securityRecoveryCodes: shouldClear ? [] : storedCodes,
            recoveryCodesGeneratedAt: shouldClear ? null : undefined,
            recoveryCodesFactorId: shouldClear ? null : existingProfileSecurityState?.recoveryCodesFactorId ?? null,
            recoveryCodesGeneration: currentGeneration + 1,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: profileSecurityStates.userId,
            set: {
              ...(shouldClear
                ? {
                    securityRecoveryCodes: [],
                    recoveryCodesGeneratedAt: null,
                    recoveryCodesFactorId: null,
                  }
                : {}),
              recoveryCodesGeneration: currentGeneration + 1,
              updatedAt: new Date(),
            },
          });
      }

      await recordSecurityEvent({
        userId: user.id,
        eventType: "authenticator_app_removed",
        request,
        metadata: {
          factorId: id,
          friendlyName: factorToRemove?.friendly_name ?? "Authenticator app",
          clearedRecoveryCodes,
          previousRemainingRecoveryCodes,
          bumpedRecoveryCodesGeneration: bumpedGeneration,
        },
      });
      await queueSecurityEmail(user.id, "security_mfa_changed", { detail: "removed" });
    } catch (cleanupError) {
      logger.error("auth.mfaFactor.delete.post_unenroll_cleanup_failed", {
        requestId,
        userId: user.id,
        factorId: id,
        error: cleanupError,
      });
    }

    logApiRoute(request, {
      requestId,
      action: "auth.mfaFactor.delete",
      userId: auth.user?.id ?? null,
      startedAt,
      success: true,
      status: 200,
    });
    return jsonSuccess(undefined, "MFA factor removed");
  } catch (error) {
    logger.error("[api/v1/auth/mfa/factors/:id] failed", { module: 'api', error: error instanceof Error ? error.message : String(error) });
    logApiRoute(request, {
      requestId,
      action: "auth.mfaFactor.delete",
      userId: auth.user?.id ?? null,
      startedAt,
      success: false,
      status: 500,
      errorCode: "INTERNAL_ERROR",
    });
    return jsonError("Failed to remove MFA factor", 500, "INTERNAL_ERROR");
  }
  });
}

import { and, eq, sql } from "drizzle-orm";
import { validateCsrf } from "@/lib/security/csrf";
import { db } from "@/lib/db";
import { profileAuditEvents, profileSecurityStates } from "@/lib/db/schema";
import {
  enforceRouteLimit,
  getRequestId,
  jsonError,
  jsonSuccess,
  logApiRoute,
  requireAuthenticatedUser,
} from "@/app/api/v1/_shared";
import { withIdempotentRoute } from "@/lib/security/idempotency";
import { logger } from "@/lib/logger";
import { recordSecurityEvent } from "@/lib/security/audit";
import { queueSecurityEmail } from "@/lib/email/security-queue";
import {
  countRemainingRecoveryCodes,
  generateRecoveryCodes,
  parseStoredRecoveryCodes,
} from "@/lib/security/recovery-codes";
import { getVerifiedTotpFactors, listSecurityMfaFactors } from "@/lib/security/mfa";
import { resolveSecurityStepUp } from "@/lib/security/step-up";

type RecoveryCodeBody = {
  mode?: string;
};

function parseBody(payload: unknown): RecoveryCodeBody {
  if (!payload || typeof payload !== "object") return {};
  return payload as RecoveryCodeBody;
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const requestId = getRequestId(request);
  const csrfError = validateCsrf(request);
  if (csrfError) {
    logApiRoute(request, {
      requestId,
      action: "auth.mfaRecoveryCodes.post",
      startedAt,
      success: false,
      status: 403,
      errorCode: "FORBIDDEN",
    });
    return csrfError;
  }

  const limitResponse = await enforceRouteLimit(request, "api:v1:auth:mfa:recovery-codes", 20, 60);
  if (limitResponse) {
    logApiRoute(request, {
      requestId,
      action: "auth.mfaRecoveryCodes.post",
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
      action: "auth.mfaRecoveryCodes.post",
      startedAt,
      success: false,
      status: 401,
      errorCode: "UNAUTHORIZED",
    });
    return auth.response;
  }
  const user = auth.user;
  if (!user) {
    return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
  }

  // Recovery codes are secrets: the response is never stored for replay, duplicates get 409 while the marker lives.
  return withIdempotentRoute(request, { namespace: 'auth.mfa.recoveryCodes', scopeId: user.id, replayBody: false }, async () => {
  let body: RecoveryCodeBody = {};
  try {
    body = parseBody(await request.json());
  } catch {
    return jsonError("Malformed JSON body", 400, "BAD_REQUEST");
  }

  const mode = body.mode;
  if (mode !== "initial" && mode !== "regenerate") {
    return jsonError("A valid recovery-code mode is required", 400, "BAD_REQUEST");
  }

  try {
    const factors = await listSecurityMfaFactors(auth.supabase);
    const verifiedTotpFactors = getVerifiedTotpFactors(factors);
    if (verifiedTotpFactors.length === 0) {
      return jsonError("Set up an authenticator app before managing recovery codes", 400, "BAD_REQUEST");
    }

    if (mode === "regenerate") {
      const stepUp = await resolveSecurityStepUp(user.id, ["totp", "recovery_code"]);
      if (!stepUp.ok) {
        return jsonError(
          "Verify this device with your authenticator app or a recovery code before regenerating recovery codes",
          403,
          "STEP_UP_REQUIRED",
        );
      }
    }

    const generated = generateRecoveryCodes();
    // SEC-H3: bind the generated codes to the TOTP factor that is currently
    // verified. On redemption we re-check this factor still exists; if the
    // user rotates their authenticator, codes tied to the old factor become
    // unusable. The first verified TOTP factor is deterministic per-user —
    // Supabase orders by created_at ASC.
    const bindingFactorId = verifiedTotpFactors[0]?.id ?? null;
    const result = await db.transaction(async (tx) => {
      // FOR UPDATE locks nothing when the row is absent, so two first requests would both pass as "initial".
      await tx.insert(profileSecurityStates).values({ userId: user.id }).onConflictDoNothing();
      const rows = await tx.execute<{
        security_recovery_codes: unknown;
        recovery_codes_generated_at: Date | string | null;
        recovery_codes_generation: number | string | null;
      }>(sql`
        SELECT security_recovery_codes, recovery_codes_generated_at, recovery_codes_generation
        FROM profile_security_states
        WHERE user_id = ${user.id}::uuid
        FOR UPDATE
      `);

      const existingCodes = parseStoredRecoveryCodes(rows[0]?.security_recovery_codes);
      const existingGeneratedAt = rows[0]?.recovery_codes_generated_at
        ? new Date(rows[0].recovery_codes_generated_at).toISOString()
        : null;
      const existingGeneration = Number(rows[0]?.recovery_codes_generation ?? 0) || 0;
      const nextGeneration = existingGeneration + 1;

      if (mode === "initial" && (existingCodes.length > 0 || existingGeneratedAt)) {
        return {
          conflict: true,
          previousRemainingCount: countRemainingRecoveryCodes(existingCodes),
          previousGeneratedAt: existingGeneratedAt,
        };
      }

      await tx
        .insert(profileSecurityStates)
        .values({
          userId: user.id,
          securityRecoveryCodes: generated.storedCodes,
          recoveryCodesGeneratedAt: new Date(generated.generatedAt),
          recoveryCodesFactorId: bindingFactorId,
          recoveryCodesGeneration: nextGeneration,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: profileSecurityStates.userId,
          set: {
            securityRecoveryCodes: generated.storedCodes,
            recoveryCodesGeneratedAt: new Date(generated.generatedAt),
            recoveryCodesFactorId: bindingFactorId,
            recoveryCodesGeneration: nextGeneration,
            updatedAt: new Date(),
          },
        });

      await recordSecurityEvent({
        userId: user.id,
        eventType: mode === "initial" ? "recovery_codes_generated" : "recovery_codes_regenerated",
        request,
        metadata: {
          remainingCount: generated.codes.length,
          previousRemainingCount: countRemainingRecoveryCodes(existingCodes),
          ...(existingGeneratedAt ? { previousGeneratedAt: existingGeneratedAt } : {}),
        },
        executor: tx,
      });

      if (mode === "initial") {
        const [existingEnableEvent] = await tx
          .select({
            id: profileAuditEvents.id,
          })
          .from(profileAuditEvents)
          .where(
            and(
              eq(profileAuditEvents.userId, user.id),
              eq(profileAuditEvents.eventType, "authenticator_app_enabled"),
            ),
          )
          .limit(1);

        if (!existingEnableEvent) {
          await recordSecurityEvent({
            userId: user.id,
            eventType: "authenticator_app_enabled",
            request,
            metadata: {
              factorCount: verifiedTotpFactors.length,
            },
            executor: tx,
          });
        }
      }

      return {
        conflict: false,
        previousRemainingCount: countRemainingRecoveryCodes(existingCodes),
        previousGeneratedAt: existingGeneratedAt,
      };
    });

    if (result.conflict) {
      return jsonError(
        "Recovery codes were already generated. Regenerate them from the Security tab instead.",
        409,
        "CONFLICT",
      );
    }

    // Turning on an authenticator (the first set of codes) or replacing the codes is worth telling the person about.
    await queueSecurityEmail(user.id, "security_mfa_changed", { detail: mode === "initial" ? "added" : "regenerated" });
    logApiRoute(request, {
      requestId,
      action: "auth.mfaRecoveryCodes.post",
      userId: user.id,
      startedAt,
      success: true,
      status: 200,
    });
    const responseData = {
      codes: generated.codes,
      configured: true,
      remainingCount: generated.codes.length,
      generatedAt: generated.generatedAt,
    };
    return jsonSuccess(responseData);
  } catch (error) {
    logger.error("[api/v1/auth/mfa/recovery-codes] failed", { module: 'api', error: error instanceof Error ? error.message : String(error) });
    logApiRoute(request, {
      requestId,
      action: "auth.mfaRecoveryCodes.post",
      userId: user.id,
      startedAt,
      success: false,
      status: 500,
      errorCode: "INTERNAL_ERROR",
    });
    return jsonError("Couldn’t manage recovery codes", 500, "INTERNAL_ERROR");
  }
  });
}

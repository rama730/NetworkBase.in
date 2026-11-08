import { z } from "zod";
import { enforceRouteLimit, jsonError, jsonSuccess } from "@/app/api/v1/_shared";
import { forgetMfaFactorCache } from "@/lib/auth/mfa-gate";
import { queueSecurityEmail } from "@/lib/email/security-queue";
import { logger } from "@/lib/logger";
import { recordSecurityEvent } from "@/lib/security/audit";
import { validateCsrf } from "@/lib/security/csrf";
import { redeemRecoveryCode } from "@/lib/security/recovery-redeem";
import { createAdminClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  accessToken: z.string().trim().min(1).max(8192),
  code: z.string().trim().min(1).max(64),
});

/**
 * The sign-in code screen's "Use a recovery code": for someone who lost their authenticator. The password step is
 * done (the token proves it); a matching code is used once, the lost authenticator is removed so the account can be
 * reached, and an email says so. The person sets two-step up again in Settings.
 */
export async function POST(request: Request) {
  const csrf = validateCsrf(request);
  if (csrf) return csrf;
  const limited = await enforceRouteLimit(request, "api:v1:auth:mfa:recover", 10, 900);
  if (limited) return limited;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Enter one of your recovery codes.", 400, "BAD_REQUEST");

  const admin = await createAdminClient();
  const { data: userData, error: userError } = await admin.auth.getUser(parsed.data.accessToken);
  const user = userData?.user;
  if (userError || !user) return jsonError("Your sign-in expired. Sign in again to continue.", 401, "UNAUTHORIZED");
  const userLimited = await enforceRouteLimit(request, "api:v1:auth:mfa:recover:user", 5, 900, "default", user.id);
  if (userLimited) return userLimited;

  const { data: factorData, error: factorError } = await admin.auth.admin.mfa.listFactors({ userId: user.id });
  if (factorError) return jsonError("Couldn’t check the code. Try again.", 503, "UNAVAILABLE");
  const verifiedTotp = (factorData?.factors ?? []).filter((factor) => factor.factor_type === "totp" && factor.status === "verified");
  if (verifiedTotp.length === 0) return jsonError("Two-step verification isn’t on for this account.", 400, "BAD_REQUEST");

  const result = await redeemRecoveryCode(user.id, parsed.data.code, new Set(verifiedTotp.map((factor) => factor.id)));
  if (!result.matched) {
    await recordSecurityEvent({ userId: user.id, eventType: "recovery_code_redemption_failed", request, metadata: { context: "sign_in" } }).catch(() => null);
    return jsonError(result.factorInvalidated
      ? "These recovery codes no longer work. Write to support@networkbase.in to get back in."
      : "That recovery code didn’t work. Check it and try again. Each code works once.", 400, "RECOVERY_CODE_INVALID");
  }

  for (const factor of verifiedTotp) {
    const { error } = await admin.auth.admin.mfa.deleteFactor({ userId: user.id, id: factor.id });
    if (error) {
      logger.error("auth.mfa_recover.delete_factor_failed", { userId: user.id, error: error.message });
      return jsonError("Couldn’t finish. Try again in a minute.", 503, "UNAVAILABLE");
    }
  }
  forgetMfaFactorCache(user.id);
  await recordSecurityEvent({ userId: user.id, eventType: "recovery_code_used", request, metadata: { context: "sign_in", authenticatorRemoved: true, remaining: result.remainingCount } }).catch(() => null);
  await recordSecurityEvent({ userId: user.id, eventType: "authenticator_app_removed", request, metadata: { context: "recovery_code_sign_in" } }).catch(() => null);
  await queueSecurityEmail(user.id, "security_mfa_changed", { detail: "removed" });
  return jsonSuccess({ recovered: true });
}

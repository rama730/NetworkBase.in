import "server-only";

import type { requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { resolvePasswordCredentialState } from "@/lib/auth/account-identity";
import { getLatestPasswordChangeAt } from "@/lib/security/audit";
import { getVerifiedTotpFactors, listSecurityMfaFactors } from "@/lib/security/mfa";
import { countRemainingRecoveryCodes } from "@/lib/security/recovery-codes";
import { buildSecurityStepUpMethods } from "@/lib/security/step-up-methods";
import { getProtectedRecoveryCodes } from "@/lib/services/profile-service";

/** Step-up methods this account can complete (shared by the step-up and account-deletion routes). */
export async function resolveStepUpCapabilities(input: {
  supabase: Awaited<ReturnType<typeof requireAuthenticatedUser>>["supabase"];
  user: NonNullable<Awaited<ReturnType<typeof requireAuthenticatedUser>>["user"]>;
}) {
  const factors = await listSecurityMfaFactors(input.supabase);
  const verifiedTotpFactor = getVerifiedTotpFactors(factors)[0];
  const remainingRecoveryCodes = countRemainingRecoveryCodes(
    (await getProtectedRecoveryCodes(input.user.id, { authorized: true }))?.securityRecoveryCodes ?? [],
  );
  const passwordLastChangedAt = await getLatestPasswordChangeAt(input.user.id);
  const availableMethods = buildSecurityStepUpMethods({
    hasTotp: Boolean(verifiedTotpFactor?.id),
    hasRecoveryCodes: remainingRecoveryCodes > 0,
    hasPassword: Boolean(input.user.email && resolvePasswordCredentialState(input.user, passwordLastChangedAt)),
  });

  return {
    availableMethods,
    primaryTotpFactorId: verifiedTotpFactor?.id,
  };
}

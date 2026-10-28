import "server-only";

import type { User } from "@supabase/supabase-js";

import { accountHasPassword } from "@/lib/auth/password-state";
import { getProtectedRecoveryCodes } from "@/lib/services/profile-service";
import { getVerifiedTotpFactors, listSecurityMfaFactors } from "@/lib/security/mfa";
import { countRemainingRecoveryCodes } from "@/lib/security/recovery-codes";
import { resolveSecurityStepUp } from "@/lib/security/step-up";
import { buildSecurityStepUpMethods } from "@/lib/security/step-up-methods";

/**
 * True once the person has verified this device recently, or when the account has nothing to verify with (then
 * the sign-in itself is the proof, as for deleting the account). When the account has an authenticator, that is
 * what must have verified it: a password alone is the weakest method, and a stolen session plus a stolen password
 * must not be enough to sign everyone else out or erase the evidence.
 */
export async function isFreshlyVerified(supabase: Parameters<typeof listSecurityMfaFactors>[0], user: User): Promise<boolean> {
  const hasVerifiedTotp = getVerifiedTotpFactors(await listSecurityMfaFactors(supabase)).length > 0;
  const remainingRecoveryCodes = countRemainingRecoveryCodes(
    (await getProtectedRecoveryCodes(user.id, { authorized: true }))?.securityRecoveryCodes ?? [],
  );
  const availableMethods = buildSecurityStepUpMethods({
    hasTotp: hasVerifiedTotp,
    hasRecoveryCodes: remainingRecoveryCodes > 0,
    hasPassword: await accountHasPassword(user),
  });
  if (availableMethods.length === 0) return true;
  return (await resolveSecurityStepUp(user.id, hasVerifiedTotp ? ["totp", "recovery_code"] : availableMethods)).ok;
}

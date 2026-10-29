import "server-only";

import type { User } from "@supabase/supabase-js";

import { accountHasPassword } from "@/lib/auth/password-state";
import { getProtectedRecoveryCodes } from "@/lib/services/profile-service";
import { getVerifiedTotpFactors, listSecurityMfaFactors } from "@/lib/security/mfa";
import { countRemainingRecoveryCodes } from "@/lib/security/recovery-codes";
import { resolveDestructiveStepUp } from "@/lib/security/destructive-step-up";
import { buildSecurityStepUpMethods } from "@/lib/security/step-up-methods";

/**
 * True once the person has verified this device recently, or when the account has nothing to verify with (then
 * the sign-in itself is the proof, as for deleting the account). When the account has an authenticator, that is
 * what must have verified it: a password alone is the weakest method, and a stolen session plus a stolen password
 * must not be enough to sign everyone else out or erase the evidence.
 */
export async function isFreshlyVerified(supabase: Parameters<typeof listSecurityMfaFactors>[0], user: User): Promise<boolean> {
  return (await stepUpState(supabase, user)).fresh;
}

/** The same check, plus what the step-up dialog needs when it fails. */
export async function stepUpState(supabase: Parameters<typeof listSecurityMfaFactors>[0], user: User) {
  const totp = getVerifiedTotpFactors(await listSecurityMfaFactors(supabase));
  const remainingRecoveryCodes = countRemainingRecoveryCodes(
    (await getProtectedRecoveryCodes(user.id, { authorized: true }))?.securityRecoveryCodes ?? [],
  );
  const methods = buildSecurityStepUpMethods({
    hasTotp: totp.length > 0,
    hasRecoveryCodes: remainingRecoveryCodes > 0,
    hasPassword: await accountHasPassword(user),
  });
  const fresh = methods.length === 0 || (await resolveDestructiveStepUp(supabase, user.id)).ok;
  return { fresh, methods, factorId: totp[0]?.id };
}

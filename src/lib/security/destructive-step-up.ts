import "server-only";

import { getVerifiedTotpFactors, listSecurityMfaFactors } from "@/lib/security/mfa";
import { resolveSecurityStepUp } from "@/lib/security/step-up";

/**
 * Step-up for actions that can't be undone (deleting the account, replacing a linked identity). An account that
 * has an authenticator must prove it with the authenticator or a recovery code: a password alone (the weakest
 * step-up method) is not enough, or a stolen session plus a stolen password would skip the second factor.
 */
export async function resolveDestructiveStepUp(
  supabase: Parameters<typeof listSecurityMfaFactors>[0],
  userId: string,
) {
  const hasAuthenticator = getVerifiedTotpFactors(await listSecurityMfaFactors(supabase)).length > 0;
  return resolveSecurityStepUp(userId, hasAuthenticator ? ["totp", "recovery_code"] : undefined);
}

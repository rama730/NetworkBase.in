import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { profileSecurityStates, recoveryCodeRedemptions } from "@/lib/db/schema";
import { consumeRecoveryCode, countRemainingRecoveryCodes, parseStoredRecoveryCodes } from "@/lib/security/recovery-codes";

export type RecoveryRedemption = { matched: boolean; remainingCount: number; factorInvalidated: boolean };

/**
 * Uses one recovery code, once: Settings' step-up and the sign-in code screen both come here. Codes count only while
 * the authenticator they were made with is still verified.
 */
export async function redeemRecoveryCode(userId: string, rawCode: string, verifiedTotpFactorIds: Set<string>): Promise<RecoveryRedemption> {
  return db.transaction(async (tx) => {
    const rows = await tx.execute<{
      security_recovery_codes: unknown;
      recovery_codes_factor_id: string | null;
    }>(sql`
      SELECT security_recovery_codes, recovery_codes_factor_id
      FROM profile_security_states
      WHERE user_id = ${userId}::uuid
      FOR UPDATE
    `);

    const storedCodes = parseStoredRecoveryCodes(rows[0]?.security_recovery_codes);
    if (storedCodes.length === 0) {
      return { matched: false, remainingCount: 0, factorInvalidated: false };
    }

    const storedFactorId = rows[0]?.recovery_codes_factor_id ?? null;
    // Reject when:
    //   a) codes were bound to a factor that is no longer verified, or
    //   b) codes were never bound (pre-SEC-H3) AND the user currently
    //      has no verified TOTP factor — users are expected to regen.
    const factorStillVerified = storedFactorId
      ? verifiedTotpFactorIds.has(storedFactorId)
      : verifiedTotpFactorIds.size > 0;
    if (!factorStillVerified) {
      return { matched: false, remainingCount: storedCodes.length, factorInvalidated: true };
    }

    const consumed = consumeRecoveryCode(storedCodes, rawCode);
    if (!consumed.matched) {
      return {
        matched: false,
        remainingCount: countRemainingRecoveryCodes(storedCodes),
        factorInvalidated: false,
      };
    }

    const redemption = await tx
      .insert(recoveryCodeRedemptions)
      .values({
        userId: userId,
        codeId: consumed.matchedCodeId!,
      })
      .onConflictDoNothing()
      .returning({ id: recoveryCodeRedemptions.id });

    if (redemption.length === 0) {
      return {
        matched: false,
        remainingCount: countRemainingRecoveryCodes(storedCodes),
        factorInvalidated: false,
      };
    }

    await tx
      .insert(profileSecurityStates)
      .values({
        userId: userId,
        securityRecoveryCodes: consumed.updatedCodes,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: profileSecurityStates.userId,
        set: {
          securityRecoveryCodes: consumed.updatedCodes,
          updatedAt: new Date(),
        },
      });

    return {
      matched: true,
      remainingCount: consumed.remainingCount,
      factorInvalidated: false,
    };
  });
}

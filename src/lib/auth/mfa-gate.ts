import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { needsSecondFactor } from "@/lib/auth/mfa-ui";

// "Has a factor" can be kept longer than "has none": a stale "none" right after someone enrols is the one answer that
// would let a password-only session through, so it expires within seconds.
const HAS_FACTOR_TTL_MS = 60_000;
const NO_FACTOR_TTL_MS = 5_000;
const FACTOR_CACHE_MAX_USERS = 10_000;

// ponytail: per-process cache, so each server instance keeps its own copy; move to Redis if instances multiply.
const factorCache = new Map<string, { has: boolean; at: number }>();

/**
 * Whether the account has a verified second factor. Read from auth.mfa_factors rather than the cookie session,
 * whose user object is not signed and could be edited to drop its factors.
 */
export async function hasVerifiedMfaFactor(userId: string): Promise<boolean> {
  const cached = factorCache.get(userId);
  if (cached && Date.now() - cached.at < (cached.has ? HAS_FACTOR_TTL_MS : NO_FACTOR_TTL_MS)) return cached.has;
  try {
    const rows = await db.execute<{ found: number }>(sql`
      SELECT 1 AS found WHERE app_private.nb_user_has_verified_mfa(${userId}::uuid)
    `);
    const has = rows.length > 0;
    if (factorCache.size >= FACTOR_CACHE_MAX_USERS) factorCache.clear();
    factorCache.set(userId, { has, at: Date.now() });
    return has;
  } catch (error) {
    logger.warn("auth.hasVerifiedMfaFactor_failed", { userId, error: error instanceof Error ? error.message : String(error) });
    // The last answer we had, even if expired. With none, let the request through: failing closed would send every
    // account without MFA to a code step it cannot finish whenever the database blips.
    return cached?.has ?? false;
  }
}

/** After an authenticator is removed outside the usual Settings path (a recovery code at sign-in). */
export function forgetMfaFactorCache(userId: string) {
  factorCache.delete(userId);
}

/**
 * A session that has only passed the password step, on an account that has a verified second factor. A browser the
 * person chose to trust for 30 days (its `nb-device` cookie) skips the code.
 */
export async function isSecondFactorDue(userId: string, aal: string | null | undefined, deviceCookie?: string | null): Promise<boolean> {
  if (aal === "aal2") return false;
  if (!needsSecondFactor(aal, await hasVerifiedMfaFactor(userId))) return false;
  if (!deviceCookie) return true;
  const { isTrustedDevice } = await import("@/lib/auth/devices");
  return !(await isTrustedDevice(userId, deviceCookie));
}

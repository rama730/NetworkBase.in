import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

/**
 * Whether the account has a verified second factor. Read from auth.mfa_factors rather than the cookie session,
 * whose user object is not signed and could be edited to drop its factors.
 * ponytail: fails open (no gate) when the read fails, so a database blip cannot lock everyone out.
 */
export async function hasVerifiedMfaFactor(userId: string): Promise<boolean> {
  try {
    const rows = await db.execute<{ found: number }>(sql`
      SELECT 1 AS found FROM auth.mfa_factors WHERE user_id = ${userId}::uuid AND status = 'verified' LIMIT 1
    `);
    return rows.length > 0;
  } catch (error) {
    logger.warn("auth.hasVerifiedMfaFactor_failed", { userId, error: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

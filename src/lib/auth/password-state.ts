import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { resolvePasswordCredentialState } from "@/lib/auth/account-identity";
import { getLatestPasswordChangeAt } from "@/lib/security/audit";
import type { User } from "@supabase/supabase-js";

/**
 * Whether the account has a password. The answer is the stored credential itself (auth.users), because the older
 * fallback (a "password set" row in the activity log) is something the person can clear, and the log is trimmed on
 * a schedule: an account would then read as having no password and be allowed to set one without the old one.
 * If the credential can't be read, the previous log-based answer is used.
 */
export async function accountHasPassword(user: User): Promise<boolean> {
  try {
    const rows = await db.execute<{ has_password: boolean }>(sql`
      SELECT app_private.nb_user_has_password(${user.id}::uuid) AS has_password
    `);
    const stored = rows[0]?.has_password;
    if (typeof stored === "boolean") return stored;
  } catch {
    // Fall through to the log-based answer.
  }
  return resolvePasswordCredentialState(user, await getLatestPasswordChangeAt(user.id));
}

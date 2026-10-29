import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { isAdminUser } from "@/lib/security/admin";

// Staff (T15, C1): accounts with role admin or moderator in auth metadata. Admins can also ban and remove
// workspaces or orgs; moderators do everything else.

export type StaffRole = "admin" | "moderator";
type AuthUser = { id: string; app_metadata?: Record<string, unknown> } | null | undefined;

export function staffRoleOf(user: AuthUser): StaffRole | null {
  if (!user) return null;
  if (isAdminUser(user)) return "admin";
  return user.app_metadata?.role === "moderator" ? "moderator" : null;
}

/** Every staff account with its email, for alerts. */
export async function listStaff(): Promise<Array<{ id: string; role: StaffRole; email: string | null; name: string | null }>> {
  const rows = await db.execute<{ id: string; role: StaffRole; email: string | null; name: string | null }>(sql`
    SELECT s.id, s.role, p.email, coalesce(p.full_name, p.username) AS name
    FROM app_private.moderation_staff() s LEFT JOIN profiles p ON p.id = s.id AND p.deleted_at IS NULL`);
  return [...rows];
}

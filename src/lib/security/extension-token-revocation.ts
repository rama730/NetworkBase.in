import "server-only";

import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/lib/db";
import { extensionDeviceSessions } from "@/lib/db/schema";

/**
 * Editor tokens (`nb_dev_…`) authenticate as the full user for a year, so they must not outlive the things that
 * protect the account: a password change, "sign out other devices" and a scheduled deletion all end them.
 * Returns how many were revoked.
 */
export async function revokeAllExtensionSessionsForUser(userId: string): Promise<number> {
  const rows = await db
    .update(extensionDeviceSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(extensionDeviceSessions.userId, userId), isNull(extensionDeviceSessions.revokedAt)))
    .returning({ id: extensionDeviceSessions.id });
  return rows.length;
}

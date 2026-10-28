import "server-only";

import { and, eq, gt, isNull, lte } from "drizzle-orm";

import { db } from "@/lib/db";
import { accountDeletions } from "@/lib/db/schema";
import { queueSecurityEmail } from "@/lib/email/security-queue";

/** Reminder points before the account is permanently deleted. */
const DELETION_REMINDER_DAYS = [7, 1] as const;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Daily: tells people whose deletion is pending that it is 7 days, then 1 day, away. A run queues a reminder for
 * every pending deletion now within that many days; the event key is per deletion and reminder, so running twice,
 * or a deletion first seen inside the 1-day window, never sends the same reminder again.
 */
export async function runAccountDeletionReminders(now = new Date()) {
  let queued = 0;
  for (const days of DELETION_REMINDER_DAYS) {
    const rows = await db
      .select({ id: accountDeletions.id, userId: accountDeletions.userId, hardDeleteAt: accountDeletions.hardDeleteAt })
      .from(accountDeletions)
      .where(and(
        isNull(accountDeletions.cancelledAt),
        isNull(accountDeletions.completedAt),
        eq(accountDeletions.cleanupStatus, "pending"),
        gt(accountDeletions.hardDeleteAt, now),
        lte(accountDeletions.hardDeleteAt, new Date(now.getTime() + days * DAY_MS)),
        // A deletion scheduled inside the window already got its "scheduled" email: no reminder the same day.
        lte(accountDeletions.scheduledAt, new Date(now.getTime() - DAY_MS)),
      ))
      .limit(500);
    for (const row of rows) {
      // The 1-day reminder replaces the 7-day one for a deletion that is already that close.
      if (days === 7 && row.hardDeleteAt.getTime() - now.getTime() <= DAY_MS) continue;
      await queueSecurityEmail(row.userId, "account_deletion_reminder", { hardDeleteAt: row.hardDeleteAt.toISOString(), daysLeft: Math.max(1, Math.ceil((row.hardDeleteAt.getTime() - now.getTime()) / DAY_MS)) }, `${row.id}:reminder:${days}`);
      queued += 1;
    }
  }
  return { queued };
}


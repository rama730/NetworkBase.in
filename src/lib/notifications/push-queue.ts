import { and, asc, eq, isNull, lte, or, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { notificationDeliveries, profiles, userNotifications } from "@/lib/db/schema";

// Failed attempts are retried with exponential backoff and stop after this many (COR-018).
export const MAX_PUSH_ATTEMPTS = 6;
export const PUSH_RETRY_BASE_MINUTES = 5;

/** Important notifications still owed a web push: not delivered or dropped, not exhausted, past their backoff. */
export async function selectDueWebPushNotifications(limit: number) {
  const now = new Date();
  return db
    .select({
      notification: userNotifications,
      notificationPreferences: profiles.notificationPreferences,
    })
    .from(userNotifications)
    .innerJoin(profiles, eq(profiles.id, userNotifications.userId))
    .where(and(
      eq(userNotifications.importance, "important"),
      isNull(userNotifications.dismissedAt),
      // A block made after the notice was written still stops the push (Blocking B17).
      sql`NOT app_private.blocked_between(${userNotifications.userId}, ${userNotifications.actorUserId})`,
      or(
        isNull(userNotifications.snoozedUntil),
        lte(userNotifications.snoozedUntil, now),
      ),
      sql`NOT EXISTS (
        SELECT 1
        FROM ${notificationDeliveries} delivery
        WHERE delivery.notification_id = ${userNotifications.id}
          AND delivery.channel = 'web_push'
          AND delivery.status IN ('delivered', 'dropped')
      )`,
      // Retry only what has failed fewer than MAX times and has waited out its backoff, so a page
      // of permanently failing rows cannot starve everything behind it.
      sql`(SELECT count(*) FROM ${notificationDeliveries} f
             WHERE f.notification_id = ${userNotifications.id} AND f.channel = 'web_push' AND f.status = 'failed') < ${MAX_PUSH_ATTEMPTS}`,
      sql`NOT EXISTS (
        SELECT 1 FROM ${notificationDeliveries} f
        WHERE f.notification_id = ${userNotifications.id} AND f.channel = 'web_push' AND f.status = 'failed'
          AND f.attempted_at > now() - make_interval(mins => ${PUSH_RETRY_BASE_MINUTES}
            * power(2, (SELECT count(*) FROM ${notificationDeliveries} c
                        WHERE c.notification_id = ${userNotifications.id} AND c.channel = 'web_push' AND c.status = 'failed') - 1)::int)
      )`,
    ))
    // Never-attempted notifications first, then the ones that have waited longest since a failure.
    .orderBy(
      sql`(SELECT max(f.attempted_at) FROM ${notificationDeliveries} f
             WHERE f.notification_id = ${userNotifications.id} AND f.channel = 'web_push' AND f.status = 'failed') ASC NULLS FIRST`,
      asc(userNotifications.createdAt),
      asc(userNotifications.id),
    )
    .limit(limit);
}

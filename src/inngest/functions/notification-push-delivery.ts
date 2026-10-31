import { and, asc, eq, isNull, lte, or, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  jobHeartbeats,
  notificationDeliveries,
  profiles,
  userNotifications,
} from "@/lib/db/schema";
import {
  getNotificationPauseUntil,
  getQuietHoursResumeAt,
  isNotificationPauseActive,
  isQuietHoursActive,
  normalizeNotificationPreferences,
} from "@/lib/notifications/preferences";
import { selectDueWebPushNotifications } from "@/lib/notifications/push-queue";
import { toNotificationItem } from "@/lib/notifications/service";
import { dispatchWebPush } from "@/lib/notifications/web-push";

import { inngest } from "../client";

export const NOTIFICATION_PUSH_DELIVERY_JOB_ID = "notification-push-delivery";

const DELIVERY_BATCH_SIZE = 100;
const DELIVERY_CONCURRENCY = 10;

/**
 * Canonical, post-commit owner for important web-push delivery.
 *
 * The durable notification row is the outbox record. A delivery attempt log
 * closes that record, while snoozed/quiet-hours rows remain eligible only when
 * their delay expires. This prevents external delivery from escaping a rolled
 * back source transaction and gives delayed notifications one bounded resume
 * path.
 */
export const notificationPushDelivery = inngest.createFunction(
  {
    id: NOTIFICATION_PUSH_DELIVERY_JOB_ID,
    retries: 2,
    concurrency: { limit: 1 },
  },
  // Woken when an important notification is created. The hourly run catches a lost wake, retries, and anything held
  // by quiet hours or a snooze, which goes out up to an hour after its delay ends.
  [{ event: "notification/push.wake" }, { cron: "30 * * * *" }],
  async ({ step }) => {
    const result = await step.run("deliver-due-web-push", async () => {
      const rows = await selectDueWebPushNotifications(DELIVERY_BATCH_SIZE);

      let delivered = 0;
      let dropped = 0;
      let delayed = 0;
      const droppedDeliveries: Array<{
        notificationId: string;
        userId: string;
        channel: "web_push";
        status: "dropped";
        errorCode: string;
        errorMessage: string | null;
      }> = [];

      for (let index = 0; index < rows.length; index += DELIVERY_CONCURRENCY) {
        const chunk = rows.slice(index, index + DELIVERY_CONCURRENCY);
        const outcomes = await Promise.all(chunk.map(async (row) => {
          const preferences = normalizeNotificationPreferences(row.notificationPreferences);
          if (!preferences.delivery.push) {
            droppedDeliveries.push({
              notificationId: row.notification.id,
              userId: row.notification.userId,
              channel: "web_push",
              status: "dropped",
              errorCode: "push_disabled",
              errorMessage: null,
            });
            return "dropped" as const;
          }

          const currentTime = new Date();
          const delayUntil = isNotificationPauseActive(preferences, currentTime)
            ? getNotificationPauseUntil(preferences, currentTime)
            : isQuietHoursActive(preferences, currentTime)
              ? getQuietHoursResumeAt(preferences, currentTime)
              : null;
          if (delayUntil && delayUntil > currentTime) {
            await db
              .update(userNotifications)
              .set({ snoozedUntil: delayUntil, updatedAt: currentTime })
              .where(and(
                eq(userNotifications.id, row.notification.id),
                or(
                  isNull(userNotifications.snoozedUntil),
                  lte(userNotifications.snoozedUntil, currentTime),
                ),
              ));
            return "delayed" as const;
          }

          const dispatch = await dispatchWebPush(
            row.notification.userId,
            toNotificationItem(row.notification),
          );
          return dispatch.delivered > 0 ? "delivered" as const : "dropped" as const;
        }));

        delivered += outcomes.filter((outcome) => outcome === "delivered").length;
        dropped += outcomes.filter((outcome) => outcome === "dropped").length;
        delayed += outcomes.filter((outcome) => outcome === "delayed").length;
      }

      if (droppedDeliveries.length > 0) {
        await db.insert(notificationDeliveries).values(droppedDeliveries);
      }

      return { scanned: rows.length, delivered, dropped, delayed };
    });

    if (result.scanned > 0) await step.run("write-heartbeat", async () => {
      const now = new Date();
      await db.insert(jobHeartbeats)
        .values({
          jobId: NOTIFICATION_PUSH_DELIVERY_JOB_ID,
          lastSuccessAt: now,
          lastPayload: result,
        })
        .onConflictDoUpdate({
          target: jobHeartbeats.jobId,
          set: { lastSuccessAt: now, lastPayload: result, updatedAt: now },
        });
    });

    // More was due than one run takes: the rest goes now rather than at the next hourly run. Only if this run moved
    // something, so rows that stay due can't loop.
    if (result.scanned >= DELIVERY_BATCH_SIZE && result.delivered + result.dropped > 0) await step.sendEvent("drain-more", { name: "notification/push.wake", data: {} });
    return result;
  },
);

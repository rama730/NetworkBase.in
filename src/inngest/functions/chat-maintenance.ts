import { db } from "@/lib/db";
import { jobHeartbeats } from "@/lib/db/schema";
import { logger } from "@/lib/logger";
import { dueTimesWithinNextHour, fireDueReminders, sendDueScheduledMessages } from "@/lib/messaging/due";
import { auditChatIntegrity, purgeOldChatMentions } from "@/lib/messaging/maintenance";

import { inngest } from "../client";
import { wakeAt } from "../wake";

export const CHAT_MENTIONS_RETENTION_JOB_ID = "chat-mentions-retention";
export const CHAT_INTEGRITY_AUDIT_JOB_ID = "chat-integrity-audit";
export const CHAT_DUE_JOB_ID = "chat-due";

async function heartbeat(jobId: string, payload: Record<string, unknown>) {
  const now = new Date();
  await db.insert(jobHeartbeats)
    .values({ jobId, lastSuccessAt: now, lastPayload: payload })
    .onConflictDoUpdate({ target: jobHeartbeats.jobId, set: { lastSuccessAt: now, lastPayload: payload, updatedAt: now } });
}

/** Activity keeps 90 days of mentions and thread replies. */
export const chatMentionsRetention = inngest.createFunction(
  { id: CHAT_MENTIONS_RETENTION_JOB_ID, retries: 2 },
  { cron: "15 4 * * *" },
  async ({ step }) => {
    let deleted = 0;
    let batch = 0;
    while (batch < 40) {
      const count = await step.run(`purge-${batch}`, () => purgeOldChatMentions(5_000));
      deleted += count;
      batch += 1;
      if (count < 5_000) break;
    }
    await step.run("write-heartbeat", () => heartbeat(CHAT_MENTIONS_RETENTION_JOB_ID, { deleted, batches: batch }));
    logger.info("chat.mentions.retention.completed", { module: "chat", deleted, count: batch });
    return { deleted, batches: batch };
  },
);

/** Hourly sample of channel counters; problems are logged for follow-up, never auto-fixed. */
export const chatIntegrityAudit = inngest.createFunction(
  { id: CHAT_INTEGRITY_AUDIT_JOB_ID, retries: 1 },
  { cron: "40 * * * *" },
  async ({ step }) => {
    const problems = await step.run("audit", () => auditChatIntegrity(200));
    if (problems.length) logger.error("chat.integrity.audit.problems", { module: "chat", count: problems.length, errors: problems.slice(0, 20) });
    await step.run("write-heartbeat", () => heartbeat(CHAT_INTEGRITY_AUDIT_JOB_ID, { problems: problems.length }));
    return { problems: problems.length };
  },
);

/**
 * Scheduled messages whose time has come, and "Remind me" reminders. Woken when one falls due; the hourly run catches a
 * lost wake and starts a run for everything due before the next one.
 */
export const chatDue = inngest.createFunction(
  { id: CHAT_DUE_JOB_ID, retries: 1, concurrency: { limit: 1 } },
  [{ event: "chat/due.wake" }, { cron: "15 * * * *" }],
  async ({ step }) => {
    const scheduled = await step.run("send-scheduled", () => sendDueScheduledMessages());
    const reminders = await step.run("fire-reminders", () => fireDueReminders());
    await step.run("arm-next-hour", async () => {
      const times = await dueTimesWithinNextHour();
      await Promise.all(times.map((at) => wakeAt("chat/due.wake", at)));
      return { armed: times.length };
    });
    if (scheduled.due || reminders.reminders) logger.info("chat.due.completed", { module: "chat", count: scheduled.sent + reminders.reminders });
    return { ...scheduled, ...reminders };
  },
);

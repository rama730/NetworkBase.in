import { db } from "@/lib/db";
import { jobHeartbeats } from "@/lib/db/schema";
import { logger } from "@/lib/logger";
import { auditChatIntegrity, purgeOldChatMentions } from "@/lib/messaging/maintenance";

import { inngest } from "../client";

export const CHAT_MENTIONS_RETENTION_JOB_ID = "chat-mentions-retention";
export const CHAT_INTEGRITY_AUDIT_JOB_ID = "chat-integrity-audit";

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

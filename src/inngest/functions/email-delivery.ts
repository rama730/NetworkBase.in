import { inngest } from "@/inngest/client";
import { drainEmailOutbox } from "@/lib/email/delivery";
import { db } from "@/lib/db";
import { jobHeartbeats } from "@/lib/db/schema";

export const emailDelivery = inngest.createFunction(
  { id: "email-outbox-delivery", name: "Transactional Email Delivery", concurrency: { limit: 1 }, retries: 2 },
  [{ event: "email/outbox.wake" }, { cron: "*/5 * * * *" }],
  async ({ step }) => {
    const result = await step.run("drain-email-outbox", drainEmailOutbox);
    await step.run("email-heartbeat", async () => {
      const now = new Date();
      await db.insert(jobHeartbeats).values({ jobId: "email-outbox-delivery", lastSuccessAt: now, lastPayload: result })
        .onConflictDoUpdate({ target: jobHeartbeats.jobId, set: { lastSuccessAt: now, lastPayload: result, updatedAt: now } });
    });
    return result;
  },
);

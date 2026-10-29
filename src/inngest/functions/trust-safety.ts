import { inngest } from "../client";
import { alertUrgentCase, runTrustDailySummary, runTrustDeadlines, runTrustRestrictions, runTrustRetention, runTrustWeeklyHealth } from "@/lib/trust/jobs";
import { deliverDecisionNotices, UNDO_SECONDS } from "@/lib/trust/decide";

// Trust and safety jobs (docs/trust-and-safety-concept.md §15). The worker registers them; after deploy it needs
// one Inngest re-sync.

export const trustUrgentAlert = inngest.createFunction(
  { id: "trust-urgent-alert", retries: 2, idempotency: "event.data.caseId" },
  { event: "trust/urgent.reported" },
  async ({ event, step }) => {
    await step.run("alert", () => alertUrgentCase(event.data.caseId, false));
    await step.sleep("wait-for-claim", "30m");
    await step.run("reminder", () => alertUrgentCase(event.data.caseId, true));
  },
);

/** Notices wait out the Undo window (C8); trust-deadlines delivers anything this misses. */
export const trustDecisionNotices = inngest.createFunction(
  { id: "trust-decision-notices", retries: 2 },
  { event: "trust/decision.made" },
  async ({ event, step }) => {
    await step.sleep("undo-window", `${UNDO_SECONDS + 1}s`);
    await step.run("deliver", () => deliverDecisionNotices(event.data.caseId));
  },
);

export const trustDeadlines = inngest.createFunction(
  { id: "trust-deadlines", retries: 1, concurrency: { limit: 1 } },
  { cron: "*/15 * * * *" },
  ({ step }) => step.run("trust-deadlines", () => runTrustDeadlines()),
);

export const trustRestrictions = inngest.createFunction(
  { id: "trust-restrictions", retries: 1, concurrency: { limit: 1 } },
  { cron: "20 * * * *" },
  ({ step }) => step.run("trust-restrictions", () => runTrustRestrictions()),
);

/** Hourly; each acts only at 8 am IST (the weekly one on Mondays). */
export const trustDailySummary = inngest.createFunction(
  { id: "trust-daily-summary", retries: 1, concurrency: { limit: 1 } },
  { cron: "35 * * * *" },
  async ({ step }) => {
    await step.run("daily", () => runTrustDailySummary());
    await step.run("weekly", () => runTrustWeeklyHealth());
  },
);

export const trustRetention = inngest.createFunction(
  { id: "trust-retention", retries: 1, concurrency: { limit: 1 } },
  { cron: "50 21 * * *" },
  ({ step }) => step.run("trust-retention", () => runTrustRetention()),
);

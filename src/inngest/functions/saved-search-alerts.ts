import { collectDueAlerts, sendAlert, trimSearchLog } from "@/lib/search/global/alerts";
import { inngest } from "../client";

const BATCH = 25;

// Daily (global search mix, round two item 9): new matches for saved searches, 25 to a step so a slow search can't
// stall the run (and steps stay few on the Inngest plan); then the search log trimmed to 30 days.
export const savedSearchAlerts = inngest.createFunction(
  { id: "saved-search-alerts", retries: 1, concurrency: { limit: 1 } },
  { cron: "10 6 * * *" },
  async ({ step }) => {
    const startedAt = await step.run("saved-search-alerts-start", () => new Date().toISOString());
    const due = await step.run("saved-search-alerts-due", () => collectDueAlerts(new Date(startedAt)));
    let sent = 0;
    for (let index = 0; index * BATCH < due.length; index += 1) {
      const batch = due.slice(index * BATCH, (index + 1) * BATCH);
      sent += await step.run(`saved-search-alerts-${index}`, async () => {
        let count = 0;
        for (const alert of batch) if ((await sendAlert(alert, new Date(startedAt))) === "sent") count += 1;
        return count;
      });
    }
    const cleared = await step.run("saved-search-log-trim", () => trimSearchLog(new Date(startedAt)));
    return { due: due.length, sent, cleared };
  },
);

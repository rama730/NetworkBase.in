import { deleteExpiredDownloadEvents } from "@/lib/files/download-history";
import { purgeOrgVerificationDocuments } from "@/lib/organizations/verification-ways";
import { inngest } from "../client";

const MAX_BATCHES = 200;

/** Download history is kept for 90 days; verification documents 30 days after the decision. Small batches, so a large backlog never holds a long lock. */
export const downloadHistoryRetention = inngest.createFunction(
  { id: "download-history-retention", retries: 2, concurrency: 1 },
  { cron: "20 3 * * *" },
  async ({ step }) => {
    let total = 0;
    for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
      const deleted = await step.run(`delete-batch-${batch}`, deleteExpiredDownloadEvents);
      total += deleted;
      if (deleted === 0) break;
    }
    // D4 (org verification): team-review documents go 30 days after the decision. Here, not in a function of its own.
    const documents = await step.run("org-verification-documents", () => purgeOrgVerificationDocuments());
    return { deleted: total, documents };
  },
);

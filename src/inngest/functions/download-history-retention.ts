import { deleteExpiredDownloadEvents } from "@/lib/files/download-history";
import { purgeOrgVerificationDocuments } from "@/lib/organizations/verification-ways";
import { sweepSandboxes } from "@/lib/workspaces/sandbox";
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
    // nb learn's practice workspaces left behind (report C1): nb learn deletes its own at the end, so this daily step
    // only catches abandoned ones. ponytail: daily, so one lives up to 48 hours; an hourly step if that ever matters.
    const sandboxes = await step.run("practice-workspaces", () => sweepSandboxes());
    return { deleted: total, documents, sandboxes };
  },
);

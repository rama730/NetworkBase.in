import { deleteExpiredDownloadEvents } from "@/lib/files/download-history";
import { purgeOrgVerificationDocuments } from "@/lib/organizations/verification-ways";
import { sweepSandboxes } from "@/lib/workspaces/sandbox";
import { discardStaleChangeSets } from "@/lib/domain/change-sets";
import { pruneTextIndex } from "@/lib/domain/change-set-fs";
import { sweepBranches } from "@/lib/domain/branches";
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
    // Change sets untouched for 30 days are discarded (report G19); their content goes 7 days later with the
    // storage cleanup. ponytail: no day-23 reminder yet; add one when notifications get a change-set kind.
    const changeSets = await step.run("stale-change-sets", () => discardStaleChangeSets());
    // The search index's text of content nothing refers to any more (report G14). A step here, not a job per save.
    const textIndex = await step.run("text-index", () => pruneTextIndex());
    // Branches (report H26): merged ones go after 7 days, deleted ones' files after 30, and a 90-day-quiet branch
    // asks its maker once. A step here, not a function of its own (Inngest's free plan).
    const branchSweep = await step.run("branches", () => sweepBranches());
    return { deleted: total, documents, sandboxes, changeSets, textIndex, branches: branchSweep };
  },
);

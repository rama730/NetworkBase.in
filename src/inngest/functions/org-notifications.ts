import { inngest } from "../client";
import { runOrgAdminDigest, runOrgDueSoon } from "@/lib/organizations/org-digests";

// Hourly: each run acts only where it is 9:00 (due soon) or 8:00 (admin digest) locally (report §26.5).
export const orgDueSoon = inngest.createFunction(
  { id: "org-due-soon", retries: 1, concurrency: { limit: 1 } },
  { cron: "5 * * * *" },
  ({ step }) => step.run("org-due-soon", () => runOrgDueSoon()),
);

export const orgAdminDigest = inngest.createFunction(
  { id: "org-admin-digest", retries: 1, concurrency: { limit: 1 } },
  { cron: "10 * * * *" },
  ({ step }) => step.run("org-admin-digest", () => runOrgAdminDigest()),
);

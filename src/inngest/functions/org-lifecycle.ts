import { inngest } from "../client";
import { duplicateOrg, purgeDueOrgs } from "@/lib/organizations/lifecycle";

// Report §30.5: Duplicate in the background; orgs past their 30-day deletion grace are purged daily.
export const orgDuplicate = inngest.createFunction(
  { id: "org-duplicate", retries: 0, concurrency: { limit: 2 } },
  { event: "org/duplicate.requested" },
  ({ event, step }) => step.run("duplicate-org", () => duplicateOrg(event.data.sourceId, event.data.actorId, event.data.options)),
);

export const orgPurge = inngest.createFunction(
  { id: "org-purge", retries: 1, concurrency: { limit: 1 } },
  { cron: "30 3 * * *" },
  ({ step }) => step.run("purge-due-orgs", () => purgeDueOrgs()),
);

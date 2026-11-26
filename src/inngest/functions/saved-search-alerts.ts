import { runSavedSearchAlerts } from "@/lib/search/global/alerts";
import { inngest } from "../client";

// Daily (global search mix, round two item 9): new matches for saved searches, and the search log kept to 30 days.
export const savedSearchAlerts = inngest.createFunction(
  { id: "saved-search-alerts", retries: 1, concurrency: { limit: 1 } },
  { cron: "10 6 * * *" },
  ({ step }) => step.run("saved-search-alerts", () => runSavedSearchAlerts()),
);

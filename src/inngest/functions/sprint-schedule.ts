import { inngest } from "../client";
import { startDueSprints } from "@/lib/workspaces/sprint-schedule";
import { publishDueAssignments } from "@/lib/organizations/assignment-publish";

// Starts are automatic; close-out remains deliberate because it moves work. Scheduled assignments publish here too
// (report §42.5, decision 125).
export const reconcileSprintSchedule = inngest.createFunction(
  { id: "sprint-schedule", retries: 1, concurrency: { limit: 1 } },
  // ponytail: hourly cron instead of per-minute polling. ceiling: sprint start/end lags up to one hour. upgrade: a scheduled event at each sprint boundary if users need exact times.
  { cron: "0 * * * *" },
  async () => ({ ...(await startDueSprints()), ...(await publishDueAssignments()) }),
);

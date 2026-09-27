import { inngest } from "../client";
import { startDueSprints } from "@/lib/projects/sprint-schedule";

// Starts are automatic; close-out remains deliberate because it moves work.
export const reconcileSprintSchedule = inngest.createFunction(
  { id: "sprint-schedule", retries: 1, concurrency: { limit: 1 } },
  // ponytail: sprints transition on hourly/daily boundaries; hourly cron saves 1,416 executions/day
  { cron: "0 * * * *" },
  () => startDueSprints(),
);

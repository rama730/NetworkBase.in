import { runAccountDeletionReminders } from "@/lib/account/deletion-reminders";
import { inngest } from "../client";

// Daily, mid-morning UTC: people with a pending account deletion are reminded 7 days and 1 day before it happens.
export const accountDeletionReminders = inngest.createFunction(
  { id: "account-deletion-reminders", retries: 1, concurrency: { limit: 1 } },
  { cron: "20 9 * * *" },
  ({ step }) => step.run("account-deletion-reminders", () => runAccountDeletionReminders()),
);

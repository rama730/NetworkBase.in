import { sendAgentRenewalNotices } from "@/lib/agents/access-settings";
import { inngest } from "../client";

// Daily: one inbox item per agent sign-in that ends within 7 days (report A5 "Renewal notice").
export const agentAccessRenewal = inngest.createFunction(
  { id: "agent-access-renewal", retries: 1, concurrency: { limit: 1 } },
  { cron: "40 8 * * *" },
  ({ step }) => step.run("agent-access-renewal", () => sendAgentRenewalNotices()),
);

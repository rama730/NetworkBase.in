import { flushAgentSession } from "@/lib/agents/notifications";

import { inngest } from "../client";

/**
 * One summary per agent session (report A11.6): runs once, 15 minutes after the session's last held notification.
 * Event-driven and debounced, so it costs one run per agent session, not a schedule.
 */
export const agentNotificationFlush = inngest.createFunction(
  { id: "agent-notification-flush", retries: 2, debounce: { key: "event.data.sessionId", period: "15m" } },
  { event: "agent/notifications.held" },
  async ({ event, step }) => step.run("flush", () => flushAgentSession(String(event.data.sessionId))),
);

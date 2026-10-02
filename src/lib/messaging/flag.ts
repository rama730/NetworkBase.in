import { isEnabledFlag } from "@/lib/realtime/authorization";

/**
 * Switch between the old messaging system and the Slack-style rebuild.
 * Turn it on only where the database has drizzle/0180 applied.
 */
// ponytail: one env switch, two code paths (L-32). ceiling: lives for one
// release. upgrade: deleted at cutover (plan Phase 5C) with the old system.
export function isChatV3Enabled() {
  return isEnabledFlag(process.env.NEXT_PUBLIC_CHAT_V3);
}

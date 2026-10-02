import { logger } from "@/lib/logger";
import { resolveSupabaseServiceEnv } from "@/lib/supabase/env";

export type ServerBroadcast = {
  topic: string;
  event: string;
  payload: Record<string, unknown>;
};

type Deps = {
  fetch: typeof fetch;
  env: () => { url: string; serviceRoleKey: string };
};

const defaultDeps: Deps = {
  fetch: (input, init) => fetch(input, init),
  env: () => resolveSupabaseServiceEnv("chat.broadcast"),
};

/**
 * Publish private Broadcast messages through the Realtime REST API in one
 * request. Called after the database commit, so the write path never waits on
 * Realtime and the database never writes realtime.messages for chat sends.
 */
// ponytail: best-effort publish after commit (L-1). ceiling: a crash between
// commit and publish loses one live event; clients recover via catch-up on
// reconnect, focus and the bootstrap poll. upgrade: outbox table + relay if
// missing live messages are reported or the failure log exceeds 0.1%.
export async function broadcast(messages: ServerBroadcast[], deps: Deps = defaultDeps): Promise<boolean> {
  if (messages.length === 0) return true;
  try {
    const { url, serviceRoleKey } = deps.env();
    const response = await deps.fetch(`${url}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ messages: messages.map((message) => ({ ...message, private: true })) }),
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) {
      logger.warn("chat.broadcast_failed", { module: "chat", outcome: "failed", status: response.status });
      return false;
    }
    return true;
  } catch (error) {
    logger.warn("chat.broadcast_failed", {
      module: "chat",
      outcome: "failed",
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

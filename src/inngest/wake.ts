import { logger } from "@/lib/logger";

import { inngest } from "./client";

export type WakeEvent = "chat/due.wake" | "notification/push.wake";

type WakeClient = {
  send(event: { name: WakeEvent; data: Record<string, never>; id: string; ts: number }): Promise<unknown>;
};

const MINUTE_MS = 60_000;
const WAKE_TIMEOUT_MS = 1_000;
// Inngest's clock may run ahead of the database's; waking early would find nothing and leave the item for the sweep.
const CLOCK_MARGIN_MS = 5_000;
// Five minutes past the hourly sweep's own hour, so nothing due can fall between two sweeps.
const CHAT_WAKE_HORIZON_MS = 65 * MINUTE_MS;

/** Everything due in one minute shares an event id, which Inngest dedupes, so a burst starts one run. */
export function wakeEvent<Name extends WakeEvent>(name: Name, at: Date) {
  const minute = Math.ceil(at.getTime() / MINUTE_MS) * MINUTE_MS;
  return { name, data: {} as Record<string, never>, id: `${name}:${minute}`, ts: minute + CLOCK_MARGIN_MS };
}

/**
 * Start a job at a time instead of polling for it. A wake is only a hint: the work is already saved, so a failed or
 * slow wake is logged and the job's hourly sweep picks it up. It can never fail or hold up the caller.
 */
export async function wakeAt(name: WakeEvent, at: Date, client: WakeClient = inngest as unknown as WakeClient) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      client.send(wakeEvent(name, at)),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("wake_timeout")), WAKE_TIMEOUT_MS);
      }),
    ]);
  } catch {
    logger.warn("inngest.wake_failed", { module: "inngest", event: name, reason: "hourly_sweep_will_retry" });
  } finally {
    clearTimeout(timer);
  }
}

/** Inngest limits how far ahead an event can start on the free plan, so only the near future gets one. */
export async function wakeChatDueIfSoon(at: Date, now = new Date(), client?: WakeClient) {
  if (at.getTime() - now.getTime() > CHAT_WAKE_HORIZON_MS) return;
  await wakeAt("chat/due.wake", at, client);
}

/** A minute ahead, so the transaction creating the notification has committed by the time the job reads it. */
export async function wakePushIfNeeded(
  notification: { importance: string; delayUntil: Date | null },
  now = new Date(),
  client?: WakeClient,
) {
  if (notification.importance !== "important" || notification.delayUntil) return;
  await wakeAt("notification/push.wake", new Date(now.getTime() + MINUTE_MS), client);
}

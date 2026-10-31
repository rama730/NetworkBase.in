import { logger } from "@/lib/logger";

import { inngest } from "@/inngest/client";

export type WakeEvent = "chat/due.wake" | "notification/push.wake";

type HintEvent = { name: WakeEvent | "email/outbox.wake"; data: Record<string, never>; id?: string; ts?: number };

type WakeClient = {
  send(event: HintEvent): Promise<unknown>;
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
 * A hint to a job that its work is ready: the work is already saved and the job's timer picks it up anyway, so this can
 * never fail or hold up the caller. A slow answer is not a failure, because the send carries on after we stop waiting.
 * A refusal is, and it reports the reason: a rejected event key once went unnoticed for days behind a quiet warning.
 */
export async function sendHint(event: HintEvent, client: WakeClient = inngest as unknown as WakeClient) {
  const sending = client.send(event).catch((error: unknown) => {
    logger.error("inngest.wake_failed", { module: "inngest", event: event.name, error });
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([sending, new Promise((resolve) => { timer = setTimeout(resolve, WAKE_TIMEOUT_MS); })]);
  clearTimeout(timer);
}

/** Start a job at a time instead of polling for it. */
export async function wakeAt(name: WakeEvent, at: Date, client?: WakeClient) {
  await sendHint(wakeEvent(name, at), client);
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

// One rule for Schedule, Reschedule and Remind me: a time in the future, at most 120 days ahead.
export const SCHEDULE_MAX_AHEAD_MS = 120 * 24 * 60 * 60 * 1000;

export type ScheduleWindow = { ok: true; at: string } | { ok: false; reason: "invalid" | "past" | "too_far" };

export function scheduleWindow(value: unknown, now = Date.now()): ScheduleWindow {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return { ok: false, reason: "invalid" };
  const at = Date.parse(value);
  if (at <= now) return { ok: false, reason: "past" };
  if (at - now > SCHEDULE_MAX_AHEAD_MS) return { ok: false, reason: "too_far" };
  return { ok: true, at: new Date(at).toISOString() };
}

/** The scheduled list reloads a few seconds after its next message is due (it left the list), never sooner than 5 s. */
export function scheduledRefetchMs(items: { send_at: string; failed_reason?: string | null }[], now = Date.now()): number | false {
  // A failed one stays in the list until you deal with it: nothing to wait for.
  const waiting = items.filter((item) => !item.failed_reason);
  if (!waiting.length) return false;
  const next = Math.min(...waiting.map((item) => Date.parse(item.send_at)));
  return Math.max(5_000, next - now + 5_000);
}

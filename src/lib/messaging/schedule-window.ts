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

import { zonedInstant, zonedParts } from "@/lib/workflows/request-clock";

// Report 35.4 (plan B6.4b, R3 calls 6–7): the reading group's slots and rotation. Pure and client-safe.

const DAY = 86_400_000;

/** The next `n` weekly slots at or after `from`, as instants, from the weekday and time in the lab's zone. */
export function nextSlots(weekday: number, time: string, tz: string, from: Date, n: number) {
  const out: string[] = [];
  const today = zonedParts(from, tz).day;
  for (let i = 0; out.length < n && i < 7 * n + 7; i++) {
    const day = new Date(Date.parse(`${today}T00:00:00Z`) + i * DAY).toISOString().slice(0, 10);
    if (new Date(`${day}T00:00:00Z`).getUTCDay() !== weekday) continue;
    const at = zonedInstant(day, time, tz);
    if (at.getTime() >= from.getTime()) out.push(at.toISOString());
  }
  return out;
}

/** Call 6: the next presenter after `last` in the order, skipping anyone `away` that day; null when everyone is. */
export function nextPresenter(order: string[], last: string | null, away: (id: string) => boolean) {
  if (!order.length) return null;
  const start = last && order.includes(last) ? order.indexOf(last) + 1 : 0;
  for (let i = 0; i < order.length; i++) {
    const id = order[(start + i) % order.length]!;
    if (!away(id)) return id;
  }
  return null;
}

/** Call 7: the presenter picks the paper this many days before. */
export const pickBy = (startsAt: string, pickDays: number) => new Date(Date.parse(startsAt) - pickDays * DAY).toISOString();

export type SessionState = "done" | "picked" | "waiting";
export const SESSION_WORDS: Record<SessionState, string> = { done: "Done", picked: "Paper picked", waiting: "Waiting for a paper" };
export const sessionState = (s: { doneAt: string | null; sourceId: string | null }): SessionState => (s.doneAt ? "done" : s.sourceId ? "picked" : "waiting");

/** Notices due now for an open session (layer 15): next presenter 7 days before, pick by tomorrow, late to the PI. */
export function noticesDue(s: { startsAt: string; sourceId: string | null; nextNoticeAt: string | null; pickNoticeAt: string | null; lateNoticeAt: string | null }, pickDays: number, now: Date) {
  const t = now.getTime();
  const starts = Date.parse(s.startsAt);
  const by = Date.parse(pickBy(s.startsAt, pickDays));
  return {
    next: !s.nextNoticeAt && t >= starts - 7 * DAY && t < starts,
    pickTomorrow: !s.sourceId && !s.pickNoticeAt && t >= by - DAY && t < by,
    late: !s.sourceId && !s.lateNoticeAt && t >= by && t < starts,
  };
}

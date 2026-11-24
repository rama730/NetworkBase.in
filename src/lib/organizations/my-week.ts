import { addDaysToDay, dayText, isoToZonedInput, relativeDay, todayInZone } from "@/lib/organizations/zoned-time";

/**
 * Report 30.4 W3 (plan B1.7): the student's week, pure. Days run down the page — Today, Tomorrow, then the rest of the
 * next seven days — built only from rows that already exist; at most 8 rows a day, then "+N more" (layer 12).
 */
export type WeekItemKind = "session" | "prep" | "copy" | "task" | "office" | "teaching" | "review";
export type WeekItem = {
  id: string;
  kind: WeekItemKind;
  /** When it happens or is due, ISO. */
  at: string;
  title: string;
  /** "CS 301 · LH-2 204", "your team", … */
  context: string | null;
  href: string | null;
  /** Cancelled, Moved, Not started, Late, Required… in words. */
  status: string | null;
  /** A pinned task's id (tasks and copies only). */
  taskId?: string | null;
};
export type WeekDay = { day: string; label: string; items: WeekItem[]; more: number };

export const DAY_LIMIT = 8;
/** "Today" · "Tomorrow" · "Thu 19 Feb". */
export const dayLabel = (day: string, today: string) => (day === today ? "Today" : day === addDaysToDay(today, 1) ? "Tomorrow" : dayText(day));

/** Group the items by the viewer's day, seven days from today; anything outside is left out. Times sort within a day. */
export function groupWeek(items: WeekItem[], timeZone: string | null, now = new Date()): WeekDay[] {
  const today = todayInZone(timeZone, now);
  const days: WeekDay[] = Array.from({ length: 7 }, (_, i) => ({ day: addDaysToDay(today, i), label: dayLabel(addDaysToDay(today, i), today), items: [], more: 0 }));
  const byDay = new Map(days.map((d) => [d.day, d]));
  for (const item of [...items].sort((a, b) => a.at.localeCompare(b.at))) {
    const d = byDay.get(isoToZonedInput(item.at, timeZone).slice(0, 10));
    if (!d) continue;
    if (d.items.length < DAY_LIMIT) d.items.push(item);
    else d.more += 1;
  }
  return days;
}

/** Pin for today (call 4): up to 3, private, and only today's pins count — yesterday's clear themselves at midnight. */
export const PIN_LIMIT = 3;
export const pinsForToday = (pins: Array<{ taskId: string; day: string }>, timeZone: string | null, now = new Date()) => {
  const today = todayInZone(timeZone, now);
  return pins.filter((p) => p.day === today).map((p) => p.taskId).slice(0, PIN_LIMIT);
};

/** The exam strip (layer 6): the nearest exam within 14 days — "in 9 days", "Tomorrow", "Today". */
export function examStrip(exams: Array<{ id: string; title: string; context: string; opensAt: string; href: string }>, timeZone: string | null, now = new Date()) {
  const today = todayInZone(timeZone, now);
  const next = exams.filter((e) => Date.parse(e.opensAt) >= now.getTime() - 3 * 3_600_000).sort((a, b) => a.opensAt.localeCompare(b.opensAt))[0];
  if (!next) return null;
  const days = Math.round((Date.parse(`${isoToZonedInput(next.opensAt, timeZone).slice(0, 10)}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (days > 14) return null;
  const when = relativeDay(days);
  return { ...next, when: when.charAt(0).toUpperCase() + when.slice(1) };
}

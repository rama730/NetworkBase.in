import { taskDueDateKey } from "@/lib/workspaces/task-presentation";

/**
 * Report 38.5 T1 part 7 (plan A1.1): the Calendar's grid (the shared B2 part; Content and Meetings reuse it). Days are
 * calendar keys (YYYY-MM-DD); a due date is a calendar day stored at UTC midnight, so it never moves with time zones.
 */
export type CalendarItem = { id: string; dueDate?: string | null };
export type CalendarDay<T> = { key: string; day: number; inMonth: boolean; weekend: boolean; isToday: boolean; items: T[]; more: number };

const addDays = (key: string, n: number) => new Date(Date.parse(`${key}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const weekday = (key: string) => (new Date(`${key}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday 0 … Sunday 6
export const mondayOf = (key: string) => addDays(key, -weekday(key));
export const monthOf = (key: string) => key.slice(0, 7);
export const shiftMonth = (month: string, n: number) => {
  const d = new Date(`${month}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 7);
};

function byDay<T extends CalendarItem>(items: T[]) {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = taskDueDateKey(item.dueDate);
    if (key) map.set(key, [...(map.get(key) ?? []), item]);
  }
  return map;
}

function day<T>(key: string, month: string | null, today: string, items: T[], max: number): CalendarDay<T> {
  const w = weekday(key);
  return { key, day: Number(key.slice(8)), inMonth: month === null || monthOf(key) === month, weekend: w >= 5, isToday: key === today, items: items.slice(0, max), more: Math.max(0, items.length - max) };
}

/** Month view: whole weeks from the Monday on or before the 1st to the Sunday on or after the last day. */
export function calendarCells<T extends CalendarItem>(month: string, items: T[], today: string, max = 3) {
  const first = mondayOf(`${month}-01`);
  const last = addDays(`${shiftMonth(month, 1)}-01`, -1);
  const map = byDay(items);
  const weeks: CalendarDay<T>[][] = [];
  for (let start = first; start <= last; start = addDays(start, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => { const key = addDays(start, i); return day(key, month, today, map.get(key) ?? [], max); }));
  }
  return weeks;
}

/** Week view: seven columns from Monday, same rules, more room per day. */
export function weekCells<T extends CalendarItem>(weekStart: string, items: T[], today: string, max = 12) {
  const map = byDay(items);
  return Array.from({ length: 7 }, (_, i) => { const key = addDays(weekStart, i); return day(key, null, today, map.get(key) ?? [], max); });
}

/** Phone agenda (W10): the days in range that have items, in order. */
export function agendaDays<T extends CalendarItem>(from: string, to: string, items: T[]) {
  const map = byDay(items);
  return [...map.keys()].filter((k) => k >= from && k <= to).sort().map((key) => ({ key, items: map.get(key)! }));
}

/** The first and last day a month grid shows, for reading its items. */
export function monthRange(month: string) {
  const weeks = calendarCells(month, [], "");
  return { from: weeks[0]![0]!.key, to: weeks.at(-1)!.at(-1)!.key };
}

/** Moving an item to another day keeps the time of day it was stored with (UTC midnight for date-only). */
export const dueOn = (key: string) => `${key}T00:00:00.000Z`;

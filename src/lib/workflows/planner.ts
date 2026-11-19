import { taskDueDateKey } from "@/lib/workspaces/task-presentation";

/**
 * Report 38.5 T1 part 7 (plan A1.1): the Calendar's grid (the shared B2 part; Content and Meetings reuse it). Days are
 * calendar keys (YYYY-MM-DD); a due date is a calendar day stored at UTC midnight, so it never moves with time zones.
 */
export type CalendarItem = { id: string; dueDate?: string | null; startDate?: string | null };
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
    if (!key) continue;
    // Call 8 (A1.4): an item with a start spans its days (capped at a year); others sit on their due day.
    const from = taskDueDateKey(item.startDate);
    const span = from && from < key ? Math.min(366, Math.round((Date.parse(`${key}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)) : 0;
    for (let i = span; i >= 0; i--) {
      const d = addDays(key, -i);
      map.set(d, [...(map.get(d) ?? []), item]);
    }
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

/**
 * Report 11.7 and 38.5 T1 part 7 (plan A1.2): the Matrix. Important = High or Urgent priority; urgent = due within
 * `urgentDays` days or overdue (a calendar day); no date is never urgent. Done items and projects sit in no box.
 */
export type MatrixBox = "do" | "schedule" | "delegate" | "drop";
export const MATRIX_BOXES: Array<{ id: MatrixBox; name: string; important: boolean; urgent: boolean }> = [
  { id: "do", name: "Do first", important: true, urgent: true },
  { id: "schedule", name: "Schedule", important: true, urgent: false },
  { id: "delegate", name: "Delegate", important: false, urgent: true },
  { id: "drop", name: "Drop", important: false, urgent: false },
];
type MatrixTask = { status: string; priority?: string | null; dueDate?: string | null; itemType?: string };

export function matrixBox(task: MatrixTask, today: string, urgentDays = 3): MatrixBox | null {
  if (task.status === "done" || task.itemType === "project") return null;
  const important = task.priority === "high" || task.priority === "urgent";
  const due = taskDueDateKey(task.dueDate);
  const urgent = due !== null && due <= addDays(today, urgentDays);
  return MATRIX_BOXES.find((b) => b.important === important && b.urgent === urgent)!.id;
}

/** Inside a box: soonest due first (no date last), then the higher priority. */
export function matrixOrder<T extends MatrixTask>(tasks: T[]) {
  const rank = (p?: string | null) => ["urgent", "high", "medium", "low"].indexOf(p ?? "medium");
  return [...tasks].sort((a, b) => (taskDueDateKey(a.dueDate) ?? "9999").localeCompare(taskDueDateKey(b.dueDate) ?? "9999") || rank(a.priority) - rank(b.priority));
}

/**
 * What moving a task from one box to another changes (11.7 part 5): up or down sets priority (High / Medium); into the
 * urgent column needs a due date (the picker); out of it, the date is cleared or pushed past the urgent window.
 */
export function matrixMove(from: MatrixBox, to: MatrixBox) {
  const a = MATRIX_BOXES.find((b) => b.id === from)!;
  const b = MATRIX_BOXES.find((x) => x.id === to)!;
  return {
    priority: a.important === b.important ? null : b.important ? "high" : "medium",
    due: a.urgent === b.urgent ? null : b.urgent ? ("pick" as const) : ("clear-or-push" as const),
  };
}

/** The date picker's quick choices and "push" for leaving the urgent column. */
export const urgentChoices = (today: string) => [
  { label: "Today", key: today }, { label: "Tomorrow", key: addDays(today, 1) }, { label: "In 3 days", key: addDays(today, 3) },
];
export const pushedPast = (today: string, urgentDays = 3) => addDays(today, urgentDays + 4);

/**
 * Report 38.5 T1 part 7 (plan A1.3): a project's completion. Completed work ÷ all work, cancelled ignored; with no work,
 * its subtasks; a hand-set number wins.
 */
export function completion(work: Array<{ status: string; stage?: string | null }>, subtasks: { done: number; total: number }, override: number | null) {
  if (override !== null && override !== undefined) return { percent: Math.max(0, Math.min(100, Math.round(override))), source: "hand" as const };
  const counted = work.filter((w) => w.stage !== "cancelled");
  if (counted.length) return { percent: Math.round((100 * counted.filter((w) => w.status === "done").length) / counted.length), source: "work" as const };
  if (subtasks.total) return { percent: Math.round((100 * subtasks.done) / subtasks.total), source: "subtasks" as const };
  return { percent: 0, source: "none" as const };
}

/** Part of: work goes into projects; projects don't nest in this release. */
export const canBePartOf = (type: string) => type !== "project";
export const canBeParent = (type: string) => type === "project";

/**
 * Report 38.5 S3 and part 7 (plan A1.4): the Timeline. Month shows ±2 months around today, Week ±3 weeks from this
 * Monday, Quarter ±6 months. Bars are measured in days from the range start.
 */
export type Zoom = "week" | "month" | "quarter";
export const ZOOM_DAY_PX: Record<Zoom, number> = { week: 40, month: 18, quarter: 6 };
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
export { addDays as addDayKeys };

export function timelineRange(zoom: Zoom, today: string) {
  const monday = mondayOf(today);
  const n = zoom === "month" ? 2 : 6;
  const start = zoom === "week" ? addDays(monday, -21) : `${shiftMonth(monthOf(today), -n)}-01`;
  const end = zoom === "week" ? addDays(monday, 27) : addDays(`${shiftMonth(monthOf(today), n + 1)}-01`, -1);
  return { start, end, days: daysBetween(start, end) + 1 };
}
export type TimelineRange = ReturnType<typeof timelineRange>;

/** Where a bar sits; out of range it's an edge marker ("‹ Mar 12"); one day is at least one day wide. */
export type Bar = { left: number; width: number } | { edge: "before" | "after"; date: string };
export function barGeometry(start: string | null, end: string | null, range: TimelineRange): Bar | null {
  const s = start ?? end;
  const e = end ?? start;
  if (!s || !e) return null;
  if (e < range.start) return { edge: "before", date: e };
  if (s > range.end) return { edge: "after", date: s };
  const left = Math.max(0, daysBetween(range.start, s));
  const right = Math.min(range.days - 1, daysBetween(range.start, e));
  return { left, width: Math.max(1, right - left + 1) };
}

export type Dep = { taskId: string; blockedById: string };
/** Blocked projects that start before their blocker ends (ending and starting on the same day is fine). */
export function conflicts(projects: Array<{ id: string; start: string | null; end: string | null }>, deps: Dep[]) {
  const byId = new Map(projects.map((p) => [p.id, p]));
  return deps.flatMap((d) => {
    const blocker = byId.get(d.blockedById);
    const blocked = byId.get(d.taskId);
    return blocker?.end && blocked?.start && blocked.start < blocker.end ? [{ blocker: d.blockedById, blocked: d.taskId }] : [];
  });
}

/** Everything that waits on this project, directly or through others, once each (S7: they move together). */
export function dependentsToShift(id: string, deps: Dep[]) {
  const out: string[] = [];
  const queue = [id];
  while (queue.length) {
    const current = queue.shift()!;
    for (const d of deps) if (d.blockedById === current && d.taskId !== id && !out.includes(d.taskId)) { out.push(d.taskId); queue.push(d.taskId); }
  }
  return out;
}

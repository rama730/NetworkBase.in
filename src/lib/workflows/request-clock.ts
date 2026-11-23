import { z } from "zod";

/**
 * Report 38.7 part 7 (plan A2.5): the response clock counts working minutes in the workspace's time zone. Working
 * hours are one workspace setting (call 2): days (1 = Monday … 7 = Sunday), from and to, and holidays; null means
 * Mon–Fri 09:00–17:00. Wall-clock time counts, so a daylight-saving change never adds or loses an hour.
 */
export const workingHoursSchema = z.object({
  days: z.array(z.number().int().min(1).max(7)).min(1).max(7),
  from: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  to: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  holidays: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(60),
}).strict().refine((h) => h.from < h.to, { message: "From comes before To" });
export type WorkingHours = z.infer<typeof workingHoursSchema>;
export const DEFAULT_HOURS: WorkingHours = { days: [1, 2, 3, 4, 5], from: "09:00", to: "17:00", holidays: [] };

const fmt = new Map<string, Intl.DateTimeFormat>();
function parts(at: Date, tz: string) {
  let f = fmt.get(tz);
  if (!f) { f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }); fmt.set(tz, f); }
  const p = Object.fromEntries(f.formatToParts(at).map((x) => [x.type, x.value]));
  return { y: +p.year!, m: +p.month!, d: +p.day!, h: +p.hour!, min: +p.minute!, s: +p.second! };
}
/** The instant a wall-clock time happens in a zone (the later one when it repeats, the next real one when skipped). */
function wall(y: number, m: number, d: number, h: number, min: number, tz: string) {
  const guess = Date.UTC(y, m - 1, d, h, min);
  const offset = (t: number) => { const p = parts(new Date(t), tz); return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - t; };
  let t = guess - offset(guess);
  t = guess - offset(t);
  return t;
}
const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
const isoDay = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** Each working window [open, close) as instants, day by day from the local day of `from`. */
function* windows(from: Date, hours: WorkingHours, tz: string) {
  const start = parts(from, tz);
  const day = new Date(Date.UTC(start.y, start.m - 1, start.d));
  for (let i = 0; i < 3700; i++) {
    const y = day.getUTCFullYear(), m = day.getUTCMonth() + 1, d = day.getUTCDate();
    const weekday = ((day.getUTCDay() + 6) % 7) + 1;
    if (hours.days.includes(weekday) && !hours.holidays.includes(isoDay(y, m, d))) {
      const f = minutesOf(hours.from), t = minutesOf(hours.to);
      yield [wall(y, m, d, Math.floor(f / 60), f % 60, tz), wall(y, m, d, Math.floor(t / 60), t % 60, tz)] as const;
    }
    day.setUTCDate(day.getUTCDate() + 1);
  }
}

export function workingMinutesBetween(start: Date, end: Date, hours: WorkingHours, tz: string) {
  if (end <= start) return 0;
  let total = 0;
  for (const [open, close] of windows(start, hours, tz)) {
    if (open >= end.getTime()) break;
    total += Math.max(0, Math.min(close, end.getTime()) - Math.max(open, start.getTime()));
  }
  return Math.round(total / 60_000);
}

export function addWorkingMinutes(start: Date, minutes: number, hours: WorkingHours, tz: string) {
  let left = minutes * 60_000;
  for (const [open, close] of windows(start, hours, tz)) {
    const from = Math.max(open, start.getTime());
    if (from >= close) continue;
    if (close - from >= left) return new Date(from + left);
    left -= close - from;
  }
  return new Date(start.getTime() + minutes * 60_000);
}

export type ClockInput = { startedAt: Date; budgetMinutes: number | null; pausedMinutes: number; waitingSince: Date | null; stoppedAt: Date | null; hours: WorkingHours; tz: string };
export type Clock = { state: "running" | "soon" | "breached" | "paused" | "stopped" | "off"; leftMinutes: number; usedMinutes: number };

export function clockState(c: ClockInput & { now: Date }): Clock {
  if (!c.budgetMinutes) return { state: "off", leftMinutes: 0, usedMinutes: 0 };
  const end = c.stoppedAt ?? c.waitingSince ?? c.now;
  const used = Math.max(0, workingMinutesBetween(c.startedAt, end, c.hours, c.tz) - c.pausedMinutes);
  const left = c.budgetMinutes - used;
  const state = c.stoppedAt ? "stopped" : c.waitingSince ? "paused" : left < 0 ? "breached" : used >= c.budgetMinutes * 0.8 ? "soon" : "running";
  return { state, leftMinutes: left, usedMinutes: used };
}

/** When the 80 % and breach warnings go out; none while off, paused or stopped. */
export function reminderTimes(c: ClockInput) {
  if (!c.budgetMinutes || c.waitingSince || c.stoppedAt) return null;
  return {
    soonAt: addWorkingMinutes(c.startedAt, Math.ceil(c.budgetMinutes * 0.8) + c.pausedMinutes, c.hours, c.tz),
    breachAt: addWorkingMinutes(c.startedAt, c.budgetMinutes + c.pausedMinutes, c.hours, c.tz),
  };
}

const span = (min: number) => {
  const m = Math.abs(min);
  const d = Math.floor(m / 480), h = Math.floor((m % 480) / 60), r = m % 60;
  return d ? `${d} d${h ? ` ${h} h` : ""}` : h ? `${h} h${r ? ` ${r} m` : ""}` : `${r} m`;
};
/** S2: the clock as words ("2 h 10 m left", "Breached 40 m ago"); a working day is 8 working hours. */
export function clockText(c: Clock, stoppedWord = "Done") {
  if (c.state === "off") return "";
  if (c.state === "stopped") return `${stoppedWord} in ${span(c.usedMinutes)}`;
  if (c.state === "breached") return `Breached ${span(c.leftMinutes)} ago`;
  return `${c.state === "paused" ? "Paused · " : ""}${span(c.leftMinutes)} left`;
}

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
/** W1.2: "Mon–Fri 09:00–17:00 (Asia/Kolkata)"; runs of days are joined with a dash. */
export function hoursLine(h: WorkingHours, tz: string) {
  const days = [...h.days].sort((a, b) => a - b);
  const runs: string[] = [];
  for (let i = 0; i < days.length;) {
    let j = i;
    while (j + 1 < days.length && days[j + 1] === days[j]! + 1) j++;
    runs.push(j - i >= 2 ? `${DAY_NAMES[days[i]! - 1]}–${DAY_NAMES[days[j]! - 1]}` : days.slice(i, j + 1).map((d) => DAY_NAMES[d - 1]).join(", "));
    i = j + 1;
  }
  return `${runs.join(", ")} ${h.from}–${h.to} (${tz})${h.holidays.length ? ` · ${h.holidays.length} ${h.holidays.length === 1 ? "holiday" : "holidays"}` : ""}`;
}

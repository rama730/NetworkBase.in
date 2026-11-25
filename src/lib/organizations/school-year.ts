import { z } from "zod";

/**
 * Report 32.2 S1 (plan B3.1a): a school's year, pure. Terms are named date ranges; Holiday, Staff day and Half day are
 * date ranges too (exam weeks already exist, B1.6d). Days that aren't school days — holidays, staff days, exam weeks,
 * weekends — stop class sessions (call 2); half days don't. Day kinds always show with words.
 */
const DAY = z.string().date();
/** Security review: a year is at most 400 days, so the Year view and repeats stay small. */
export const MAX_YEAR_DAYS = 400;
const range = { name: z.string().trim().min(1).max(60), start: DAY, end: DAY };
export const schoolYearSchema = z.object({
  name: z.string().trim().min(1).max(40),
  terms: z.array(z.object(range)).min(1).max(6),
  days: z.array(z.object({ ...range, kind: z.enum(["holiday", "staff", "half"]) })).max(80).default([]),
  weekStart: z.enum(["mon", "sun"]).default("mon"),
}).strict().superRefine((y, ctx) => {
  for (const r of [...y.terms, ...y.days]) if (r.end < r.start) ctx.addIssue({ code: "custom", message: `${r.name} ends before it starts.` });
  const sorted = [...y.terms].sort((a, b) => a.start.localeCompare(b.start));
  for (let i = 1; i < sorted.length; i++) if (sorted[i]!.start <= sorted[i - 1]!.end) ctx.addIssue({ code: "custom", message: "Terms can’t overlap." });
  if (!sorted.length) return;
  const first = sorted[0]!.start, last = [...y.terms].sort((a, b) => b.end.localeCompare(a.end))[0]!.end;
  if ((Date.parse(`${last}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / 86_400_000 > MAX_YEAR_DAYS) ctx.addIssue({ code: "custom", message: "A school year is at most 400 days." });
  for (const d of y.days) if (d.start < first || d.end > last) ctx.addIssue({ code: "custom", message: `${d.name} is outside the terms.` });
});
export type SchoolYear = z.infer<typeof schoolYearSchema>;
export type DayKind = "school" | "weekend" | "holiday" | "staff" | "half" | "exam" | "outside";
export const DAY_WORDS: Record<DayKind, string> = { school: "School day", weekend: "Weekend", holiday: "Holiday", staff: "Staff day", half: "Half day", exam: "Exam week", outside: "Not in a term" };

export const readSchoolYear = (orgSettings: unknown): SchoolYear | null => {
  const parsed = schoolYearSchema.safeParse((orgSettings as { schoolYear?: unknown } | null)?.schoolYear);
  return parsed.success ? parsed.data : null;
};

/** What the classes receive: holidays and staff days as breaks (half days keep classes). */
export const schoolBreaks = (year: SchoolYear | null) => (year?.days ?? []).filter((d) => d.kind !== "half").map((d) => ({ name: d.name, start: d.start, end: d.end }));
/** The year's span, which becomes every class's term (Set by the school). */
export const yearSpan = (year: SchoolYear) => ({ start: [...year.terms].sort((a, b) => a.start.localeCompare(b.start))[0]!.start, end: [...year.terms].sort((a, b) => b.end.localeCompare(a.end))[0]!.end });

const weekday = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay();
const inRange = (day: string, r: { start: string; end: string }) => day >= r.start && day <= r.end;
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** One day's kind: the first of exam week, holiday, staff day, half day; weekends; outside the terms. */
export function dayKind(day: string, year: SchoolYear, examWeeks: Array<{ start: string; end: string }> = []): DayKind {
  if (!year.terms.some((t) => inRange(day, t))) return "outside";
  if (weekday(day) === 0 || weekday(day) === 6) return "weekend";
  if (examWeeks.some((e) => inRange(day, e))) return "exam";
  const d = year.days.find((x) => inRange(day, x));
  return d ? d.kind : "school";
}

/** "Term 1 · Week 6 of 15" (weeks counted Monday to Sunday from the term's first week). */
export function termWeek(day: string, year: SchoolYear) {
  const term = year.terms.find((t) => inRange(day, t));
  if (!term) return null;
  const monday = (d: string) => addDays(d, -((weekday(d) + 6) % 7));
  const week = Math.floor((Date.parse(`${monday(day)}T00:00:00Z`) - Date.parse(`${monday(term.start)}T00:00:00Z`)) / (7 * 86_400_000)) + 1;
  const weeks = Math.floor((Date.parse(`${monday(term.end)}T00:00:00Z`) - Date.parse(`${monday(term.start)}T00:00:00Z`)) / (7 * 86_400_000)) + 1;
  return { term: term.name, week, weeks };
}

/** The next holiday from today, with days to go. */
export function nextHoliday(today: string, year: SchoolYear) {
  const h = year.days.filter((d) => d.kind === "holiday" && d.end >= today).sort((a, b) => a.start.localeCompare(b.start))[0];
  if (!h) return null;
  return { name: h.name, start: h.start, days: Math.max(0, Math.round((Date.parse(`${h.start}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000)) };
}

/** The Year view: one row per month from the year's start, each day with its kind. */
export function yearMonths(year: SchoolYear, examWeeks: Array<{ start: string; end: string }> = []) {
  const { start, end } = yearSpan(year);
  const rows: Array<{ month: string; days: Array<{ day: string; kind: DayKind }> }> = [];
  for (let d = `${start.slice(0, 7)}-01`, n = 0; d <= end && n < MAX_YEAR_DAYS + 62; d = addDays(d, 1), n++) {
    const month = d.slice(0, 7);
    if (!rows.length || rows[rows.length - 1]!.month !== month) rows.push({ month, days: [] });
    rows[rows.length - 1]!.days.push({ day: d, kind: dayKind(d, year, examWeeks) });
  }
  return rows;
}

/** This week at school: Monday to Friday's kinds that aren't ordinary school days. */
export function thisWeek(today: string, year: SchoolYear, examWeeks: Array<{ start: string; end: string }> = []) {
  const monday = addDays(today, -((weekday(today) + 6) % 7));
  return [0, 1, 2, 3, 4].map((i) => addDays(monday, i)).map((day) => ({ day, kind: dayKind(day, year, examWeeks) })).filter((d) => d.kind !== "school" && d.kind !== "outside");
}

import { z } from "zod";

/**
 * Report 32.5 S4 calls 1–3 (plan B3.4a): a school's day, pure. Day patterns are periods with times plus break and
 * lunch rows (more than one pattern when days differ, e.g. a short Friday), an optional Week A / B, and timetable
 * slots (day × period → class, teacher, room) imported from a CSV or typed. Days are 1 (Monday) to 7 (Sunday).
 */
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
export const periodSchema = z.object({ key: z.string().trim().min(1).max(20), start: z.string().regex(TIME), end: z.string().regex(TIME), kind: z.enum(["lesson", "break", "lunch"]).default("lesson") })
  .refine((p) => p.end > p.start, "A period ends after it starts.");
export const timetableSettingsSchema = z.object({
  patterns: z.array(z.object({ name: z.string().trim().min(1).max(40), days: z.array(z.number().int().min(1).max(7)).min(1), periods: z.array(periodSchema).min(1).max(16) })).min(1).max(4)
    .refine((ps) => { const seen = ps.flatMap((p) => p.days); return new Set(seen).size === seen.length; }, "Each day follows one pattern."),
  weekAB: z.boolean().default(false),
  /** The Monday of a Week A; every other week from it is Week B. */
  weekAStart: z.string().date().nullable().default(null),
}).strict();
export type TimetableSettings = z.infer<typeof timetableSettingsSchema>;
export const DAY_NAMES = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

export function readTimetableSettings(orgSettings: unknown): TimetableSettings | null {
  const parsed = timetableSettingsSchema.safeParse((orgSettings as { timetable?: unknown } | null)?.timetable);
  return parsed.success ? parsed.data : null;
}

/** Monday = 1 … Sunday = 7 for a YYYY-MM-DD day. */
export const isoDay = (day: string) => ((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
export const patternFor = (day: number, s: TimetableSettings) => s.patterns.find((p) => p.days.includes(day)) ?? null;

/** Week A or B for a date, counted in whole weeks from the Week A Monday; null without Week A / B. */
export function weekLetter(day: string, s: TimetableSettings): "A" | "B" | null {
  if (!s.weekAB || !s.weekAStart) return null;
  const monday = new Date(Date.parse(`${day}T00:00:00Z`) - (isoDay(day) - 1) * 86_400_000).getTime();
  const weeks = Math.round((monday - Date.parse(`${s.weekAStart}T00:00:00Z`)) / (7 * 86_400_000));
  return ((weeks % 2) + 2) % 2 === 0 ? "A" : "B";
}

export type Slot = { id: string; day: number; period: string; week: string | null; className: string; courseId: string | null; teacherId: string | null; teacher?: string | null; room: string | null };

/** One day: the pattern's rows in order, each lesson period with its slots (filtered to that week's letter). */
export function dayView(day: string, slots: Slot[], s: TimetableSettings) {
  const pattern = patternFor(isoDay(day), s);
  if (!pattern) return [];
  const letter = weekLetter(day, s);
  return [...pattern.periods].sort((a, b) => a.start.localeCompare(b.start)).map((p) => ({
    ...p, slots: p.kind === "lesson" ? slots.filter((x) => x.day === isoDay(day) && x.period === p.key && (!x.week || !letter || x.week === letter)) : [],
  }));
}

const DAY_WORDS: Record<string, number> = { mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6, sun: 7, sunday: 7 };
export type ImportSlot = { day: number | null; period: string; week: string | null; className: string; teacher: string; room: string; error: string | null };

/** CSV with a header: day, period, class, teacher, room, week (room and week optional). Errors per row. */
export function parseTimetableCsv(text: string, periodKeys: string[], limit = 3000): ImportSlot[] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const cells = (l: string) => l.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
  const head = cells(lines[0]!).map((h) => h.toLowerCase());
  const at = (r: string[], ...n: string[]) => { const i = head.findIndex((h) => n.includes(h)); return i >= 0 ? r[i] ?? "" : ""; };
  const keys = new Set(periodKeys);
  return lines.slice(1, limit + 1).map((l) => {
    const r = cells(l);
    const dayWord = at(r, "day").toLowerCase();
    const day = /^[1-7]$/.test(dayWord) ? Number(dayWord) : DAY_WORDS[dayWord] ?? null;
    const period = at(r, "period", "lesson").slice(0, 20), className = at(r, "class", "group", "form").slice(0, 40);
    const weekRaw = at(r, "week").toUpperCase(), week = weekRaw === "A" || weekRaw === "B" ? weekRaw : null;
    const teacher = at(r, "teacher", "staff").slice(0, 80), room = at(r, "room").slice(0, 40);
    const error = !day ? "Day isn’t a weekday name" : !period ? "No period" : keys.size && !keys.has(period) ? `No period called ${period} in the school day` : !className ? "No class" : weekRaw && !week ? "Week is A or B" : null;
    return { day, period, week, className, teacher, room, error };
  });
}

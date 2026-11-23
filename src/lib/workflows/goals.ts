import { z } from "zod";

import { goalsBlockLine } from "@/lib/workspaces/doc-live-blocks";

/**
 * Report 38.12 D3 (plan A5.1): quarterly goals. One goals document per period holds objectives and their key results
 * (tasks that never go on the board); key results are checked in with a value and a confidence, and their pace says On
 * track, At risk or Off track. Periods are labelled '2027-Q1', '2027-H1', '2027-08' or '2027' (the year the period's
 * year starts, so with a year from April, Jan 2028 is '2027-Q4').
 */
export type GoalSettings = { period?: "quarter" | "month" | "half" | "year"; firstMonth?: number; checkInDay?: number; bands?: { atRisk: number; offTrack: number } };
export type Direction = "increase" | "decrease";
export type GoalStatus = "on_track" | "at_risk" | "off_track";
export const STATUS_WORD: Record<GoalStatus | "done" | "missed", string> = { on_track: "On track", at_risk: "At risk", off_track: "Off track", done: "Done", missed: "Missed" };

export function goalSettings(raw: unknown): Required<GoalSettings> {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const bands = r.bands as { atRisk?: unknown; offTrack?: unknown } | undefined;
  const int = (v: unknown, lo: number, hi: number, d: number) => (Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi ? (v as number) : d);
  return {
    period: (["quarter", "month", "half", "year"] as const).includes(r.period as "quarter") ? (r.period as "quarter") : "quarter",
    firstMonth: int(r.firstMonth, 1, 12, 1), checkInDay: int(r.checkInDay, 1, 7, 1),
    bands: { atRisk: int(bands?.atRisk, 1, 100, 10), offTrack: int(bands?.offTrack, 1, 100, 25) },
  };
}

/** 0–100, floored; a key result whose target equals its start is 100 once met. */
export function krProgress(kr: { start: number; target: number; current: number | null; direction: Direction }) {
  if (kr.current == null || !Number.isFinite(kr.current)) return 0;
  const up = kr.direction === "increase";
  if (kr.target === kr.start) return (up ? kr.current >= kr.target : kr.current <= kr.target) ? 100 : 0;
  const p = up ? (kr.current - kr.start) / (kr.target - kr.start) : (kr.start - kr.current) / (kr.start - kr.target);
  return Math.max(0, Math.min(100, Math.floor(p * 100 + 1e-9)));
}

const ym = (y: number, m0: number) => `${y + Math.floor(m0 / 12)}-${String((m0 % 12) + 1).padStart(2, "0")}-01`;

/** The period a day falls in. */
export function periodOf(day: string, raw: GoalSettings) {
  const s = goalSettings(raw);
  const [y, m] = day.split("-").map(Number) as [number, number];
  if (s.period === "month") return day.slice(0, 7);
  const since = (m - s.firstMonth + 12) % 12;
  const year = m >= s.firstMonth ? y : y - 1;
  if (s.period === "year") return String(year);
  if (s.period === "half") return `${year}-H${Math.floor(since / 6) + 1}`;
  return `${year}-Q${Math.floor(since / 3) + 1}`;
}

/** First day and the day after the last (YYYY-MM-DD). */
export function periodRange(period: string, raw: GoalSettings) {
  const s = goalSettings(raw);
  const month = /^(\d{4})-(\d{2})$/.exec(period);
  if (month) { const y = Number(month[1]), m0 = Number(month[2]) - 1; return { start: ym(y, m0), end: ym(y, m0 + 1) }; }
  const m = /^(\d{4})(?:-([QH])(\d))?$/.exec(period);
  if (!m) throw new Error(`Unknown period "${period}"`);
  const y = Number(m[1]);
  const span = m[2] === "Q" ? 3 : m[2] === "H" ? 6 : 12;
  const from = s.firstMonth - 1 + (m[3] ? (Number(m[3]) - 1) * span : 0);
  return { start: ym(y, from), end: ym(y, from + span) };
}

export function nextPeriod(period: string, raw: GoalSettings) {
  const { end } = periodRange(period, raw);
  return periodOf(end, { ...goalSettings(raw), period: /^\d{4}-\d{2}$/.test(period) ? "month" : /-H/.test(period) ? "half" : /-Q/.test(period) ? "quarter" : "year" });
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Q1 2027", "H2 2027", "Aug 2027", "2027". */
export function periodLabel(period: string) {
  const month = /^(\d{4})-(\d{2})$/.exec(period);
  if (month) return `${MONTHS[Number(month[2]) - 1]} ${month[1]}`;
  const m = /^(\d{4})-([QH]\d)$/.exec(period);
  return m ? `${m[2]} ${m[1]}` : period;
}

const at = (day: string) => Date.parse(`${day}T00:00:00Z`);
/** Where progress should be on a straight line through the period, 0–100. */
export const expectedPace = (start: string, end: string, now: Date) =>
  Math.max(0, Math.min(100, Math.floor(((now.getTime() - at(start)) / (at(end) - at(start))) * 100)));

/** W5: On track within `atRisk` points of pace, At risk within `offTrack`, else Off track. */
export function goalStatus(progress: number, pace: number, bands = { atRisk: 10, offTrack: 25 }): GoalStatus {
  if (progress >= pace - bands.atRisk) return "on_track";
  return progress >= pace - bands.offTrack ? "at_risk" : "off_track";
}

export const objectiveProgress = (krs: number[]) => (krs.length ? Math.floor(krs.reduce((a, b) => a + b, 0) / krs.length) : 0);
export const closeResult = (progress: number): "done" | "missed" => (progress >= 100 ? "done" : "missed");

/** S1 header: "week 7 of 13". */
export function weekOf(start: string, end: string, now: Date) {
  const weeks = Math.ceil((at(end) - at(start)) / (7 * 86_400_000));
  const week = Math.min(weeks, Math.max(1, Math.floor((now.getTime() - at(start)) / (7 * 86_400_000)) + 1));
  return `week ${week} of ${weeks}`;
}


const PERIOD = /^\d{4}(-(Q[1-4]|H[12]|(0[1-9]|1[0-2])))?$/;
/** Objective type_fields (A5.1): its period, and a status set by hand with a reason until the next check-in (W5). */
export const objectiveFieldsSchema = z.object({
  period: z.string().regex(PERIOD, "Pick a period"),
  statusOverride: z.object({ status: z.enum(["on_track", "at_risk", "off_track"]), reason: z.string().trim().min(1).max(200) }).nullish(),
}).strict();
/** Key result type_fields (A5.1a: measured by check-ins; A5.1b adds the linked kinds). */
export const keyResultFieldsSchema = z.object({
  period: z.string().regex(PERIOD).optional(),
  direction: z.enum(["increase", "decrease"]).default("increase"),
  unit: z.string().trim().max(20).default(""),
  start: z.number().finite(),
  target: z.number().finite(),
  current: z.number().finite().nullish(),
  confidence: z.number().int().min(1).max(10).nullish(),
  checkedInAt: z.string().nullish(),
  statusOverride: z.object({ status: z.enum(["on_track", "at_risk", "off_track"]), reason: z.string().trim().min(1).max(200) }).nullish(),
}).strict();

/** W1: "Goals · Q1 2027": a short guide (from the OKRs reference) and the period's goals block. */
export const goalsMarkdown = (period: string) =>
  `# Goals · ${periodLabel(period)}\n\n_An objective is a direction; its key results are numbers that prove you got there. Aim for 2–4 key results each, and check in every week._\n\n${goalsBlockLine(period)}\n`;

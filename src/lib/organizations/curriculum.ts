/**
 * Report 32.3 S2 (plan B3.2): curriculum, pure. A course (a class org in a school) teaches several classes (6A, 6B,
 * 6C) from one plan: Ready is shared, Taught is ticked per class (call 4), and a lesson is Taught once every class
 * has it. Lessons have a type (call 3); Behind the map is per class, never a ranking of teachers (call 8).
 */
export const LESSON_TYPES = { lesson: "Lesson", assessment: "Assessment", activity: "Activity" } as const;
export type LessonType = keyof typeof LESSON_TYPES;
export const lessonTypeOf = (fields: unknown): LessonType => {
  const t = (fields as { lessonType?: unknown } | null)?.lessonType;
  return t === "assessment" || t === "activity" ? t : "lesson";
};

/** The classes a course teaches (Settings → Term plan): short names, at most 12, no repeats. */
export function readGroups(orgSettings: unknown): string[] {
  const raw = (orgSettings as { termPlan?: { groups?: unknown } } | null)?.termPlan?.groups;
  const out: string[] = [];
  for (const g of Array.isArray(raw) ? raw : []) {
    const name = typeof g === "string" ? g.trim().slice(0, 20) : "";
    if (name && !out.includes(name)) out.push(name);
  }
  return out.slice(0, 12);
}

export type Ticks = Record<string, { on: string; by: string }>;
export const readTicks = (fields: unknown): Ticks => {
  const raw = (fields as { taught?: unknown } | null)?.taught;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter(([, v]) => v && typeof (v as { on?: unknown }).on === "string")) as Ticks;
};
export const readClassNotes = (fields: unknown): Record<string, string> => {
  const raw = (fields as { classNotes?: unknown } | null)?.classNotes;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter(([, v]) => typeof v === "string" && v.trim()).map(([k, v]) => [k, (v as string).slice(0, 200)]));
};

/** A lesson is Taught when every class the course teaches has it ticked (with no classes, its own stage decides). */
export const allTaught = (groups: string[], ticks: Ticks) => groups.length > 0 && groups.every((g) => ticks[g]);

type MapLesson = { stage: string; day: string | null; ticks: Ticks };
/**
 * Behind the map for one class: lessons planned by today (their day has come) minus those it has taught (its tick,
 * or the whole lesson Taught). Cancelled lessons don't count. Two or more behind shows ⚠ (layer 6).
 */
export function behind(lessons: MapLesson[], group: string, today: string) {
  const due = lessons.filter((l) => l.stage !== "cancelled" && l.day && l.day <= today);
  // Found live (B3.2a): a lesson Taught as a whole (before the course listed its classes) is taught for every class.
  const taught = due.filter((l) => l.stage === "taught" || l.ticks[group]).length;
  return { due: due.length, taught, behind: due.length - taught, warn: due.length - taught >= 2 };
}

/** Planned: lessons that are Ready or Taught ÷ lessons that aren't cancelled. */
export function plannedPercent(lessons: Array<{ stage: string }>) {
  const live = lessons.filter((l) => l.stage !== "cancelled");
  const ready = live.filter((l) => l.stage === "ready" || l.stage === "taught").length;
  return { ready, total: live.length, percent: live.length ? Math.round((ready / live.length) * 100) : 0 };
}

/** Draft ⚠: a Draft lesson whose day is within the next 3 school days (weekends don't count). */
export function draftSoon(stage: string, day: string | null, today: string) {
  if (stage !== "draft" || !day || day < today) return false;
  let schoolDays = 0;
  for (let d = today; d < day; d = new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)) {
    const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (wd !== 0 && wd !== 6) schoolDays += 1;
    if (schoolDays > 3) return false;
  }
  return schoolDays <= 3;
}

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const mondayOf = (d: string) => addDays(d, -((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7));

/** B3.2b (report 32.3 Year map): the school's weeks, Monday to Monday, across the year's span (at most 60). */
export function mapWeeks(start: string, end: string) {
  const out: string[] = [];
  for (let d = mondayOf(start); d <= end && out.length < 60; d = addDays(d, 7)) out.push(d);
  return out;
}

export type MapUnit = { name: string; start: string | null; end: string | null; draft: boolean; assessment: boolean };
export type MapSegment = { kind: "gap"; span: number } | { kind: "unit"; span: number; name: string; draft: boolean; assessment: boolean; from: string; to: string };
/**
 * One course's row: its units as spans over the school weeks (a unit takes the weeks its dates touch; a later unit
 * that overlaps starts after the earlier one), gaps between them. Undated units aren't drawn.
 */
export function mapRow(units: MapUnit[], weeks: string[]): MapSegment[] {
  const index = (d: string, last: boolean) => {
    const m = mondayOf(d);
    const i = weeks.indexOf(m);
    if (i >= 0) return i;
    return m < weeks[0]! ? (last ? -1 : 0) : last ? weeks.length - 1 : weeks.length;
  };
  const dated = units.filter((u) => u.start && u.end && u.end >= u.start).sort((a, b) => a.start!.localeCompare(b.start!));
  const out: MapSegment[] = [];
  let at = 0;
  for (const u of dated) {
    const from = Math.max(at, index(u.start!, false));
    const to = index(u.end!, true);
    if (to < from || from >= weeks.length) continue;
    if (from > at) out.push({ kind: "gap", span: from - at });
    out.push({ kind: "unit", span: to - from + 1, name: u.name, draft: u.draft, assessment: u.assessment, from: weeks[from]!, to: weeks[to]! });
    at = to + 1;
  }
  if (at < weeks.length) out.push({ kind: "gap", span: weeks.length - at });
  return out;
}

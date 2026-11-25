import { dayKind, type SchoolYear } from "@/lib/organizations/school-year";

/**
 * Report 32.4 S3 calls 5–6 (plan B3.3c): staff deadlines, pure — the week a date falls in, the clash check (other
 * deadlines that week for the same people, and quiet weeks; it warns, never blocks), Week N of every term with a
 * holiday moved to the last school day before, the Deadlines view's weeks (counts, heavy weeks), and the templates.
 */
const DAY = 86_400_000;
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
export const mondayOf = (day: string) => addDays(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7));

export type QuietWeek = { name: string; start: string; end: string };
export type Deadline = { id: string; title: string; due: string; people: string[] };

/** The clash check: deadlines due the same week for any of these people, and the quiet week it falls in. */
export function clashCheck(due: string, people: string[], others: Deadline[], quiet: QuietWeek[]) {
  const week = mondayOf(due), end = addDays(week, 6);
  const mine = new Set(people);
  const same = others.filter((d) => d.due >= week && d.due <= end && d.people.some((p) => mine.has(p)));
  return { week, deadlines: same.map((d) => ({ id: d.id, title: d.title, due: d.due, people: d.people.filter((p) => mine.has(p)).length })),
    quiet: quiet.find((q) => due >= q.start && due <= q.end)?.name ?? null };
}

/**
 * Week N of every term (call 5): the day of that week (weekday 0 = Monday) in each term on or after `from`; a day that
 * isn't a school day moves to the last school day before it in the same week; a week the term doesn't have is skipped.
 */
export function weekOfEveryTerm(year: SchoolYear, week: number, weekday: number, from: string) {
  const out: string[] = [];
  const school = (d: string) => ["school", "half", "exam"].includes(dayKind(d, year));
  for (const t of [...year.terms].sort((a, b) => a.start.localeCompare(b.start))) {
    const monday = addDays(mondayOf(t.start), (week - 1) * 7);
    let day = addDays(monday, weekday);
    while (day > monday && !school(day)) day = addDays(day, -1);
    if (!school(day) || day < from || day > t.end) continue;
    out.push(day);
  }
  return out;
}

/** The Deadlines view: staff deadlines per week, as counts; a week with `heavyAt` or more is heavy, quiet weeks named. */
export function deadlineWeeks(deadlines: Deadline[], quiet: QuietWeek[], heavyAt = 3) {
  const weeks = new Map<string, Deadline[]>();
  for (const d of deadlines) weeks.set(mondayOf(d.due), [...(weeks.get(mondayOf(d.due)) ?? []), d]);
  return [...weeks.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([week, list]) => ({
    week, count: list.length, people: new Set(list.flatMap((d) => d.people)).size, heavy: list.length >= heavyAt,
    quiet: quiet.find((q) => q.start <= addDays(week, 6) && q.end >= week)?.name ?? null,
  }));
}

/** The school's hand-in templates (layer 2): what each asks for. No student data (layer 16). */
export const HAND_IN_TEMPLATES = [
  { id: "unit_plan", title: "Unit plan", type: "text", description: "Hand in your unit plan: pick the unit from your course, or write it here." },
  { id: "scheme", title: "Scheme of work", type: "file", description: "The scheme of work for the year, as a file." },
  { id: "paper", title: "Assessment paper for checking", type: "file", description: "The paper and its mark scheme, before it is set." },
  { id: "trip", title: "Trip risk assessment", type: "file", description: "The risk assessment for the trip: dates, place, groups, staff and risks." },
  { id: "sign_off", title: "Policy sign-off", type: "none", description: "Read the policy, then say you’ve read it." },
  { id: "training", title: "Training record", type: "file", description: "Your certificate or record for this training." },
  { id: "cover", title: "Cover work", type: "text", description: "The work for the class while you’re away: what to do and where it is." },
] as const;

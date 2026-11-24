/**
 * Report 31.2 C1 calls 1–2 (plan B2.1d): a school's kind sets its classes' starting values, never power. Coaching or
 * bootcamp starts classes with Instructor · Mentor · Learner, Modules, and joining by approval; each class can rename
 * or change them, and a class's own value always wins. Client-safe and pure.
 */
export type SchoolKind = "college" | "school" | "coaching";
export const SCHOOL_KINDS: Record<SchoolKind, string> = { college: "College or university", school: "School", coaching: "Coaching or bootcamp" };

export const readSchoolKind = (settings: unknown): SchoolKind | null => {
  const k = (settings as { schoolKind?: unknown } | null)?.schoolKind;
  return k === "college" || k === "school" || k === "coaching" ? k : null;
};

/** The settings a class starts with under this kind; merged under the class's own (`starting || own`). */
export function kindStartingValues(kind: SchoolKind | null): Record<string, unknown> {
  if (kind !== "coaching") return {};
  return { roleNames: { owner: "Instructor", admin: "Mentor", member: "Learner" }, mainSprintWord: "Module", joinMode: "approval" };
}

/**
 * The cohort timeline (call 8, the Portfolio timeline's bars): one range over every cohort, each bar as a share of it,
 * so it fits any width; a table of the same cohorts sits beside it for screen readers.
 */
export function cohortBars<T extends { start: string | null; end: string | null }>(cohorts: T[]) {
  const dated = cohorts.filter((c): c is T & { start: string; end: string } => Boolean(c.start && c.end && c.end >= c.start));
  if (!dated.length) return { start: null, end: null, bars: [] as Array<T & { left: number; width: number }> };
  const start = dated.reduce((m, c) => (c.start < m ? c.start : m), dated[0]!.start);
  const end = dated.reduce((m, c) => (c.end > m ? c.end : m), dated[0]!.end);
  const day = (d: string) => Date.parse(`${d}T00:00:00Z`) / 86_400_000;
  const span = day(end) - day(start) + 1;
  const pct = (n: number) => Math.round((n / span) * 1000) / 10;
  return { start, end, bars: dated.map((c) => ({ ...c, left: pct(day(c.start) - day(start)), width: Math.max(1, pct(day(c.end) - day(c.start) + 1)) })) };
}

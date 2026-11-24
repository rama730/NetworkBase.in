/**
 * Report 31.2 C1 (plan B2.1a): programs and cohorts, pure. A cohort is Upcoming before its start, Running until its end
 * and Finished after; its end is worked out from the program's length in weeks.
 */
export type CohortState = "upcoming" | "running" | "finished";
export const COHORT_WORDS: Record<CohortState, string> = { upcoming: "Upcoming", running: "Running", finished: "Finished" };

export function cohortState(start: string | null, end: string | null, today: string): CohortState {
  if (start && today < start) return "upcoming";
  if (end && today > end) return "finished";
  return "running";
}

const day = (d: string, add: number) => new Date(Date.parse(`${d}T00:00:00Z`) + add * 86_400_000).toISOString().slice(0, 10);
/** The last day of a cohort that starts on `start` and runs `weeks` weeks (12 weeks from Mon Apr 21 ends Sun Jul 13). */
export const cohortEnd = (start: string, weeks: number) => day(start, weeks * 7 - 1);
/** Whole weeks between two days, at least 1 (a program's length from its source cohort's term). */
export const weeksBetween = (start: string | null, end: string | null) =>
  start && end && end >= start ? Math.max(1, Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`) + 86_400_000) / (7 * 86_400_000))) : null;

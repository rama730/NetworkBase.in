/**
 * Report 38.18 call 2 (A7.6): sprint dates are optional for a learning path's steps (both or neither). Code that works
 * with dated sprints (calendars, organizations' terms, "ends Friday") keeps only those.
 */
export const hasDates = <T extends { startDate: Date | null; endDate: Date | null }>(s: T): s is T & { startDate: Date; endDate: Date } =>
  s.startDate != null && s.endDate != null;

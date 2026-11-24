import type { Session } from "@/lib/organizations/class-sessions";

/**
 * Report 30.3 W2 (plan B1.2): a class's Term plan — units (main sprints) → weeks (sprints inside them) → lessons
 * (class_lesson items). Pure: the server reads rows, these rules shape them.
 */
export type PlanLesson = { id: string; number: number | null; title: string; stage: string; weekId: string | null; order: number; outcomes: string[]; createdAt: string };
export type PlanWeek = { id: string; unitId: string; name: string; goal: string | null; start: string | null; end: string | null; status: string };
export type PlanUnit = { id: string; name: string; start: string | null; end: string | null; status: string };
export type Outcome = { code: string; text: string };
export type LessonSlot = { lessonId: string; session: Session | null; needsNewSession: boolean };

/** Staff see every lesson; students see Ready and Taught (or every planned one with "Always"). Cancelled never. */
export function visibleLessons(lessons: PlanLesson[], staff: boolean, studentsSee: "ready" | "always") {
  if (staff) return lessons;
  return lessons.filter((l) => l.stage !== "cancelled" && (studentsSee === "always" || l.stage === "ready" || l.stage === "taught"));
}

/** Lessons in their week's order: the hand order, then oldest first. */
export const lessonOrder = (a: PlanLesson, b: PlanLesson) => a.order - b.order || a.createdAt.localeCompare(b.createdAt);

/**
 * Report 30.3 call 5: a week's lessons take its sessions in order. A lesson whose session was cancelled or moved is
 * "Needs a new session"; nothing moves on its own. Extra lessons get no session ("3 lessons, 2 sessions").
 */
export function matchSessions(weekLessons: PlanLesson[], weekSessions: Session[]): LessonSlot[] {
  const live = weekLessons.filter((l) => l.stage !== "cancelled").sort(lessonOrder);
  const planned = [...weekSessions].sort((a, b) => a.key.localeCompare(b.key));
  return live.map((l, i) => {
    const session = planned[i] ?? null;
    return { lessonId: l.id, session, needsNewSession: Boolean(session && session.status !== "on" && l.stage !== "taught") };
  });
}

/** Sessions that fall in a week (by their original day, so a moved class still belongs to its week). */
export function sessionsInWeek(sessions: Session[], week: Pick<PlanWeek, "start" | "end">) {
  if (!week.start || !week.end) return [];
  const from = week.start.slice(0, 10);
  const to = week.end.slice(0, 10);
  return sessions.filter((s) => s.key.slice(0, 10) >= from && s.key.slice(0, 10) <= to);
}

/** Class progress, never a person's score: lessons taught ÷ lessons planned (cancelled ones don't count). */
export function unitProgress(lessons: PlanLesson[]) {
  const planned = lessons.filter((l) => l.stage !== "cancelled");
  const taught = planned.filter((l) => l.stage === "taught").length;
  return { taught, planned: planned.length, percent: planned.length ? Math.round((taught / planned.length) * 100) : 0 };
}

/** Outcomes covered: an outcome counts once any lesson that isn't cancelled is tagged with it. */
export function outcomeCoverage(outcomes: Outcome[], lessons: PlanLesson[]) {
  const tagged = new Set(lessons.filter((l) => l.stage !== "cancelled").flatMap((l) => l.outcomes));
  const covered = outcomes.filter((o) => tagged.has(o.code)).map((o) => o.code);
  return { covered: covered.length, total: outcomes.length, missing: outcomes.filter((o) => !tagged.has(o.code)) };
}

/** "Week 6 of 16": the week (ordered by start) holding `today`, or null outside the term. */
export function weekNumber(weeks: PlanWeek[], today: string) {
  const dated = weeks.filter((w) => w.start && w.end).sort((a, b) => a.start!.localeCompare(b.start!));
  const index = dated.findIndex((w) => today >= w.start!.slice(0, 10) && today <= w.end!.slice(0, 10));
  return { current: index >= 0 ? index + 1 : null, total: dated.length, weekId: index >= 0 ? dated[index]!.id : null };
}

/** Reads the class's outcomes list (Settings → Term plan), dropping anything malformed. */
export function readOutcomes(orgSettings: unknown): Outcome[] {
  const raw = (orgSettings as { termPlan?: { outcomes?: unknown } } | null)?.termPlan?.outcomes;
  return (Array.isArray(raw) ? raw : []).filter((o): o is Outcome => Boolean(o) && typeof o.code === "string" && typeof o.text === "string" && o.code.trim().length > 0)
    .map((o) => ({ code: o.code.trim().slice(0, 12), text: o.text.trim().slice(0, 300) })).slice(0, 30);
}
export function readTermPlanSettings(orgSettings: unknown) {
  const raw = ((orgSettings as { termPlan?: Record<string, unknown> } | null)?.termPlan ?? {}) as Record<string, unknown>;
  const label = raw.topicsLabel;
  return {
    outcomes: readOutcomes(orgSettings),
    studentsSee: raw.studentsSee === "always" ? "always" as const : "ready" as const,
    topicsLabel: label === "Chapters" || label === "Themes" ? label : "Topics" as "Topics" | "Chapters" | "Themes",
  };
}

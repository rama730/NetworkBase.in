import { z } from "zod";

/**
 * Report 38.18 O3 (A7.6–A7.7): a learning path is Sprints' steps in order (dates optional), each holding lessons
 * (`class_lesson` items); everyone ticks lessons Done for themselves (`lesson_progress`, call 1).
 */
export const pathSettingsSchema = z.object({ pacing: z.enum(["self", "scheduled"]).default("self"), lockInOrder: z.boolean().default(false), public: z.boolean().default(false),
  /** B2.2a (report 31.3): Suggested pace in weeks per module (off by default) and Stuck after N days. */
  paceWeeks: z.number().int().min(1).max(52).nullable().default(null), stuckDays: z.number().int().min(3).max(90).default(14) });
export type PathSettings = z.infer<typeof pathSettingsSchema>;
export const readPathSettings = (raw: unknown): PathSettings => pathSettingsSchema.parse(((raw ?? {}) as { path?: unknown }).path ?? {});

/** Both dates or neither; the start no later than the end (call 2). */
export function sprintDatesValid(start: Date | string | null | undefined, end: Date | string | null | undefined) {
  if (!start && !end) return true;
  if (!start || !end) return false;
  return new Date(start).getTime() <= new Date(end).getTime();
}

/** Undated sprints never auto-start (call 2). */
export const autoStartEligible = (s: { startDate: Date | null; autoStart: boolean; status: string }, now = new Date()) =>
  s.autoStart && s.status === "planning" && s.startDate != null && s.startDate.getTime() <= now.getTime();

export const lessonFieldsSchema = z.object({
  before: z.string().max(20_000).optional(),
  during: z.string().max(20_000).optional(),
  after: z.string().max(20_000).optional(),
  minutes: z.number().int().min(1).max(600).optional(),
  links: z.array(z.string().url().max(2000)).max(20).optional(),
  /** B1.2 (report 30.3): a term-plan lesson's outcome codes and its place in its week. */
  outcomes: z.array(z.string().trim().min(1).max(12)).max(20).optional(),
  order: z.number().int().min(0).max(1000).optional(),
  /** B3.2a (report 32.3 call 3): Lesson · Assessment · Activity. Ticks and class notes are written only by their own actions. */
  lessonType: z.enum(["lesson", "assessment", "activity"]).optional(),
}).strict();

type Step = { id: string; lessons: Array<{ id: string }> };
/** "3 of 7 done" for one person. */
export function stepProgress(step: Step, done: Set<string>) {
  return { done: step.lessons.filter((l) => done.has(l.id)).length, total: step.lessons.length };
}
const finished = (step: Step, done: Set<string>) => step.lessons.every((l) => done.has(l.id));

/** Up next: the first lesson not done, in the first step that isn't finished (W4). */
export function upNext(steps: Step[], done: Set<string>) {
  for (const step of steps) {
    const lesson = step.lessons.find((l) => !done.has(l.id));
    if (lesson) return { stepId: step.id, lessonId: lesson.id };
  }
  return null;
}

/** W5: with Lock in order, a step opens once every step before it is done (for that person). */
export function isLocked(steps: Step[], index: number, done: Set<string>, lockInOrder: boolean) {
  return lockInOrder && steps.slice(0, index).some((s) => !finished(s, done));
}

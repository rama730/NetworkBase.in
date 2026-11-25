import { z } from "zod";

/**
 * Report 31.5 C5 (plan B2.3a): mentoring in a class, pure. A mentor group is a section of kind "mentor"; check-ins
 * are private to the pair; Was this useful? shows only after 5 answers. Never a coach rating or score (call).
 */
export const mentoringSchema = z.object({
  on: z.boolean().default(false),
  everyWeeks: z.number().int().min(1).max(8).default(2),
  minutes: z.number().int().min(10).max(120).default(30),
  checkins: z.number().int().min(1).max(52).default(6),
  rhythmDays: z.number().int().min(7).max(60).default(21),
  useful: z.boolean().default(true),
});
export type Mentoring = z.infer<typeof mentoringSchema>;
export const readMentoring = (orgSettings: unknown): Mentoring =>
  mentoringSchema.parse(((orgSettings ?? {}) as { mentoring?: unknown }).mentoring ?? {});

/** "every 2 weeks · 30 min · 4 of 6" (layer 6); a finished plan says so. */
export function planLine(plan: Pick<Mentoring, "everyWeeks" | "minutes" | "checkins">, held: number) {
  const every = plan.everyWeeks === 1 ? "every week" : `every ${plan.everyWeeks} weeks`;
  return `${every} · ${plan.minutes} min · ${Math.min(held, plan.checkins)} of ${plan.checkins}${held >= plan.checkins ? " · finished" : ""}`;
}

/** On rhythm: a check-in within `rhythmDays` (counted from the pair's start when there's none yet). */
export function rhythm(last: string | null, since: string | null, rhythmDays: number, today: string): { on: boolean; days: number | null } {
  const from = last ?? since;
  if (!from) return { on: true, days: null };
  const days = Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${from.slice(0, 10)}T00:00:00Z`)) / 86_400_000);
  return { on: days <= rhythmDays, days };
}

export const USEFUL_WORDS = { very: "Very", somewhat: "Somewhat", not_really: "Not really" } as const;
export type UsefulAnswer = keyof typeof USEFUL_WORDS;
export const USEFUL_MIN = 5;

/** Useful counts are shown only once there are 5 answers, and never per session (layer 16). */
export function usefulSummary(answers: UsefulAnswer[]) {
  if (answers.length < USEFUL_MIN) return { shown: false as const, answers: answers.length };
  const useful = answers.filter((a) => a !== "not_really").length;
  return { shown: true as const, answers: answers.length, useful, line: `Useful: ${useful} of ${answers.length}` };
}

/** Match suggestions (call): learners without a mentor group go to the least-loaded group, in name order. Staff confirm. */
export function suggestMatches(groups: Array<{ id: string; size: number }>, unmatched: Array<{ id: string; name: string }>) {
  const load = new Map(groups.map((g) => [g.id, g.size]));
  const out: Array<{ userId: string; groupId: string }> = [];
  if (!groups.length) return out;
  for (const l of [...unmatched].sort((a, b) => a.name.localeCompare(b.name))) {
    const [id] = [...load.entries()].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))[0]!;
    out.push({ userId: l.id, groupId: id });
    load.set(id, (load.get(id) ?? 0) + 1);
  }
  return out;
}

export const prepSchema = z.object({ since: z.string().trim().max(2000).default(""), stuck: z.string().trim().max(2000).default(""), asks: z.string().trim().max(2000).default("") }).strict();
export type Prep = z.infer<typeof prepSchema>;
export const prepDone = (p: Partial<Prep> | null | undefined) => Boolean(p && (p.since || p.stuck || p.asks));

import { z } from "zod";

/**
 * Report 31.4 C3 (plan B2.4a): mock tests and skills, pure. A mock is an Exam with a Score layout; a series is a label
 * on mocks with the same layout (call 1). The overall is worked out inside one mock only (call 2). Learners see
 * Latest, Best and a trend, never an average (call 4); staff see the spread in bands, never ranks (call 5).
 */
export const scoreLayoutSchema = z.object({
  series: z.string().trim().min(1).max(60),
  sections: z.array(z.object({ key: z.string().trim().min(1).max(24), name: z.string().trim().min(1).max(40), max: z.number().positive().max(1000),
    /** Raw → band, optional (call 3: institutions enter their own): pairs of [lowest raw, band], highest first. */
    conversion: z.array(z.tuple([z.number().min(0), z.number().min(0)])).max(60).optional() })).min(1).max(8),
  overall: z.enum(["sum", "average_half", "none"]).default("none"),
}).strict();
export type ScoreLayout = z.infer<typeof scoreLayoutSchema>;

export const readScoreLayout = (exam: unknown): ScoreLayout | null => {
  const parsed = scoreLayoutSchema.safeParse((exam as { scoreLayout?: unknown } | null)?.scoreLayout);
  return parsed.success ? parsed.data : null;
};

/** Presets bring sections and maxima only (call 3). */
export const LAYOUT_PRESETS: Record<string, Omit<ScoreLayout, "series">> = {
  ielts: { sections: [{ key: "listening", name: "Listening", max: 40 }, { key: "reading", name: "Reading", max: 40 }, { key: "writing", name: "Writing", max: 9 }, { key: "speaking", name: "Speaking", max: 9 }], overall: "average_half" },
  sat: { sections: [{ key: "rw", name: "Reading and Writing", max: 800 }, { key: "math", name: "Math", max: 800 }], overall: "sum" },
  blank: { sections: [{ key: "s1", name: "Section 1", max: 100 }], overall: "none" },
};

/** A section's score as reported: its band from the conversion table when there is one, else the raw mark. */
export function sectionScore(raw: number | null | undefined, section: ScoreLayout["sections"][number]): number | null {
  if (raw == null || Number.isNaN(raw)) return null;
  if (!section.conversion?.length) return raw;
  const sorted = [...section.conversion].sort((a, b) => b[0] - a[0]);
  return sorted.find(([min]) => raw >= min)?.[1] ?? 0;
}

/** The overall inside one mock (call 2): Sum, or Average rounded to the nearest 0.5; none when a section is missing. */
export function overallScore(layout: ScoreLayout, raws: Record<string, number | null | undefined>): number | null {
  if (layout.overall === "none") return null;
  const scores = layout.sections.map((s) => sectionScore(raws[s.key], s));
  if (scores.some((x) => x == null)) return null;
  const sum = (scores as number[]).reduce((a, b) => a + b, 0);
  return layout.overall === "sum" ? sum : Math.round((sum / scores.length) * 2) / 2;
}

/** Latest and Best of a series (Missing is never zero), the gap to a target, and the trend points; no average. */
export function seriesSummary(values: Array<number | null>, target: number | null) {
  const taken = values.filter((v): v is number => v != null);
  const latest = taken.length ? taken[taken.length - 1]! : null;
  const best = taken.length ? Math.max(...taken) : null;
  const gap = target != null && latest != null ? Math.round((target - latest) * 100) / 100 : null;
  return { latest, best, gap, onTarget: gap != null && gap <= 0, trend: taken };
}

/** Staff see the spread of one mock's overall in bands (call 5), counts only. */
export function bands(values: Array<number | null>, cuts: number[]) {
  const taken = values.filter((v): v is number => v != null);
  const sorted = [...cuts].sort((a, b) => b - a);
  return sorted.map((c, i) => ({ from: c, to: i ? sorted[i - 1]! : null, count: taken.filter((v) => v >= c && (i === 0 || v < sorted[i - 1]!)).length }))
    .concat([{ from: Number.NEGATIVE_INFINITY, to: sorted[sorted.length - 1] ?? null, count: taken.filter((v) => !sorted.length || v < sorted[sorted.length - 1]!).length }]);
}

/** Days to go to the learner's exam (never negative; null without a date). */
export const daysToGo = (examDate: string | null, today: string) =>
  examDate ? Math.max(0, Math.round((Date.parse(`${examDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000)) : null;

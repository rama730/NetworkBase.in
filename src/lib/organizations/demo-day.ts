import { z } from "zod";

/**
 * Report 31.6 C4 (plan B2.5b): demo day, pure. Part of the cohort (call 4): its date and place, a Run of show with one
 * slot per team, judges who give feedback (never marks or totals, call 7), and awards picked by judges then announced
 * by staff (call 8). Mentors never judge their own teams (call 9).
 */
export const demoDaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default("15:00"),
  place: z.string().trim().max(120).default(""),
  link: z.string().trim().url().max(2000).or(z.literal("")).default(""),
  pitch: z.number().int().min(1).max(60).default(5),
  questions: z.number().int().min(0).max(30).default(3),
  order: z.array(z.string().uuid()).max(100).default([]),
  current: z.number().int().min(-1).max(100).default(-1),
  judges: z.array(z.string().uuid()).max(30).default([]),
  awards: z.array(z.string().trim().min(1).max(60)).max(10).default(["Best project", "Mentors’ pick"]),
  announced: z.record(z.string(), z.string().uuid()).default({}),
});
export type DemoDay = z.infer<typeof demoDaySchema>;
export const readDemoDay = (orgSettings: unknown): DemoDay => demoDaySchema.parse(((orgSettings ?? {}) as { demoDay?: unknown }).demoDay ?? {});

/** The Run of show: teams in order (new teams at the end, gone ones dropped), each with its start time. */
export function runOfShow(day: Pick<DemoDay, "order" | "start" | "pitch" | "questions">, teams: Array<{ id: string; title: string }>) {
  const known = day.order.filter((id) => teams.some((t) => t.id === id));
  const ids = [...known, ...teams.map((t) => t.id).filter((id) => !known.includes(id))];
  const [h, m] = day.start.split(":").map(Number) as [number, number];
  const slot = day.pitch + day.questions;
  return ids.map((id, i) => {
    const mins = h * 60 + m + 10 + i * slot;
    return { id, title: teams.find((t) => t.id === id)!.title, at: `${String(Math.floor(mins / 60) % 24).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}` };
  });
}

/** Next team / Skip move the pointer forward; past the last slot it stays at the end. */
export const advance = (current: number, length: number) => Math.min(current + 1, length);

export const FEEDBACK_KEYS = ["problem", "build", "demo"] as const;
export const FEEDBACK_WORDS: Record<(typeof FEEDBACK_KEYS)[number], string> = { problem: "Problem", build: "Build", demo: "Demo" };
export const feedbackSchema = z.object({
  scores: z.object({ problem: z.number().int().min(1).max(5).nullable(), build: z.number().int().min(1).max(5).nullable(), demo: z.number().int().min(1).max(5).nullable() }).partial(),
  note: z.string().trim().max(2000).default(""),
}).strict();

/** Picks per award, as a list of teams with how many judges picked each — staff choose; it's never published as a count. */
export function awardPicks(picks: Array<{ award: string; teamId: string }>, awards: string[]) {
  return awards.map((award) => {
    const counts = new Map<string, number>();
    for (const p of picks.filter((x) => x.award === award)) counts.set(p.teamId, (counts.get(p.teamId) ?? 0) + 1);
    return { award, picks: [...counts.entries()].map(([teamId, n]) => ({ teamId, n })).sort((a, b) => b.n - a.n) };
  });
}

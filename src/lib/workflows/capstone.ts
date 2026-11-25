import { z } from "zod";

/**
 * Report 31.6 C4 (plan B2.5a): a capstone team's workspace, pure. The brief (problem, who it's for, up to 3 success
 * metrics), each member's role, and one Showcase card: Draft → Ready once every milestone is done (call 5), public only
 * when every member agrees (call 6). No scores or leaderboard.
 */
const link = z.string().trim().url().max(2000).or(z.literal(""));
export const capstoneSchema = z.object({
  problem: z.string().trim().max(500).default(""),
  audience: z.string().trim().max(300).default(""),
  metrics: z.array(z.string().trim().min(1).max(200)).max(3).default([]),
  roles: z.record(z.string().uuid(), z.string().trim().max(40)).default({}),
  showcase: z.object({
    title: z.string().trim().max(120).default(""),
    line: z.string().trim().max(200).default(""),
    links: z.object({ demo: link.default(""), code: link.default(""), video: link.default("") }).default({ demo: "", code: "", video: "" }),
    track: z.string().trim().max(40).default(""),
    readyAt: z.string().nullable().default(null),
    consents: z.record(z.string().uuid(), z.string()).default({}),
  }).default({ title: "", line: "", links: { demo: "", code: "", video: "" }, track: "", readyAt: null, consents: {} }),
});
export type Capstone = z.infer<typeof capstoneSchema>;
export const readCapstone = (workflowSettings: unknown): Capstone =>
  capstoneSchema.parse(((workflowSettings ?? {}) as { capstone?: unknown }).capstone ?? {});

/** Ready needs a title and every milestone done (Final included); nothing to hand in yet means not ready. */
export function readyBlock(c: Pick<Capstone, "showcase">, milestones: Array<{ done: boolean }>) {
  if (!c.showcase.title) return "Give the card a title.";
  if (!milestones.length || milestones.some((m) => !m.done)) return "It’s Ready once every milestone, the Final one too, is done.";
  return null;
}

/** Public only when every current member agreed (call 6); a new member resets it until they agree too. */
export const showcasePublic = (consents: Record<string, string>, members: string[]) => members.length > 0 && members.every((m) => Boolean(consents[m]));

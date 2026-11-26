import { z } from "zod";

// Report 34.6 (plan B5.5, M5): chapters — community orgs under a community, started from a member's proposal that
// community organisers approve. Pure and client-safe.

export const CHAPTER_KINDS = { local: "Local", topic: "Topic" } as const;
export type ChapterKind = keyof typeof CHAPTER_KINDS;

export const proposalSchema = z.object({
  name: z.string().trim().min(3).max(80),
  kind: z.enum(["local", "topic"]),
  /** A city for Local, a subject for Topic: typed, never looked up (call 4). */
  place: z.string().trim().min(1).max(80),
  why: z.string().trim().max(600),
  coOrganiserId: z.string().uuid().nullable(),
}).strict();
export type ChapterProposal = z.infer<typeof proposalSchema> & { id: string; by: string; at: string; state: "proposed" | "approved" | "declined"; reason?: string | null; chapterId?: string | null };

export type ChapterSettings = { proposeBy: "members" | "organisers"; dormantDays: number; kitAbout: string };
export function readChapterSettings(orgSettings: unknown): ChapterSettings {
  const c = ((orgSettings as { community?: { chapters?: Partial<ChapterSettings> } } | null)?.community?.chapters ?? {}) as Partial<ChapterSettings>;
  const d = Number(c.dormantDays);
  return { proposeBy: c.proposeBy === "organisers" ? "organisers" : "members", dormantDays: d >= 30 && d <= 730 ? Math.round(d) : 180,
    kitAbout: typeof c.kitAbout === "string" ? c.kitAbout.slice(0, 2000) : "" };
}

/** Calls 6–7: flags for community organisers only — one organiser left, or nothing (events, posts) for dormantDays. */
export function chapterFlags(organisers: number, lastActivity: string | null, createdAt: string, now: Date, dormantDays: number) {
  const since = Date.parse(lastActivity ?? createdAt);
  return { needsCoOrganiser: organisers <= 1, dormant: now.getTime() - since > dormantDays * 86_400_000 };
}

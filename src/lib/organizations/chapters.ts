import { z } from "zod";

import type { StartItem } from "@/lib/organizations/community";
import type { Ritual } from "@/lib/organizations/rituals";

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

/** Small groups (B5.5b, call 9): kinds as words. */
export const GROUP_KINDS = ["study", "book", "accountability", "mastermind", "other"] as const;
export const GROUP_KIND_WORDS: Record<(typeof GROUP_KINDS)[number], string> = { study: "Study group", book: "Book club", accountability: "Accountability circle", mastermind: "Mastermind", other: "Other" };

/**
 * B5.5d (report 34.6 call 4): the Chapter kit — a frozen snapshot the community's organisers save (chosen documents,
 * Getting started, rituals); every approved chapter starts from it. Kept in org_settings.community.chapterKit.
 * ponytail: documents share a 40,000-character budget inside org_settings; a table if kits outgrow it.
 */
export const KIT_DOC_BUDGET = 40_000;
export type KitDoc = { sourceId?: string; slug: string; filename: string; content: string; settings: unknown };
/** The only document settings a kit carries: how it's laid out, not who it's for. */
export const KIT_DOC_KEYS = ["version", "editPolicy", "visibilityOverride", "externalImages", "projectBlocks", "section", "kind"];
export type KitRitual = Omit<Ritual, "lastPostedFor" | "createdAt" | "savedBy" | "resumedAt">;
export type ChapterKit = { docs: KitDoc[]; gettingStarted: StartItem[]; rituals: KitRitual[]; savedAt: string };

export function readChapterKit(orgSettings: unknown): ChapterKit | null {
  const k = (orgSettings as { community?: { chapterKit?: Partial<ChapterKit> } } | null)?.community?.chapterKit;
  if (!k || typeof k.savedAt !== "string") return null;
  return { savedAt: k.savedAt, docs: Array.isArray(k.docs) ? k.docs.slice(0, 5) : [], gettingStarted: Array.isArray(k.gettingStarted) ? k.gettingStarted.slice(0, 5) : [],
    rituals: Array.isArray(k.rituals) ? k.rituals.slice(0, 10) : [] };
}

/** A new chapter's own settings from the kit: rituals start paused and hosted by the chapter's first organiser. */
export function kitSettings(kit: ChapterKit | null, organiserId: string, now: Date) {
  if (!kit) return {};
  return { community: { gettingStarted: kit.gettingStarted,
    rituals: kit.rituals.map((r) => ({ ...r, hostId: organiserId, paused: true, savedBy: organiserId, createdAt: now.toISOString() })) } };
}

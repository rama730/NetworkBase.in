import { z } from "zod";

// Report 35.2 (plan B6.1, R1): a research lab — positions apart from permission roles, Reach the PI, office hours and
// the lab's public page. Pure and client-safe.

export type Position = { id: string; label: string };
export const DEFAULT_POSITIONS: Position[] = [
  { id: "pi", label: "PI" }, { id: "postdoc", label: "Postdoc" }, { id: "phd", label: "PhD student" }, { id: "masters", label: "Master's student" },
  { id: "ra", label: "Research assistant" }, { id: "visiting", label: "Visiting" }, { id: "collaborator", label: "Collaborator" },
];
export const ABOUT_SECTIONS = ["areas", "people", "alumni", "publications", "joinUs"] as const;
export type AboutSection = (typeof ABOUT_SECTIONS)[number];

export const labSettingsSchema = z.object({
  positions: z.array(z.object({ id: z.string().regex(/^[a-z0-9-]{1,24}$/), label: z.string().trim().min(1).max(40) }).strict()).min(1).max(12),
  /** "Thursdays 15:00–16:00, room 204": a line, never an email or phone (call 7). */
  officeHours: z.string().trim().max(120),
  /** Who Reach the PI messages: the owner by default, or one of the lab's Researchers. */
  contactId: z.string().uuid().nullable(),
  /** The Leaving plan (B6.1c); the New people plan has its own switch (Settings → Onboarding plan). */
  plans: z.object({ leaving: z.boolean() }).strict(),
  about: z.object({ areas: z.boolean(), people: z.boolean(), alumni: z.boolean(), publications: z.boolean(), joinUs: z.boolean() }).strict(),
  researchAreas: z.array(z.string().trim().min(1).max(60)).max(8),
  joinUs: z.string().trim().max(400),
}).strict();
export type LabSettings = z.infer<typeof labSettingsSchema>;

export const DEFAULT_LAB: LabSettings = {
  positions: DEFAULT_POSITIONS, officeHours: "", contactId: null, plans: { leaving: true },
  about: { areas: true, people: true, alumni: true, publications: true, joinUs: true }, researchAreas: [], joinUs: "",
};

export function readLabSettings(orgSettings: unknown): LabSettings {
  const parsed = labSettingsSchema.safeParse({ ...DEFAULT_LAB, ...((orgSettings as { lab?: object } | null)?.lab ?? {}) });
  return parsed.success ? parsed.data : DEFAULT_LAB;
}

/** A person's position (call 2): a label on the membership with a start year, never a permission. */
export const positionSchema = z.object({ position: z.string().regex(/^[a-z0-9-]{1,24}$/).nullable().default(null), startYear: z.number().int().min(1950).max(2100).nullable().default(null) }).strict();
export type MemberPosition = z.infer<typeof positionSchema>;
export function readPosition(viewPrefs: unknown): MemberPosition {
  const p = positionSchema.strip().safeParse((viewPrefs as { lab?: unknown } | null)?.lab ?? {});
  return p.success ? p.data : { position: null, startYear: null };
}

/** People grouped by position in the lab's order; people without one come last under "Members". */
export function groupByPosition<T extends { position: string | null }>(people: T[], positions: Position[]) {
  const groups = positions.map((p) => ({ id: p.id, label: p.label, people: people.filter((x) => x.position === p.id) }));
  const rest = people.filter((x) => !x.position || !positions.some((p) => p.id === x.position));
  return [...groups, { id: "", label: "Members", people: rest }].filter((g) => g.people.length > 0);
}

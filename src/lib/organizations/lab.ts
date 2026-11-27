import { z } from "zod";

import { bookingRulesSchema, DEFAULT_BOOKING } from "@/lib/organizations/lab-equipment";

// Report 35.2 (plan B6.1, R1): a research lab — positions apart from permission roles, Reach the PI, office hours and
// the lab's public page. Pure and client-safe.

export type Position = { id: string; label: string };
export const DEFAULT_POSITIONS: Position[] = [
  { id: "pi", label: "PI" }, { id: "postdoc", label: "Postdoc" }, { id: "phd", label: "PhD student" }, { id: "masters", label: "Master's student" },
  { id: "ra", label: "Research assistant" }, { id: "visiting", label: "Visiting" }, { id: "collaborator", label: "Collaborator" },
];
export const ABOUT_SECTIONS = ["areas", "people", "alumni", "publications", "joinUs"] as const;
export type AboutSection = (typeof ABOUT_SECTIONS)[number];

/** B6.4b: weekday 0 = Sunday, in the lab's time zone. */
export const readingGroupSchema = z.object({ on: z.boolean(), weekday: z.number().int().min(0).max(6), time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  order: z.array(z.string().uuid()).max(60), pickDays: z.number().int().min(1).max(7) }).strict();
/** B6.5a: the lab meeting — the same slot and rotation, no pick-by. */
export const labMeetingSchema = readingGroupSchema.omit({ pickDays: true }).strict();
export type SessionKind = "reading_group" | "lab_meeting";
/** B6.5b: one step of a milestone template; `every` repeats it (the annual review) until the last one-off step. */
export const milestoneStepSchema = z.object({ key: z.string().regex(/^[a-z0-9-]{1,30}$/), name: z.string().trim().min(1).max(80), month: z.number().int().min(1).max(120),
  every: z.number().int().min(6).max(24).nullable() }).strict();
export type MilestoneStep = z.infer<typeof milestoneStepSchema>;

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
  /** B6.2a: who approves protocols — the PI, or Researchers too. */
  protocolApprovers: z.enum(["pi", "researchers"]),
  /** B6.2c: equipment booking — bookable hours, slot length and a weekly cap per person (call 7). */
  booking: bookingRulesSchema,
  /** B6.3a (call 6): papers go through the PI's internal review before Submitted; on by default. */
  paperReview: z.boolean(),
  /** B6.4a: the Library's themes (the lab's list, editable by the PI and Researchers). */
  themes: z.array(z.string().trim().min(1).max(60)).max(30),
  /** B6.4b (calls 6–7): the reading group's weekly slot, presenter order and pick-by days. */
  readingGroup: readingGroupSchema,
  /** B6.5a (call 1): the lab meeting's weekly slot and talk rotation. */
  labMeeting: labMeetingSchema,
  /** B6.5b (call 4): milestone templates per position, in months from the person's start (doubled for part-time). */
  milestones: z.record(z.string().regex(/^[a-z0-9-]{1,24}$/), z.array(milestoneStepSchema).max(12)),
}).strict();
export type LabSettings = z.infer<typeof labSettingsSchema>;

export const DEFAULT_LAB: LabSettings = {
  positions: DEFAULT_POSITIONS, officeHours: "", contactId: null, plans: { leaving: true },
  about: { areas: true, people: true, alumni: true, publications: true, joinUs: true }, researchAreas: [], joinUs: "", protocolApprovers: "pi", booking: DEFAULT_BOOKING, paperReview: true, themes: [],
  readingGroup: { on: false, weekday: 2, time: "16:00", order: [], pickDays: 3 },
  labMeeting: { on: false, weekday: 4, time: "11:00", order: [] },
  milestones: {
    phd: [{ key: "proposal", name: "Proposal", month: 12, every: null }, { key: "qualifying", name: "Qualifying exam", month: 18, every: null },
      { key: "annual-review", name: "Annual review", month: 12, every: 12 }, { key: "submission", name: "Thesis submission", month: 42, every: null },
      { key: "defence", name: "Defence", month: 48, every: null }],
    masters: [{ key: "proposal", name: "Proposal", month: 6, every: null }, { key: "submission", name: "Thesis submission", month: 22, every: null }],
  },
};

export function readLabSettings(orgSettings: unknown): LabSettings {
  const stored = ((orgSettings as { lab?: Record<string, unknown> } | null)?.lab ?? {}) as Record<string, unknown>;
  const parsed = labSettingsSchema.safeParse({ ...DEFAULT_LAB, ...stored });
  if (parsed.success) return parsed.data;
  // Review: one bad field falls back alone; the rest of the lab's settings stand.
  const shape = (labSettingsSchema as unknown as { shape: Record<string, z.ZodTypeAny> }).shape;
  return Object.fromEntries(Object.entries(DEFAULT_LAB).map(([k, d]) => [k, shape[k]!.safeParse(stored[k]).success ? stored[k] : d])) as LabSettings;
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

/**
 * B6.1c (layer 3): the Leaving plan — steps for the person and their supervisor, due before the end date (days are
 * negative offsets from it). {name} is the person leaving.
 */
export type LeavingStep = { id: string; day: number; who: "person" | "supervisor"; title: string };
export const LEAVING_PLAN: LeavingStep[] = [
  { id: "data", day: -14, who: "person", title: "Write down where your data and code live" },
  { id: "notebooks", day: -7, who: "person", title: "Hand over your notebooks and protocols" },
  { id: "workspaces", day: -7, who: "supervisor", title: "Pick the new owner of {name}’s workspaces" },
  { id: "equipment", day: -3, who: "person", title: "Return equipment and keys" },
  { id: "handover", day: -1, who: "supervisor", title: "Check the handover with {name}" },
];
export const finishSchema = z.object({
  end: z.string().date(),
  /** Call 6: the PI can keep someone as a Viewer (papers still in review); otherwise private work closes on the end date. */
  keepAsViewer: z.boolean(),
}).strict();
export type LeavingRecord = { end: string; keepAsViewer: boolean; by: string; steps: Array<{ id: string; taskId: string | null }> };
/** No email or phone (call 7): an @, or a run of 9+ digits (a year range like "2019 - 2023" passes). */
export function looksLikeContact(text: string) {
  return text.includes("@") || (text.match(/\+?\d[\d\s().-]{6,}\d/g) ?? []).some((run) => run.replace(/\D/g, "").length >= 9);
}
export const alumniSchema = z.object({ listed: z.boolean(), nowAt: z.string().trim().max(120) }).strict();
/** A step's due day: the end date plus its (negative) offset, never before today. */
export function leavingDue(end: string, day: number, today: string) {
  const due = new Date(Date.parse(`${end}T00:00:00Z`) + day * 86_400_000).toISOString().slice(0, 10);
  return due < today ? today : due;
}

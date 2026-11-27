import { z } from "zod";

// Report 36.2 (plan B7.1a, L1): a club's recruiting period — dates, a banner line and the first event to point to. It
// shows Recruiting now on About and in Discover and switches itself off after the end date. Pure and client-safe.

export const recruitingSchema = z.object({
  from: z.string().date(),
  to: z.string().date(),
  line: z.string().trim().max(160),
  firstEventId: z.string().uuid().nullable(),
}).strict().refine((r) => r.to >= r.from, "ends after it starts");
export type Recruiting = z.infer<typeof recruitingSchema>;

export function readRecruiting(orgSettings: unknown): Recruiting | null {
  const raw = (orgSettings as { club?: { recruiting?: unknown } } | null)?.club?.recruiting;
  const p = recruitingSchema.safeParse(raw);
  return p.success ? p.data : null;
}

/** Call 3: recruiting from the start date through the end date (the day, in UTC); off on its own after that. */
export const isRecruiting = (r: Recruiting | null, today: string) => Boolean(r && r.from <= today && today <= r.to);

/**
 * Report 36.2 call 6 (B7.1b): Season renewal — one ask, "Staying this Season?", from the Season's start. Nobody is removed
 * on their own; officers may end the memberships not renewed once the answer window has closed.
 */
export const renewalSchema = z.object({ on: z.boolean(), season: z.string().date(), ask: z.string().trim().min(1).max(120), days: z.number().int().min(7).max(90) }).strict();
export type Renewal = z.infer<typeof renewalSchema>;
export const DEFAULT_ASK = "Staying this Season?";
export function readRenewal(orgSettings: unknown): Renewal | null {
  const p = renewalSchema.safeParse((orgSettings as { club?: { renewal?: unknown } } | null)?.club?.renewal);
  return p.success ? p.data : null;
}
export type RenewalState = "staying" | "leaving" | "not_answered" | "not_asked";
export const RENEWAL_WORDS: Record<RenewalState, string> = { staying: "Staying", leaving: "Leaving", not_answered: "Not answered", not_asked: "Joined this Season" };
const DAY = 86_400_000;
/** Edge (36.2 layer 12): someone who joined in the 30 days before the Season's start isn't asked that Season. */
export function renewalState(r: Renewal, answer: { season?: string; answer?: string } | null | undefined, joinedAt: string | null): RenewalState {
  if (joinedAt && Date.parse(joinedAt) >= Date.parse(`${r.season}T00:00:00Z`) - 30 * DAY) return "not_asked";
  if (answer?.season === r.season && (answer.answer === "staying" || answer.answer === "leaving")) return answer.answer;
  return "not_answered";
}
/** The answer window closes this many days after the Season's start. */
export const windowClosed = (r: Renewal, today: string) => Date.parse(`${today}T00:00:00Z`) >= Date.parse(`${r.season}T00:00:00Z`) + r.days * DAY;

/**
 * Report 36.3 (B7.2a, calls 1–3): positions are labels with a Season term, separate from permission roles. Holding one
 * gives the role it names: Coordinator (admin) or none. The President is the club's owner, which moves only through the
 * built ownership transfer (call 9).
 */
export const positionSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,30}$/),
  label: z.string().trim().min(1).max(60),
  filled: z.enum(["election", "appointment"]),
  gives: z.enum(["president", "coordinator", "none"]),
  docId: z.string().uuid().nullable(),
}).strict();
export type ClubPosition = z.infer<typeof positionSchema>;
export const positionsSettingsSchema = z.object({ season: z.string().trim().min(1).max(20), positions: z.array(positionSchema).min(1).max(15) }).strict();
export type PositionsSettings = z.infer<typeof positionsSettingsSchema>;
export const STARTER_POSITIONS: ClubPosition[] = [
  { id: "president", label: "President", filled: "election", gives: "president", docId: null },
  { id: "vice-president", label: "Vice-president", filled: "election", gives: "coordinator", docId: null },
  { id: "secretary", label: "Secretary", filled: "election", gives: "coordinator", docId: null },
  { id: "treasurer", label: "Treasurer", filled: "election", gives: "coordinator", docId: null },
  { id: "events", label: "Events officer", filled: "appointment", gives: "coordinator", docId: null },
  { id: "tech", label: "Tech officer", filled: "appointment", gives: "coordinator", docId: null },
  { id: "outreach", label: "Outreach officer", filled: "appointment", gives: "coordinator", docId: null },
];
export function readPositions(orgSettings: unknown, now = new Date()): PositionsSettings {
  const p = positionsSettingsSchema.safeParse((orgSettings as { club?: { committee?: unknown } } | null)?.club?.committee);
  if (p.success) return p.data;
  const y = now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  return { season: `${y}–${String(y + 1).slice(2)}`, positions: STARTER_POSITIONS };
}

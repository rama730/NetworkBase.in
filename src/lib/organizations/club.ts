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

/**
 * B7.2b (36.3 call 5): count one position's ballots for this round. Abstain (null) counts toward turnout only. The most
 * votes wins; a tie goes to a run-off between the tied candidates; no votes at all leaves it unfilled.
 */
export function tally(choices: Array<string | null>, candidates: string[]) {
  const counts = Object.fromEntries(candidates.map((c) => [c, 0])) as Record<string, number>;
  for (const c of choices) if (c && c in counts) counts[c] = counts[c]! + 1;
  const top = Math.max(0, ...Object.values(counts));
  const leaders = top > 0 ? candidates.filter((c) => counts[c] === top) : [];
  return { counts, abstained: choices.filter((c) => c === null).length, winner: leaders.length === 1 ? leaders[0]! : null, tied: leaders.length > 1 ? leaders : [] };
}

/**
 * B7.2c (36.3 call 10): the handover — the incoming Season and the date roles switch. The checklist opens three weeks
 * before; on the date the hourly job switches roles, and work the outgoing officer didn't move moves anyway (edge 12).
 */
export const handoverSchema = z.object({ season: z.string().trim().min(1).max(20), date: z.string().date(),
  noticedAt: z.string().optional(), switchedAt: z.string().optional() }).strict();
export type Handover = z.infer<typeof handoverSchema>;
export function readHandover(orgSettings: unknown): Handover | null {
  const p = handoverSchema.safeParse((orgSettings as { club?: { handover?: unknown } } | null)?.club?.handover);
  return p.success ? p.data : null;
}
export const HANDOVER_ITEMS = [
  { id: "role_page", label: "Role page updated" }, { id: "tasks", label: "Open tasks moved" }, { id: "docs", label: "Documents moved" },
  { id: "accounts", label: "Accounts listed (names only)" }, { id: "meeting", label: "Handover meeting held" },
] as const;
export type HandoverItem = (typeof HANDOVER_ITEMS)[number]["id"];
export const checklistOpen = (h: Handover, today: string) => Date.parse(`${today}T00:00:00Z`) >= Date.parse(`${h.date}T00:00:00Z`) - 21 * DAY;
export const handoverDue = (h: Handover, today: string) => !h.switchedAt && today >= h.date;

/**
 * B7.3a (36.4 layer 2, calls 2 and 5): Club → Meetings. The agenda deadline (days before a general meeting), whether
 * members propose items, and the quorum as a share of members staying this Season.
 */
export const clubMeetingsSchema = z.object({ agendaDays: z.number().int().min(0).max(14), propose: z.boolean(), quorumShare: z.number().min(0.05).max(1),
  /** B7.3b (call 7): the share of those voting For or Against that a constitution change needs. */
  amendThreshold: z.number().min(0.5).max(1).default(2 / 3) }).strict();
export type ClubMeetings = z.infer<typeof clubMeetingsSchema>;
export const DEFAULT_CLUB_MEETINGS: ClubMeetings = { agendaDays: 3, propose: true, quorumShare: 0.25, amendThreshold: 2 / 3 };
export function readClubMeetings(orgSettings: unknown): ClubMeetings {
  const p = clubMeetingsSchema.safeParse((orgSettings as { club?: { meetings?: unknown } } | null)?.club?.meetings);
  return p.success ? p.data : DEFAULT_CLUB_MEETINGS;
}
/** Members can add to the agenda until this many days before the meeting starts. */
export const agendaOpen = (startsAt: string, agendaDays: number, now = Date.now()) => now < Date.parse(startsAt) - agendaDays * DAY;

/**
 * B7.3b (36.4 call 7): the constitution — numbered articles, kept as versions. After the first version it changes only
 * by a motion at a general meeting or the AGM that names one article (add, change or remove) and passes at the threshold.
 */
const ARTICLE_NUMBER = /^\d{1,2}(\.\d{1,2})?$/;
export const articleSchema = z.object({ n: z.string().regex(ARTICLE_NUMBER), title: z.string().trim().min(1).max(80), text: z.string().trim().min(1).max(2000) }).strict();
export type Article = z.infer<typeof articleSchema>;
export const articlesSchema = z.array(articleSchema).min(1).max(60);
export const amendmentSchema = z.object({ article: z.string().regex(ARTICLE_NUMBER), title: z.string().trim().min(1).max(80).optional(), text: z.string().trim().min(1).max(2000).nullable() }).strict();
export type Amendment = z.infer<typeof amendmentSchema>;
export const STARTER_ARTICLES: Article[] = [
  { n: "1", title: "Name", text: "The club is called {club}." },
  { n: "2", title: "Purpose", text: "What the club is for, in a sentence or two." },
  { n: "3", title: "Membership", text: "Membership runs for one Season and is renewed each Season." },
  { n: "4", title: "Officers", text: "The committee is the President, Vice-president, Secretary and Treasurer, elected each Season by secret ballot." },
  { n: "5", title: "Meetings", text: "A general meeting is held each month and an annual general meeting each Season. Quorum is a quarter of members staying this Season." },
  { n: "6", title: "Amendments", text: "This constitution changes only by a motion at a general meeting or the annual general meeting, passed by two-thirds of those voting." },
];
const numberParts = (n: string) => n.split(".").map(Number);
export const sortArticles = (list: Article[]) => [...list].sort((a, b) => {
  const [x, y] = [numberParts(a.n), numberParts(b.n)];
  return (x[0]! - y[0]!) || ((x[1] ?? 0) - (y[1] ?? 0));
});
/** The articles after an amendment, or null when it doesn't fit (removing or changing a missing article; a new one without a title). */
export function applyAmendment(list: Article[], a: Amendment): Article[] | null {
  const at = list.find((x) => x.n === a.article);
  if (a.text === null) return at && list.length > 1 ? list.filter((x) => x.n !== a.article) : null;
  if (at) return list.map((x) => (x.n === a.article ? { n: x.n, title: a.title ?? x.title, text: a.text! } : x));
  return a.title ? sortArticles([...list, { n: a.article, title: a.title, text: a.text }]) : null;
}
export const amendmentLine = (list: Article[], a: Amendment) => `Article ${a.article} ${a.text === null ? "removed" : list.some((x) => x.n === a.article) ? "changed" : "added"}`;
/** Abstentions don't count; the change needs the threshold share of those voting For or Against. */
export const amendmentPasses = (v: { for: number; against: number }, threshold: number) => v.for > 0 && v.for >= threshold * (v.for + v.against) - 1e-9;

/**
 * B7.4a (36.5 calls 1–3): a competition the club enters — a club item with its details, how teams are picked, and its
 * team workspaces. Links are typed and never fetched. Outcomes of picking stay between the person and the officers.
 */
export const PICKING = ["open", "tryouts", "officers"] as const;
export const PICKING_WORDS: Record<(typeof PICKING)[number], string> = { open: "Open sign-up", tryouts: "Tryouts", officers: "Picked by officers" };
export const competitionSchema = z.object({
  title: z.string().trim().min(1).max(120),
  organiser: z.string().trim().max(120),
  category: z.string().trim().max(40),
  starts: z.string().date(),
  ends: z.string().date(),
  registerBy: z.string().date().nullable(),
  place: z.string().trim().max(120),
  link: z.string().trim().max(500).refine((v) => !v || /^https?:\/\//i.test(v), "Links start with http:// or https://"),
  teamSize: z.number().int().min(1).max(30),
  subs: z.number().int().min(0).max(10),
  picking: z.enum(PICKING),
}).strict().refine((c) => c.ends >= c.starts, "It ends on or after it starts.");
export type Competition = z.infer<typeof competitionSchema>;
export type CompetitionTeam = { workspaceId: string; name: string };
/** "register by" in days, as text (accessibility: deadlines in full with days left). */
export function daysLeft(date: string, today: string) {
  const n = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY);
  return n < 0 ? "closed" : n === 0 ? "today" : n === 1 ? "1 day left" : `${n} days left`;
}
/** The kind line sent with Not this time; reasons stay with the reviewers. */
export const NOT_THIS_TIME = "Thank you for trying out. Not this time — there will be other chances, and we’d love to see you try again.";

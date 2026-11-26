// Report 34.2 (plan B5.1, M1): a community's front door — numbered rules from the Code of conduct, agreeing to its
// current version, join questions and Getting started. Client-safe and pure.

export type CommunityRule = { n: number; text: string };
export type JoinQuestion = { id: string; label: string };
export type StartItem = { id: string; label: string; href: string };
export type CommunitySettings = { agreeRequired: boolean; questions: JoinQuestion[]; gettingStarted: StartItem[]; welcomePost: boolean; firstDayLimit: boolean };

export const DEFAULT_COMMUNITY: CommunitySettings = {
  agreeRequired: true, questions: [], welcomePost: false, firstDayLimit: true,
  gettingStarted: [
    { id: "rules", label: "Read the Code of conduct", href: "?tab=docs" },
    { id: "hello", label: "Say hi in the introductions channel", href: "/messages" },
    { id: "profile", label: "Add your interests to your profile", href: "/profile/edit" },
  ],
};

export function readCommunitySettings(orgSettings: unknown): CommunitySettings {
  const c = ((orgSettings as { community?: Partial<CommunitySettings> } | null)?.community ?? {}) as Partial<CommunitySettings>;
  return {
    agreeRequired: c.agreeRequired !== false,
    questions: Array.isArray(c.questions) ? c.questions.slice(0, 3) : [],
    gettingStarted: Array.isArray(c.gettingStarted) ? c.gettingStarted.slice(0, 5) : DEFAULT_COMMUNITY.gettingStarted,
    welcomePost: c.welcomePost === true,
    firstDayLimit: c.firstDayLimit !== false,
  };
}

/** Call 3: the numbered list under the "Rules" heading of the Code of conduct ("1. Be kind…"), in order. */
export function parseRules(markdown: string): CommunityRule[] {
  const lines = markdown.split("\n");
  const start = lines.findIndex((l) => /^#{1,6}\s+rules\s*$/i.test(l.trim()));
  if (start < 0) return [];
  const level = /^(#+)/.exec(lines[start]!.trim())![1]!.length;
  const rules: CommunityRule[] = [];
  for (const raw of lines.slice(start + 1)) {
    const line = raw.trim();
    const h = /^(#+)\s/.exec(line);
    if (h && h[1]!.length <= level) break;
    const m = /^(\d{1,2})[.)]\s+(.+)$/.exec(line);
    if (m) rules.push({ n: Number(m[1]), text: m[2]!.replace(/\*\*|__/g, "").trim().slice(0, 200) });
  }
  return rules.slice(0, 30);
}

/** Call 4: a member must agree again when the Code of conduct's version moved past the one they agreed to. */
export const needsAgreement = (required: boolean, current: number, agreed: number | null) => required && (agreed === null || agreed < current);

/** Call 7: Getting started shows for 14 days after joining, until every item is done. */
export const showGettingStarted = (joinedAt: string | null, now: Date, items: number, done: number) =>
  Boolean(joinedAt) && items > 0 && done < items && now.getTime() - Date.parse(joinedAt!) < 14 * 86_400_000;

// ---- Report 34.3 (plan B5.2, M2): members and roles ----

export type CommunityLabel = "moderator" | "host" | "helper";
export const COMMUNITY_LABELS: readonly CommunityLabel[] = ["moderator", "host", "helper"];
export type MembersSettings = { quietDays: number; helperWord: string; pauseHours: number[] };
export const DEFAULT_MEMBERS: MembersSettings = { quietDays: 60, helperWord: "Helper", pauseHours: [24, 168] };

export function readMembersSettings(orgSettings: unknown): MembersSettings {
  const m = ((orgSettings as { community?: { members?: Partial<MembersSettings> } } | null)?.community?.members ?? {}) as Partial<MembersSettings>;
  const quiet = Number(m.quietDays);
  const word = typeof m.helperWord === "string" ? m.helperWord.trim().slice(0, 30) : "";
  const hours = Array.isArray(m.pauseHours) ? m.pauseHours.filter((h) => h === 24 || h === 168) : [];
  return { quietDays: quiet >= 14 && quiet <= 365 ? Math.round(quiet) : 60, helperWord: word || "Helper", pauseHours: hours.length ? hours : [24, 168] };
}

const DAY = 86_400_000;
/** Call 4 + state: New for the first 30 days (shown to everyone so others can welcome them). */
export const isNewMember = (joinedAt: string | null, now: Date) => Boolean(joinedAt) && now.getTime() - Date.parse(joinedAt!) < 30 * DAY;

/** Call 4: New · Active · Quiet, worked out, for organisers only. Quiet = no post, RSVP or attending for `quietDays`. */
export function memberStatus(joinedAt: string | null, lastActiveAt: string | null, now: Date, quietDays: number): "new" | "active" | "quiet" {
  if (isNewMember(joinedAt, now)) return "new";
  const since = lastActiveAt ?? joinedAt;
  return since && now.getTime() - Date.parse(since) < quietDays * DAY ? "active" : "quiet";
}

/** Pause posting: active until its end; ends on its own. */
export const pauseActive = (pause: { until: string } | null | undefined, now: Date) => Boolean(pause?.until) && Date.parse(pause!.until) > now.getTime();

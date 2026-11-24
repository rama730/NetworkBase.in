import { addDaysToDay, todayInZone, zonedInputToIso } from "@/lib/organizations/zoned-time";

/**
 * Report 30.2 W1 (plan B1.1): a class's details live in org_settings.classDetails; sessions are worked out from
 * meets × term − breaks, and only a changed session (cancelled or moved) is stored, in org_settings.sessionChanges.
 */
export type Meet = { day: number; start: string; end: string };
export type ClassDetails = {
  courseCode: string | null;
  /** day: 0 = Sunday … 6 = Saturday; times "HH:MM" in the class's zone. */
  meets: Meet[];
  room: string | null;
  onlineLink: string | null;
  officeHours: { days: number[]; start: string; end: string; place: string | null } | null;
  credits: number | null;
  breaks: Array<{ name: string; start: string; end: string }>;
  /** Show to visitors: on for course code, meets and term; off for room and office hours. */
  show: { courseCode: boolean; meets: boolean; term: boolean; room: boolean; officeHours: boolean };
};
export type SessionChange = { cancelled: true } | { movedTo: string };
export type Session = { key: string; start: string; end: string; status: "on" | "cancelled" | "moved"; movedFrom?: string };

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/;
const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
export const DEFAULT_SHOW: ClassDetails["show"] = { courseCode: true, meets: true, term: true, room: false, officeHours: false };

/** Reads what's stored, dropping anything malformed (a hand-edited row never breaks the page). */
export function readClassDetails(orgSettings: unknown): ClassDetails | null {
  const raw = (orgSettings as { classDetails?: Record<string, unknown> } | null)?.classDetails;
  if (!raw || typeof raw !== "object") return null;
  const meets = (Array.isArray(raw.meets) ? raw.meets : []).filter((m): m is Meet =>
    Boolean(m) && Number.isInteger(m.day) && m.day >= 0 && m.day <= 6 && TIME.test(m.start) && TIME.test(m.end) && m.end > m.start).slice(0, 14);
  const oh = raw.officeHours as ClassDetails["officeHours"] | undefined;
  const show = (raw.show ?? {}) as Partial<ClassDetails["show"]>;
  return {
    courseCode: text(raw.courseCode, 20), meets, room: text(raw.room, 80),
    onlineLink: typeof raw.onlineLink === "string" && /^https:\/\/\S{3,300}$/.test(raw.onlineLink) ? raw.onlineLink : null,
    officeHours: oh && Array.isArray(oh.days) && TIME.test(oh.start) && TIME.test(oh.end) && oh.end > oh.start
      ? { days: oh.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6), start: oh.start, end: oh.end, place: text(oh.place, 80) } : null,
    credits: typeof raw.credits === "number" && raw.credits >= 0 && raw.credits <= 60 ? raw.credits : null,
    breaks: (Array.isArray(raw.breaks) ? raw.breaks : []).filter((b) => b && DAY.test(b.start) && DAY.test(b.end) && b.end >= b.start)
      .map((b) => ({ name: text(b.name, 60) ?? "Break", start: b.start, end: b.end })).slice(0, 20),
    show: { ...DEFAULT_SHOW, ...Object.fromEntries(Object.entries(show).filter(([, v]) => typeof v === "boolean")) },
  };
}

export function readSessionChanges(orgSettings: unknown): Record<string, SessionChange> {
  const raw = (orgSettings as { sessionChanges?: Record<string, unknown> } | null)?.sessionChanges;
  if (!raw || typeof raw !== "object") return {};
  return Object.fromEntries(Object.entries(raw).filter(([k, v]) => LOCAL.test(k) && v && typeof v === "object"
    && ((v as { cancelled?: unknown }).cancelled === true || LOCAL.test(String((v as { movedTo?: unknown }).movedTo ?? "")))) as Array<[string, SessionChange]>);
}

const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const plus = (local: string, mins: number) => {
  const at = new Date(`${local}:00Z`);
  at.setUTCMinutes(at.getUTCMinutes() + mins);
  return at.toISOString().slice(0, 16);
};

/** Every session of the term in order: meets on term days, minus breaks, with each change applied. */
export function termSessions(details: Pick<ClassDetails, "meets" | "breaks">, term: { start: string | null; end: string | null }, changes: Record<string, SessionChange> = {}): Session[] {
  if (!term.start || !term.end || term.end < term.start || details.meets.length === 0) return [];
  const out: Session[] = [];
  // ponytail: a year of days at most; a longer "term" is a typo.
  for (let day = term.start, i = 0; day <= term.end && i < 400; day = addDaysToDay(day, 1), i++) {
    if (details.breaks.some((b) => day >= b.start && day <= b.end)) continue;
    const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
    for (const m of details.meets.filter((x) => x.day === weekday).sort((a, b) => a.start.localeCompare(b.start))) {
      const key = `${day}T${m.start}`;
      const length = minutes(m.end) - minutes(m.start);
      const change = changes[key];
      if (change && "movedTo" in change) out.push({ key, start: change.movedTo, end: plus(change.movedTo, length), status: "moved", movedFrom: key });
      else out.push({ key, start: key, end: `${day}T${m.end}`, status: change ? "cancelled" : "on" });
    }
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

/** The next session that hasn't ended, cancelled ones included (so Overview can say "Cancelled · Thu"). */
export function nextSession(sessions: Session[], zone: string | null, now = new Date()): Session | null {
  return sessions.find((s) => Date.parse(zonedInputToIso(s.end, zone)) > now.getTime()) ?? null;
}

/** Office hours on today's weekday in the class's zone. */
export function officeHoursToday(details: Pick<ClassDetails, "officeHours">, zone: string | null, now = new Date()) {
  const oh = details.officeHours;
  if (!oh) return null;
  return oh.days.includes(new Date(`${todayInZone(zone, now)}T00:00:00Z`).getUTCDay()) ? oh : null;
}

import { z } from "zod";

import { addDaysToDay, todayInZone, zonedInputToIso } from "@/lib/organizations/zoned-time";

// Report 34.5 (plan B5.4d, M4 calls 7–8): community rituals — a Thread posted on its schedule as an Update naming its
// host, or Ask me anything, posted a few days early so questions come in first. Pure and client-safe.

export const ritualSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{4,40}$/),
  name: z.string().trim().min(1).max(80),
  kind: z.enum(["thread", "ama"]),
  freq: z.enum(["weekly", "monthly"]),
  /** 0 = Sunday … 6 = Saturday; monthly means the first one in the month. */
  weekday: z.number().int().min(0).max(6),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  hostId: z.string().uuid(),
  prompt: z.string().trim().max(2000),
  /** Ask me anything: questions open this many days before the host answers. */
  leadDays: z.number().int().min(0).max(7),
  paused: z.boolean(),
}).strict();
/** savedBy: the organiser who last saved it — posts go out as them (the community's voice), naming the host. */
export type Ritual = z.infer<typeof ritualSchema> & { lastPostedFor?: string | null; createdAt?: string; savedBy?: string; resumedAt?: string | null };

const matches = (r: Pick<Ritual, "freq" | "weekday">, day: string) =>
  new Date(`${day}T00:00:00Z`).getUTCDay() === r.weekday && (r.freq === "weekly" || Number(day.slice(8, 10)) <= 7);

/** The latest occurrence whose post time (the occurrence, less lead days for an AMA) has come: what to post now, if new. */
export function lastDue(r: Ritual, now: Date, tz: string | null) {
  const lead = r.kind === "ama" ? r.leadDays : 0;
  const today = todayInZone(tz, now);
  for (let i = lead; i >= -40; i--) {
    const day = addDaysToDay(today, i);
    if (!matches(r, day)) continue;
    const at = zonedInputToIso(`${day}T${r.time}`, tz);
    const post = new Date(Date.parse(at) - lead * 86_400_000);
    if (post.getTime() <= now.getTime()) return { at, post: post.toISOString() };
  }
  return null;
}

/** The next occurrence after now (for the Rituals list). */
export function nextAt(r: Pick<Ritual, "freq" | "weekday" | "time">, now: Date, tz: string | null) {
  const today = todayInZone(tz, now);
  for (let i = 0; i <= 40; i++) {
    const day = addDaysToDay(today, i);
    if (!matches(r, day)) continue;
    const at = zonedInputToIso(`${day}T${r.time}`, tz);
    if (Date.parse(at) > now.getTime()) return at;
  }
  return null;
}

/** Due when the latest occurrence is newer than the last one posted and than the ritual itself; never while paused. */
export function dueRitual(r: Ritual, now: Date, tz: string | null) {
  if (r.paused) return null;
  const due = lastDue(r, now, tz);
  if (!due) return null;
  if (r.lastPostedFor && Date.parse(r.lastPostedFor) >= Date.parse(due.at)) return null;
  if (r.createdAt && Date.parse(due.post) < Date.parse(r.createdAt)) return null;
  // Resuming never posts what was missed while paused (review).
  if (r.resumedAt && Date.parse(due.post) < Date.parse(r.resumedAt)) return null;
  return due;
}

export const repeatWords = (r: Pick<Ritual, "freq" | "weekday" | "time">) => {
  const day = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][r.weekday];
  return r.freq === "weekly" ? `Every ${day} at ${r.time}` : `First ${day} of the month at ${r.time}`;
};

import { z } from "zod";

import { addDaysToDay, todayInZone, zonedInputToIso } from "@/lib/organizations/zoned-time";

// Report 35.5 (plan B6.2b, R4 calls 2–5): a lab workspace's Notebook — entries lock at the end of their day in the
// lab's time zone, then take amendments; experiments group them. Pure and client-safe.

const text = (max: number) => z.string().trim().max(max);
/** Outside storage named by link: typed, never fetched (call 9). */
const link = z.string().trim().url().max(500).refine((u) => /^https?:\/\//i.test(u), "http or https only");

export const entrySchema = z.object({
  title: text(160).min(1),
  /** Today, or yesterday once ("written later"). */
  day: z.string().date(),
  aim: text(2000), inputs: text(2000), steps: text(8000), deviations: text(4000), results: text(8000), next: text(2000),
  links: z.array(link).max(20),
  protocolDocId: z.string().uuid().nullable(),
  experimentId: z.string().uuid().nullable(),
}).strict();
export type EntryInput = z.infer<typeof entrySchema>;
export const BODY_KEYS = ["aim", "inputs", "steps", "deviations", "results", "next", "links"] as const;

export const experimentSchema = z.object({
  title: text(120).min(1),
  hypothesis: text(2000),
  status: z.enum(["planned", "running", "done", "stopped"]),
  conclusion: text(4000),
}).strict();
export const EXPERIMENT_WORDS = { planned: "Planned", running: "Running", done: "Done", stopped: "Stopped" } as const;

/**
 * When an entry for `day` locks (call 3): the end of that day in the lab's time zone. An entry for yesterday, written
 * after midnight, is allowed once and locks at the end of today; anything older or in the future is refused (null).
 */
export function entryLock(day: string, timeZone: string | null | undefined, now = new Date()): { locksAt: string; writtenLater: boolean } | null {
  const today = todayInZone(timeZone, now);
  const endOf = (d: string) => zonedInputToIso(`${addDaysToDay(d, 1)}T00:00`, timeZone);
  if (day === today) return { locksAt: endOf(today), writtenLater: false };
  if (day === addDaysToDay(today, -1)) return { locksAt: endOf(today), writtenLater: true };
  return null;
}

export const isLocked = (locksAt: string, now = new Date()) => Date.parse(locksAt) <= now.getTime();

// Pure scheduling rules for org reminders and the admin digest (report §26.5), shared by the jobs and tests.

/** Local date (YYYY-MM-DD) and hour in a zone; an unknown or missing zone counts as UTC. */
export function localClock(now: Date, timeZone?: string | null) {
  let zone = "UTC";
  try {
    if (timeZone) { new Intl.DateTimeFormat("en", { timeZone }); zone = timeZone; }
  } catch { /* fall back to UTC */ }
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "numeric", hourCycle: "h23" }).formatToParts(now);
  const pick = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return { date: `${pick("year")}-${pick("month")}-${pick("day")}`, hour: Number(pick("hour")) };
}

/** The local date one day after `date` (YYYY-MM-DD). */
export function nextDate(date: string) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export const DUE_SOON_HOUR = 9;
export const DIGEST_HOUR = 8;

/** An empty digest is never sent (report §26.10 #10). */
export function digestIsEmpty(digest: { toReview: Array<{ count: number }>; joinRequests: number; behind: number; needsYou: string[] }) {
  return digest.toReview.every((r) => r.count === 0) && digest.joinRequests === 0 && digest.behind === 0 && digest.needsYou.length === 0;
}

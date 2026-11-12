// Natural dates for --due and friends (report C2): "today", "tomorrow", "friday", "next week", "in 3 days",
// "2026-12-01". Read in the person's own time zone; the result is a calendar date (YYYY-MM-DD).

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const iso = (/** @type {Date} */ d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const plus = (/** @type {Date} */ d, /** @type {number} */ days) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);

/**
 * A calendar date for words people type, or null when it isn't one.
 * @param {string} text @param {Date} [now]
 */
export function parseDate(text, now = new Date()) {
  const t = String(text ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    const [y, m, d] = t.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    return date.getMonth() === m - 1 && date.getDate() === d ? t : null;
  }
  if (t === "today" || t === "eod") return iso(now);
  if (t === "tomorrow" || t === "tmrw") return iso(plus(now, 1));
  if (t === "next week") return iso(plus(now, ((8 - now.getDay()) % 7) || 7));
  const inN = /^in (\d{1,3}) (day|days|week|weeks)$/.exec(t);
  if (inN) return iso(plus(now, Number(inN[1]) * (inN[2].startsWith("week") ? 7 : 1)));
  const day = DAYS.findIndex((d) => d === t.replace(/^(next |this )/, "") || d.slice(0, 3) === t.replace(/^(next |this )/, ""));
  if (day >= 0) {
    // "friday" is the coming one (today counts only as "this friday"); "next friday" is the one after.
    const ahead = (day - now.getDay() + 7) % 7;
    const base = t.startsWith("this ") ? ahead : ahead || 7;
    return iso(plus(now, t.startsWith("next ") && ahead !== 0 ? base + 7 : base));
  }
  return null;
}

/**
 * `--due today|week|overdue` (or a date) as the instants the server filters on, in the person's own day (C2).
 * @param {string} word @param {Date} [now] @returns {{ after?: string, before?: string } | null}
 */
export function dueRange(word, now = new Date()) {
  const w = String(word ?? "").trim().toLowerCase();
  if (w === "overdue") return { before: now.toISOString() };
  if (w === "week") return { after: now.toISOString(), before: new Date(now.getTime() + 7 * 86_400_000).toISOString() };
  const date = parseDate(w === "today" ? "today" : w, now);
  if (!date) return null;
  const [y, m, d] = date.split("-").map(Number);
  return { after: new Date(y, m - 1, d).toISOString(), before: new Date(y, m - 1, d + 1).toISOString() };
}

/**
 * A moment for reminders (C2): "tomorrow 9am", "friday 14:30", "in 2 hours", "in 30 minutes", "today 5pm", or a
 * date alone (9:00 that day). Read in the person's time zone; null when it isn't one.
 * @param {string} text @param {Date} [now] @returns {Date | null}
 */
export function parseWhen(text, now = new Date()) {
  const t = String(text ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  const rel = /^in (\d{1,4}) ?(m|min|mins|minute|minutes|h|hr|hrs|hour|hours)$/.exec(t);
  if (rel) return new Date(now.getTime() + Number(rel[1]) * (rel[2].startsWith("h") ? 3_600_000 : 60_000));
  if (!Number.isNaN(Date.parse(t)) && /\d{4}-\d{2}-\d{2}t/.test(t)) return new Date(t.toUpperCase());
  const time = /(?:^|\s)(?:at\s)?(\d{1,2})(?::(\d{2}))?\s?(am|pm)?$/.exec(t);
  const dayPart = time ? t.slice(0, time.index).trim() : t;
  if (time && !time[3] && !time[2] && !dayPart) return null; // a bare number isn't a time
  const day = parseDate(dayPart || "today", now);
  if (!day) return null;
  let hour = time ? Number(time[1]) : 9;
  const minute = time?.[2] ? Number(time[2]) : 0;
  if (time?.[3] === "pm" && hour < 12) hour += 12;
  if (time?.[3] === "am" && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d, hour, minute);
}

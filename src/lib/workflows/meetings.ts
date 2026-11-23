import { DECISIONS_BLOCK_LINE, liveBlockLine } from "@/lib/workspaces/doc-live-blocks";
import { zonedInstant, zonedParts } from "@/lib/workflows/request-clock";

/**
 * Report 38.11 D1 (plan A4.1): meetings are documents in the Meetings section, made from a meeting type, with a date,
 * time, length, attendees and an optional series; Finish makes the next one in the series and carries open action items
 * (the same tasks). Types are data here (as launch presets are); A4.1 ships Blank, A4.3–A4.15 add the others.
 */
export const REPEAT_RULES = ["weekly", "biweekly", "weekdays", "monthly"] as const;
export type RepeatRule = (typeof REPEAT_RULES)[number];
export const REPEAT_LABEL: Record<RepeatRule, string> = { weekly: "Every week", biweekly: "Every 2 weeks", weekdays: "Every weekday", monthly: "Monthly" };

export type MeetingType = { id: string; name: string; line: string; sections: string[]; actionItems: boolean; decisions: boolean };
export const MEETING_TYPES: MeetingType[] = [
  { id: "blank", name: "Blank", line: "Notes and action items.", sections: ["Notes"], actionItems: true, decisions: false },
];
export const meetingType = (id: string) => MEETING_TYPES.find((t) => t.id === id) ?? null;

/** The Action items block's fixed key, so Finish can find a meeting's open rows. */
export const ACTION_ITEMS_KEY = "actions";

/** W1: the meeting document: its title, the type's sections, Decisions and Action items blocks. */
export function meetingMarkdown(type: MeetingType, title: string) {
  const parts = [`# ${title}`, ...type.sections.map((s) => `## ${s}\n`)];
  if (type.decisions) parts.push(`## Decisions\n\n${DECISIONS_BLOCK_LINE}\n`);
  if (type.actionItems) parts.push(`## Action items\n\n${liveBlockLine("task_rows", ACTION_ITEMS_KEY, "Action items")}\n`);
  return `${parts.join("\n\n")}\n`;
}

/** "Weekly · Dec 3" (W1's default title). */
export const defaultTitle = (type: MeetingType, day: string) =>
  `${type.name === "Blank" ? "Meeting" : type.name} · ${new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`;

const addDays = (day: string, n: number) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const lastDayOf = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

/**
 * Part 7: the next meeting's start after `fromIso` by the series rule, at the same local time in the workspace's zone
 * (daylight saving keeps 10:00 at 10:00). Weekdays skip Saturday and Sunday; monthly on the 31st falls on a short
 * month's last day, and `anchorDay` (the series' first day of the month) brings it back afterwards.
 */
export function nextOccurrence(rule: RepeatRule, fromIso: string, tz: string, anchorDay?: number) {
  const { day, time } = zonedParts(new Date(fromIso), tz);
  let next: string;
  if (rule === "weekly") next = addDays(day, 7);
  else if (rule === "biweekly") next = addDays(day, 14);
  else if (rule === "weekdays") {
    next = addDays(day, 1);
    while ([0, 6].includes(new Date(`${next}T00:00:00Z`).getUTCDay())) next = addDays(next, 1);
  } else {
    const [y, m, d] = day.split("-").map(Number) as [number, number, number];
    const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 0 : m;
    next = `${ny}-${String(nm + 1).padStart(2, "0")}-${String(Math.min(anchorDay ?? d, lastDayOf(ny, nm))).padStart(2, "0")}`;
  }
  return zonedInstant(next, time, tz).toISOString();
}

/** W3: during the meeting time the document shows Now. */
export const isNow = (startsAt: string, lengthMinutes: number, now: Date) => {
  const s = Date.parse(startsAt);
  return now.getTime() >= s && now.getTime() < s + lengthMinutes * 60_000;
};

/** W5 and call 3: Finish carries the open action items only (the same tasks, not copies). */
export const carryRows = <T extends { status: string; stage?: string | null }>(rows: T[]) => rows.filter((r) => r.status !== "done" && r.stage !== "cancelled");

/** Settings → Meetings default: 15 minutes before; 0 turns reminders off. */
export const reminderAt = (startsAt: string, minutesBefore: number) => (minutesBefore > 0 ? new Date(Date.parse(startsAt) - minutesBefore * 60_000).toISOString() : null);

/** S2: "Thu 3 Dec · 10:00–10:30 (Asia/Kolkata)". */
export function meetingWhen(startsAt: string, lengthMinutes: number, tz: string) {
  const start = new Date(startsAt), end = new Date(start.getTime() + lengthMinutes * 60_000);
  const day = start.toLocaleDateString("en-GB", { timeZone: tz, weekday: "short", day: "numeric", month: "short" });
  return `${day} · ${zonedParts(start, tz).time}–${zonedParts(end, tz).time} (${tz})`;
}

/** W10: an iCalendar (RFC 5545) feed: one VEVENT per meeting, times in UTC, text escaped, lines folded at 75 octets. */
export function icsCalendar(events: Array<{ uid: string; title: string; startsAt: string; lengthMinutes: number; url: string }>, now = new Date()) {
  const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  // Security review (A4.1b): every line-ending form is escaped and other control characters dropped, so a title
  // (people type it) can never start a new property line in the feed.
  const text = (s: string) =>
    s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r\n|\r|\n/g, "\\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "");
  const fold = (line: string) => {
    const out: string[] = [];
    let rest = line;
    while (Buffer.byteLength(rest, "utf8") > 75) {
      let cut = 75;
      while (Buffer.byteLength(rest.slice(0, cut), "utf8") > 75) cut -= 1;
      out.push(rest.slice(0, cut));
      rest = ` ${rest.slice(cut)}`;
    }
    out.push(rest);
    return out.join("\r\n");
  };
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//NetworkBase//Meetings//EN", "CALSCALE:GREGORIAN", "X-WR-CALNAME:NetworkBase meetings"];
  for (const e of events) {
    const start = new Date(e.startsAt);
    lines.push("BEGIN:VEVENT", `UID:${e.uid}`, `DTSTAMP:${stamp(now)}`, `DTSTART:${stamp(start)}`, `DTEND:${stamp(new Date(start.getTime() + e.lengthMinutes * 60_000))}`,
      `SUMMARY:${text(e.title)}`, `URL:${e.url}`, "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(fold).join("\r\n")}\r\n`;
}

/** S7: the days of a month (Monday first) with the meetings on each, in the workspace's zone. */
export function monthGrid<T extends { startsAt: string | null }>(month: string, meetings: T[], tz: string) {
  const first = new Date(`${month}-01T00:00:00Z`);
  const lead = (first.getUTCDay() + 6) % 7;
  const start = new Date(first.getTime() - lead * 86_400_000);
  const days = Array.from({ length: 42 }, (_, i) => new Date(start.getTime() + i * 86_400_000).toISOString().slice(0, 10));
  const placed = meetings.filter((m) => m.startsAt).map((m) => ({ m, ...zonedParts(new Date(m.startsAt!), tz) })).sort((a, b) => a.m.startsAt!.localeCompare(b.m.startsAt!));
  return days.map((day) => ({ day, inMonth: day.startsWith(month), meetings: placed.filter((p) => p.day === day).map((p) => ({ ...p.m, time: p.time })) }));
}

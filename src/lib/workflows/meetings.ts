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

/**
 * A type's body (report 38.11 W2): its headings in order (with an optional one-line guide under a heading), then the
 * Decisions block and the Action items block (some types name it differently). Standup writes one heading per attendee
 * with its own questions under each.
 */
export type MeetingType = {
  id: string; name: string; line: string; sections: string[]; actionItems: boolean; decisions: boolean;
  actionItemsLabel?: string; perAttendee?: string[]; guide?: Record<string, string>;
};
export const MEETING_TYPES: MeetingType[] = [
  { id: "weekly", name: "Weekly", line: "Agenda, notes, decisions and action items.", sections: ["Agenda", "Notes"], actionItems: true, decisions: true },
  { id: "standup", name: "Standup", line: "Yesterday, today and blockers for each person.", sections: [], perAttendee: ["Yesterday", "Today", "Blockers"], actionItems: false, decisions: false },
  { id: "planning", name: "Planning", line: "The goal, what's in and what's out.", sections: ["Goal", "What's in", "What's out"], actionItems: true, decisions: false },
  { id: "retro", name: "Retrospective", line: "What went well, what needs improvement, ideas.", sections: ["What went well", "What needs improvement", "Ideas"], actionItems: true, decisions: false },
  { id: "kickoff", name: "Kickoff", line: "Why, scope, people, dates and risks.", sections: ["Why", "Scope", "People", "Dates", "Risks"], actionItems: true, decisions: false },
  { id: "client", name: "Client", line: "Agenda, notes and next steps.", sections: ["Agenda", "Notes"], actionItems: true, actionItemsLabel: "Next steps", decisions: false },
  { id: "recording", name: "Recording session", line: "Tech checklist, prep questions and timings.", sections: ["Tech checklist", "Prep questions", "Timings"], actionItems: false, decisions: false },
  { id: "shoot", name: "Shoot day", line: "Call time, location, crew, equipment and shots.", sections: ["Call time", "Location", "Crew and cast", "Equipment", "Shots to get", "Weather and notes"], actionItems: false, decisions: false },
  { id: "interview", name: "User interview", line: "Consent, goal, questions, notes and insights.", sections: ["Participant", "Consent to record", "Research goal", "Questions", "Notes", "Insights"], actionItems: false, decisions: false,
    guide: { "Consent to record": "- [ ] They agreed to be recorded (ask before you start recording)" } },
  { id: "incident", name: "Incident review", line: "Timeline, root cause, actions and lessons.", sections: ["Linked bug", "Timeline", "Root cause", "Lessons"], actionItems: true, actionItemsLabel: "Actions", decisions: false,
    guide: { Timeline: "_Blameless: say what happened and what let it happen, not who._" } },
  { id: "playtest", name: "Playtest", line: "What the tester saw, enjoyed and got stuck on.", sections: ["Build", "Tester", "Minutes played", "What I saw", "Fun moments", "Confusion", "Bugs", "Ideas"], actionItems: false, decisions: false },
  { id: "board", name: "Board meeting", line: "Motions and votes, quorum, minutes to approve.", sections: ["Agenda", "Reports", "Motions", "Minutes"], actionItems: false, decisions: true,
    guide: { Motions: "_Motions and votes are recorded in the panel at the top._" } },
  { id: "supervision", name: "Supervision", line: "A thesis supervision: agenda, notes and action items.", sections: ["Agenda", "Notes"], actionItems: true, decisions: false },
  // B3.5a (report 32.6 call 1): a school's meeting types; line management is a running check-in.
  { id: "department", name: "Department meeting", line: "Agenda, notes, decisions and action items for the department.", sections: ["Agenda", "Notes"], actionItems: true, decisions: true },
  { id: "leadership", name: "Leadership meeting", line: "Agenda, notes, decisions and action items for leaders.", sections: ["Agenda", "Notes"], actionItems: true, decisions: true },
  { id: "line_management", name: "Line management", line: "Since last time, how it's going, goals and next steps.", sections: ["Since last time", "How it's going", "Goals"], actionItems: true, actionItemsLabel: "Next steps", decisions: false },
  { id: "training", name: "Training session", line: "The topic, notes and what I'll try.", sections: ["Topic", "Notes", "What I'll try"], actionItems: false, decisions: false },
  { id: "blank", name: "Blank", line: "Notes and action items.", sections: ["Notes"], actionItems: true, decisions: false },
];
export const meetingType = (id: string) => MEETING_TYPES.find((t) => t.id === id) ?? null;

/** The Action items block's fixed key, so Finish can find a meeting's open rows. */
export const ACTION_ITEMS_KEY = "actions";

/** W1: the meeting document: its title, the type's sections, Decisions and Action items blocks. */
export function meetingMarkdown(type: MeetingType, title: string, attendeeNames: string[] = []) {
  const heading = (h: string) => `## ${h}\n${type.guide?.[h] ? `\n${type.guide[h]}\n` : ""}`;
  const parts = [`# ${title}`, ...type.sections.map(heading)];
  // Standup: one heading per attendee (or one "Everyone" heading when none are picked yet).
  if (type.perAttendee) for (const name of attendeeNames.length ? attendeeNames : ["Everyone"]) parts.push(`## ${name}\n\n${type.perAttendee.map((q) => `**${q}:** `).join("\n\n")}\n`);
  if (type.decisions) parts.push(`## Decisions\n\n${DECISIONS_BLOCK_LINE}\n`);
  const items = type.actionItemsLabel ?? "Action items";
  if (type.actionItems) parts.push(`## ${items}\n\n${liveBlockLine("task_rows", ACTION_ITEMS_KEY, items)}\n`);
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
type IcsEvent = { uid: string; title: string; url: string } & ({ startsAt: string; lengthMinutes: number } | { day: string; endDay: string });
/** B3.1c: an event is timed (startsAt and length) or all-day (day to endDay, inclusive; DTEND is the day after). */
export function icsCalendar(events: IcsEvent[], now = new Date(), name = "NetworkBase") {
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
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//NetworkBase//Meetings//EN", "CALSCALE:GREGORIAN", `X-WR-CALNAME:${text(name)}`];
  const date = (d: string) => d.replace(/-/g, "");
  for (const e of events) {
    const when = "startsAt" in e
      ? [`DTSTART:${stamp(new Date(e.startsAt))}`, `DTEND:${stamp(new Date(new Date(e.startsAt).getTime() + e.lengthMinutes * 60_000))}`]
      : [`DTSTART;VALUE=DATE:${date(e.day)}`, `DTEND;VALUE=DATE:${date(new Date(Date.parse(`${e.endDay}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10))}`];
    lines.push("BEGIN:VEVENT", `UID:${e.uid}`, `DTSTAMP:${stamp(now)}`, ...when, `SUMMARY:${text(e.title)}`, `URL:${e.url}`, "END:VEVENT");
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

/** Report 38.11 call 6 (A4.9): quorum is a majority of the board's size; with no size set, anyone present is enough. */
export const quorum = (boardSize: number | null | undefined, present: number) => {
  const needed = boardSize && boardSize > 0 ? Math.floor(boardSize / 2) + 1 : 1;
  return { needed, met: present >= needed };
};

/** A motion passes with more For than Against (abstentions don't count); a tie fails. */
export const motionResult = (votesFor: number, against: number): "passed" | "failed" => (votesFor > against ? "passed" : "failed");

/** Server rule: the votes recorded can't add up to more people than are marked present. */
export const voteFits = (v: { for: number; against: number; abstain: number }, present: number) => v.for + v.against + v.abstain <= present;

/**
 * Report 38.11 S8 and call 5 (A4.16): Settings → Meetings. Until someone sets them, the types shown follow the workspace
 * category: the common ones everywhere, plus the category's own (from the category sections). Blank is always on.
 */
export const MEETING_LENGTHS = [15, 30, 45, 60, 90, 120] as const;
export const REMINDER_MINUTES = [0, 5, 15, 30] as const;
const COMMON_TYPES = ["weekly", "standup", "planning", "retro", "kickoff", "client", "blank"];
const CATEGORY_TYPES: Record<string, string[]> = {
  startup: ["board", "interview"], nonprofit: ["board"], podcast: ["recording"], video: ["shoot"], web_app: ["interview"],
  tool: ["incident"], open_source: ["incident"], game: ["playtest"], learning: ["supervision"],
  school: ["department", "leadership", "line_management", "training"],
};
export type MeetingSettings = { types: string[]; lengthMinutes: number; reminderMinutes: number };
export function meetingSettings(raw: unknown, category: string | null | undefined): MeetingSettings {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const chosen = Array.isArray(r.types) ? new Set(r.types.filter((t): t is string => typeof t === "string"))
    : new Set([...COMMON_TYPES, ...(CATEGORY_TYPES[category ?? ""] ?? [])]);
  chosen.add("blank");
  return {
    types: MEETING_TYPES.map((t) => t.id).filter((id) => chosen.has(id)),
    lengthMinutes: (MEETING_LENGTHS as readonly number[]).includes(r.lengthMinutes as number) ? (r.lengthMinutes as number) : 30,
    reminderMinutes: (REMINDER_MINUTES as readonly number[]).includes(r.reminderMinutes as number) ? (r.reminderMinutes as number) : 15,
  };
}

import "server-only";

import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { calendarFeedTokens } from "@/lib/db/schema";

// Calendar (report §33.5, "Later"): the person's own due work and the sprints of the places they're in, as a list for
// the Sprints view and as an iCalendar feed behind a private link. Never anyone else's work.

export type CalendarEntry = { id: string; kind: "due" | "sprint"; title: string; start: string; end: string | null; place: string; href: string };

/** The person's entries from 14 days back to 120 days ahead; `projectId` narrows it to one place and its workspaces. */
export async function readCalendarEntries(userId: string, projectId?: string | null): Promise<CalendarEntry[]> {
  const scope = projectId ? sql`AND (p.id = ${projectId}::uuid OR p.parent_id = ${projectId}::uuid)` : sql``;
  const due = await db.execute<{ id: string; title: string; due_date: string; place: string; kind: string; slug: string | null; project_id: string }>(sql`
    SELECT c.id, c.title, c.due_date::text, p.title AS place, p.kind, p.slug, p.id AS project_id FROM tasks c JOIN workspaces p ON p.id = c.workspace_id AND p.deleted_at IS NULL
    WHERE c.deleted_at IS NULL AND c.due_date BETWEEN now() - interval '14 days' AND now() + interval '120 days' AND c.excused_at IS NULL AND c.status <> 'done'
      AND (c.assignee_id = ${userId}::uuid OR EXISTS (SELECT 1 FROM task_team_members tm WHERE tm.task_id = c.id AND tm.user_id = ${userId}::uuid)) ${scope}
    ORDER BY c.due_date LIMIT 300`);
  const sprints = await db.execute<{ id: string; name: string; start_date: string; end_date: string; place: string; kind: string; slug: string | null; project_id: string }>(sql`
    SELECT s.id, s.name, s.start_date::text, s.end_date::text, p.title AS place, p.kind, p.slug, p.id AS project_id FROM workspace_sprints s JOIN workspaces p ON p.id = s.workspace_id AND p.deleted_at IS NULL
    WHERE s.status IN ('planning', 'active') AND s.end_date > now() - interval '14 days' AND s.start_date < now() + interval '120 days'
      AND (p.owner_id = ${userId}::uuid OR EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = p.id AND m.user_id = ${userId}::uuid)) ${scope}
    ORDER BY s.start_date LIMIT 200`);
  const path = (kind: string, slug: string | null, id: string) => `/${kind === "organization" ? "org" : "workspaces"}/${encodeURIComponent(slug ?? id)}`;
  return [
    ...due.map((d) => ({ id: d.id, kind: "due" as const, title: d.title, start: new Date(d.due_date).toISOString(), end: null, place: d.place, href: `${path(d.kind, d.slug, d.project_id)}?tab=tasks&drawerType=task&drawerId=${d.id}` })),
    ...sprints.map((s) => ({ id: s.id, kind: "sprint" as const, title: s.name, start: new Date(s.start_date).toISOString(), end: new Date(s.end_date).toISOString(), place: s.place, href: `${path(s.kind, s.slug, s.project_id)}?tab=sprints&sprintId=${s.id}` })),
  ].sort((a, b) => a.start.localeCompare(b.start));
}

/** The person's private feed token, made on first use; `reset` replaces it so an old link stops working. */
export async function calendarToken(userId: string, reset = false) {
  if (!reset) {
    const [row] = await db.select({ token: calendarFeedTokens.token }).from(calendarFeedTokens).where(eq(calendarFeedTokens.userId, userId)).limit(1);
    if (row) return row.token;
  }
  const token = randomBytes(32).toString("base64url");
  await db.insert(calendarFeedTokens).values({ userId, token }).onConflictDoUpdate({ target: calendarFeedTokens.userId, set: { token, createdAt: new Date() } });
  return token;
}

export async function userForCalendarToken(token: string) {
  if (!/^[A-Za-z0-9_-]{32,64}$/.test(token)) return null;
  const [row] = await db.select({ userId: calendarFeedTokens.userId }).from(calendarFeedTokens).where(eq(calendarFeedTokens.token, token)).limit(1);
  return row?.userId ?? null;
}

// RFC 5545 §3.3.11: backslash, semicolon and comma are escaped, every line break becomes \n, and other control
// characters go, so a title can never start a line or a property of its own.
const icsText = (value: string) => value
  .replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,")
  .replace(/\r\n|\r|\n/g, "\\n")
  .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "");
const icsTime = (iso: string) => iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const icsDay = (iso: string) => iso.slice(0, 10).replace(/-/g, "");

/** iCalendar (RFC 5545): due work as a 15-minute event at its time, sprints as all-day spans. */
export function toIcs(entries: CalendarEntry[], origin: string, now = new Date()) {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//NetworkBase//Calendar//EN", "CALSCALE:GREGORIAN", "X-WR-CALNAME:NetworkBase"];
  for (const e of entries) {
    lines.push("BEGIN:VEVENT", `UID:${e.kind}-${e.id}@networkbase`, `DTSTAMP:${icsTime(now.toISOString())}`);
    if (e.kind === "due") {
      lines.push(`DTSTART:${icsTime(e.start)}`, `DTEND:${icsTime(new Date(new Date(e.start).getTime() + 15 * 60_000).toISOString())}`, `SUMMARY:${icsText(`Due: ${e.title}`)}`);
    } else {
      const end = new Date(new Date(e.end ?? e.start).getTime() + 86_400_000).toISOString();
      lines.push(`DTSTART;VALUE=DATE:${icsDay(e.start)}`, `DTEND;VALUE=DATE:${icsDay(end)}`, `SUMMARY:${icsText(e.title)}`);
    }
    lines.push(`DESCRIPTION:${icsText(e.place)}`, `URL:${origin}${e.href}`, "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  // RFC 5545 §3.1: lines longer than 75 characters continue on the next line after a space.
  const fold = (line: string) => line.length <= 75 ? line : line.match(/.{1,74}/g)!.map((part, i) => (i ? ` ${part}` : part)).join("\r\n");
  return lines.map(fold).join("\r\n") + "\r\n";
}

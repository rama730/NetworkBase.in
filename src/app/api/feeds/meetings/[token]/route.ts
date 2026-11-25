import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { personalSchoolEvents } from "@/lib/organizations/school-events-server";
import { zonedInputToIso } from "@/lib/organizations/zoned-time";
import { icsCalendar } from "@/lib/workflows/meetings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Report 38.11 W10 and call 7 (plan A4.1b): the personal .ics feed. The token is the only key (calendar apps can't sign
 * in), so it holds only this person's meetings, in workspaces they still belong to, as times and titles with a link:
 * no notes, attendees or action items. Leaders-only meetings show only to owners and admins. School events: For me only.
 */
export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return new Response("Not found", { status: 404 });
  const hash = createHash("sha256").update(token).digest("hex");
  const [owner] = Array.from(await db.execute<{ user_id: string }>(sql`SELECT user_id FROM meeting_feed_tokens WHERE token_hash = ${hash}`));
  if (!owner) return new Response("Not found", { status: 404 });
  const rows = Array.from(await db.execute<{ id: string; slug: string; title: string; starts_at: string; length: number | null; ws_slug: string | null; workspace_id: string; finished: boolean }>(sql`
    SELECT d.id, d.slug, coalesce(d.settings->>'meetingTitle', d.filename) AS title, d.settings->>'startsAt' AS starts_at, (d.settings->>'lengthMinutes')::int AS length,
      w.slug AS ws_slug, w.id AS workspace_id, (d.settings ? 'finishedAt') AS finished
    FROM workspace_documents d JOIN workspaces w ON w.id = d.workspace_id AND w.deleted_at IS NULL
    LEFT JOIN workspace_members m ON m.workspace_id = w.id AND m.user_id = ${owner.user_id}::uuid
    WHERE d.settings->>'section' = 'meetings' AND d.settings ? 'startsAt'
      AND d.settings->'attendeeIds' ? ${owner.user_id}
      AND (w.owner_id = ${owner.user_id}::uuid OR m.user_id IS NOT NULL)
      AND (coalesce(d.settings->>'visibilityOverride', 'inherit_workspace') <> 'leaders_only' OR w.owner_id = ${owner.user_id}::uuid OR m.role = 'admin')
      AND (d.settings->>'startsAt')::timestamptz > now() - interval '60 days'
    ORDER BY d.settings->>'startsAt' LIMIT 500`));
  // The public site, as llms.txt links it (behind the proxy the request's own host may be internal).
  const origin = "https://networkbase.in";
  // B3.1c (report 32.2 call 7): the same link carries the school events meant for this person (school plus classes).
  const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  const school = await personalSchoolEvents(owner.user_id, day(-30), day(180));
  const body = icsCalendar([
    ...rows.map((r) => ({ uid: `${r.id}@networkbase`, title: r.title.replace(/\.md$/i, ""), startsAt: r.starts_at, lengthMinutes: r.length ?? 30,
      url: `${origin}/workspaces/${encodeURIComponent(r.ws_slug || r.workspace_id)}?tab=docs&doc=${encodeURIComponent(r.slug)}` })),
    ...school.map((e) => ({ uid: `${e.id}-${e.day}@networkbase`, title: e.title, url: `${origin}/org/${encodeURIComponent(e.orgSlug ?? "")}?tab=sprints`,
      ...(e.time ? { startsAt: zonedInputToIso(`${e.day}T${e.time}`, e.zone), lengthMinutes: 60 } : { day: e.day, endDay: e.day }) })),
  ]);
  return new Response(body, { headers: { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "private, max-age=300", "X-Robots-Tag": "noindex" } });
}

import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { createNotification } from "@/lib/notifications/service";

// Report 37.3 (plan B8.1b): volunteer notices from the hourly job. Server only (a "use server" export would be callable).
const tell = (orgId: string, slug: string, to: string, title: string, key: string) =>
  createNotification({ recipientUserId: to, actorUserId: null, kind: "project_task_activity", category: "tasks", importance: "more", title, href: `/org/${encodeURIComponent(slug)}`,
    entityRefs: { projectId: orgId, projectSlug: slug }, dedupeKey: key }).catch(() => undefined);

/**
 * Hourly (layer 15): a reminder the day before a shift to everyone going (Normal); a shift still short 2 days before tells
 * the coordinators (Normal), who can Ask.
 */
export async function volunteerNotices(now = new Date()) {
  const day = Array.from(await db.execute<{ id: string; org: string; slug: string | null; title: string; start: string }>(sql`
    SELECT t.id, t.workspace_id AS org, w.slug, t.title, t.type_fields->>'start' AS start FROM tasks t JOIN workspaces w ON w.id = t.workspace_id AND w.deleted_at IS NULL AND w.org_type = 'other'
    WHERE t.item_type = 'event' AND t.type_fields->>'kind' = 'shift' AND t.deleted_at IS NULL AND t.stage <> 'cancelled'
      AND (t.type_fields->>'start')::timestamptz BETWEEN ${now.toISOString()}::timestamptz + interval '23 hours' AND ${now.toISOString()}::timestamptz + interval '25 hours' LIMIT 500`));
  let sent = 0;
  for (const s of day) {
    const going = Array.from(await db.execute<{ id: string }>(sql`SELECT user_id AS id FROM community_rsvps WHERE task_id = ${s.id}::uuid AND state = 'going'`));
    for (const g of going) { await tell(s.org, s.slug ?? s.org, g.id, `Reminder: ${s.title} tomorrow, ${new Date(s.start).toUTCString().slice(17, 22)} UTC`, `volunteer-reminder:${s.id}:${g.id}`); sent++; }
  }
  const short = Array.from(await db.execute<{ id: string; org: string; slug: string | null; title: string; left: number }>(sql`
    SELECT t.id, t.workspace_id AS org, w.slug, t.title, e.place_limit - (SELECT count(*)::int FROM community_rsvps r WHERE r.task_id = t.id AND r.state = 'going') AS left
    FROM tasks t JOIN community_events e ON e.task_id = t.id JOIN workspaces w ON w.id = t.workspace_id AND w.deleted_at IS NULL AND w.org_type = 'other'
    WHERE t.item_type = 'event' AND t.type_fields->>'kind' = 'shift' AND t.deleted_at IS NULL AND t.stage <> 'cancelled'
      AND (t.type_fields->>'start')::timestamptz BETWEEN ${now.toISOString()}::timestamptz + interval '47 hours' AND ${now.toISOString()}::timestamptz + interval '49 hours' LIMIT 500`));
  for (const s of short.filter((x) => x.left > 0)) {
    const coordinators = Array.from(await db.execute<{ id: string }>(sql`SELECT user_id AS id FROM workspace_members WHERE workspace_id = ${s.org}::uuid AND role IN ('owner', 'admin') AND completed_at IS NULL LIMIT 20`));
    for (const c of coordinators) { await tell(s.org, s.slug ?? s.org, c.id, `Short: ${s.title} in 2 days needs ${s.left} more`, `volunteer-short:${s.id}:${c.id}`); sent++; }
  }
  return { sent };
}

import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { createNotification } from "@/lib/notifications/service";
import { addDays, readFixedTime } from "@/lib/organizations/fixed-time";

// Report 37.4 (plan B8.2b): fixed-time notices from the hourly job. Server only (a "use server" export would be callable).

/**
 * Hourly: a booking still not confirmed 14 days before the key date tells its owner once (Normal); from the end date the
 * owner is asked "Close the team?" once a week (Normal) — it never closes on its own.
 */
export async function fixedTimeNotices(now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const orgs = Array.from(await db.execute<{ id: string; slug: string | null; title: string; owner: string; settings: unknown }>(sql`
    SELECT id, slug, title, owner_id AS owner, org_settings AS settings FROM workspaces WHERE kind = 'organization' AND deleted_at IS NULL AND status <> 'archived' AND org_settings ? 'fixedTime'
      AND (org_type <> 'other' OR coalesce(org_settings->'parts'->'on', '[]'::jsonb) ? 'fixedTime') LIMIT 500`));
  let sent = 0;
  for (const o of orgs) {
    const f = readFixedTime(o.settings);
    if (!f) continue;
    if (today >= f.endDate) {
      const week = Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${f.endDate}T00:00:00Z`)) / (7 * 86_400_000));
      await createNotification({ recipientUserId: o.owner, actorUserId: null, kind: "project_task_activity", category: "tasks", importance: "more", title: `${o.title} has ended. Close the team?`,
        href: `/org/${encodeURIComponent(o.slug ?? o.id)}`, entityRefs: { projectId: o.id, projectSlug: o.slug ?? o.id }, dedupeKey: `fixed-time-close:${o.id}:${f.endDate}:${week}` }).catch(() => undefined);
      sent++;
      continue;
    }
    if (addDays(f.keyDate, -14) > today || f.keyDate < today) continue;
    const open = Array.from(await db.execute<{ id: string; title: string; owner: string | null }>(sql`
      SELECT id, title, coalesce(assignee_id, creator_id) AS owner FROM tasks WHERE workspace_id = ${o.id}::uuid AND deleted_at IS NULL AND type_fields ? 'booking'
        AND type_fields->'booking'->>'state' IN ('to_book', 'applied') LIMIT 100`));
    for (const b of open) {
      if (!b.owner) continue;
      await createNotification({ recipientUserId: b.owner, actorUserId: null, kind: "project_task_activity", category: "tasks", importance: "more", title: `Booking not confirmed yet: ${b.title}`,
        href: `/org/${encodeURIComponent(o.slug ?? o.id)}`, entityRefs: { projectId: o.id, projectSlug: o.slug ?? o.id }, dedupeKey: `fixed-time-booking:${b.id}` }).catch(() => undefined);
      sent++;
    }
  }
  return { sent };
}

import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { createNotification } from "@/lib/notifications/service";
import { todayInZone } from "@/lib/organizations/zoned-time";

/**
 * Report 33.2 layer 15 (B4.1): "2 handbook pages need review" in each page owner's weekly Summary — Monday morning
 * in the organization's time zone, once a week (dedupe key). Only owners still in the organization; pages never hide.
 */
export async function notifyHandbookReview(now = new Date()) {
  const rows = Array.from(await db.execute<{ org: string; slug: string | null; zone: string | null; owner: string; review_by: string }>(sql`
    SELECT d.workspace_id AS org, w.slug, w.time_zone AS zone, d.settings->'org'->>'owner' AS owner, d.settings->'org'->>'reviewBy' AS review_by
    FROM workspace_documents d JOIN workspaces w ON w.id = d.workspace_id
    WHERE w.kind = 'organization' AND w.deleted_at IS NULL AND w.status <> 'archived'
      AND d.settings->'org'->>'owner' IS NOT NULL AND d.settings->'org'->>'reviewBy' <= to_char(now() + interval '1 day', 'YYYY-MM-DD')
      AND (d.settings->'org'->>'owner' = w.owner_id::text OR EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = w.id AND m.user_id::text = d.settings->'org'->>'owner' AND m.role <> 'viewer'))
    LIMIT 5000`));
  const due = new Map<string, { org: string; slug: string | null; owner: string; monday: string; n: number }>();
  for (const r of rows) {
    const today = todayInZone(r.zone, now);
    const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: r.zone || "UTC", hour: "2-digit", hourCycle: "h23" }).format(now));
    // ponytail: Monday 9–11 AM (three hourly runs; the dedupe key holds), the weekly Summary's moment.
    if (new Date(`${today}T00:00:00Z`).getUTCDay() !== 1 || hour < 9 || hour > 11 || r.review_by > today) continue;
    const key = `${r.org}:${r.owner}`;
    const entry = due.get(key) ?? { org: r.org, slug: r.slug, owner: r.owner, monday: today, n: 0 };
    entry.n += 1;
    due.set(key, entry);
  }
  let sent = 0;
  for (const e of due.values()) {
    await createNotification({ recipientUserId: e.owner, actorUserId: null, kind: "project_task_activity", category: "tasks", importance: "more",
      title: `${e.n} handbook ${e.n === 1 ? "page needs" : "pages need"} review`, href: `/org/${encodeURIComponent(e.slug || e.org)}?tab=docs`,
      entityRefs: { projectId: e.org, projectSlug: e.slug }, dedupeKey: `handbook-review:${e.org}:${e.owner}:${e.monday}` })
      .then(() => { sent += 1; }).catch((error) => logger.error("handbook.review_summary_failed", { error: error instanceof Error ? error.message : String(error) }));
  }
  return { sent };
}

import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { createNotification } from "@/lib/notifications/service";
import { checkInDue, goalSettings } from "@/lib/workflows/goals";
import { zonedParts } from "@/lib/workflows/request-clock";

/**
 * Report 38.12 W4 and part 8 (plan A5.1b): on each workspace's check-in day, from 09:00 its time, everyone with key
 * results due gets one "Check in on 3 key results" (Normal, our Important level), once that day. Runs in the hourly job.
 */
export async function notifyGoalCheckIns(now = new Date()) {
  const rows = Array.from(await db.execute<{ workspace_id: string; ws_slug: string | null; tz: string | null; goals: unknown; doc_slug: string; assignee_id: string; checked: string | null }>(sql`
    SELECT t.workspace_id, w.slug AS ws_slug, w.time_zone AS tz, w.workflow_settings->'goals' AS goals, d.slug AS doc_slug, t.assignee_id, t.type_fields->>'checkedInAt' AS checked
    FROM tasks t
    JOIN workspace_documents d ON d.id = t.source_doc_id
    JOIN workspaces w ON w.id = t.workspace_id AND w.deleted_at IS NULL
    WHERE t.item_type = 'key_result' AND t.stage = 'active' AND t.deleted_at IS NULL AND t.assignee_id IS NOT NULL
      AND NOT (d.settings ? 'closedAt')
      AND (t.assignee_id = w.owner_id OR EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = w.id AND m.user_id = t.assignee_id))
    LIMIT 5000`));
  const groups = new Map<string, { ws: string; slug: string; doc: string; user: string; today: string; n: number }>();
  for (const r of rows) {
    const tz = r.tz || "UTC";
    const { day, time } = zonedParts(now, tz);
    const iso = ((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
    const settings = goalSettings(r.goals);
    if (iso !== settings.checkInDay || time < "09:00" || !checkInDue(r.checked, day, settings.checkInDay, tz)) continue;
    const key = `${r.workspace_id}:${r.assignee_id}`;
    const g = groups.get(key) ?? { ws: r.workspace_id, slug: r.ws_slug || r.workspace_id, doc: r.doc_slug, user: r.assignee_id, today: day, n: 0 };
    g.n += 1;
    groups.set(key, g);
  }
  let sent = 0;
  for (const g of groups.values()) {
    await createNotification({
      recipientUserId: g.user, actorUserId: null, kind: "project_task_activity", category: "tasks", importance: "important",
      title: `Check in on ${g.n} key ${g.n === 1 ? "result" : "results"}`,
      href: `/workspaces/${encodeURIComponent(g.slug)}?tab=docs&doc=${encodeURIComponent(g.doc)}`,
      entityRefs: { projectId: g.ws, projectSlug: g.slug }, dedupeKey: `goal-checkin:${g.ws}:${g.user}:${g.today}`,
    }).then(() => { sent += 1; }).catch((error) => logger.error("goals.checkin_notice_failed", { error: error instanceof Error ? error.message : String(error) }));
  }
  return { sent };
}

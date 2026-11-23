import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { createNotification } from "@/lib/notifications/service";
import { checkInDue, goalSettings, periodLabel, periodRange } from "@/lib/workflows/goals";
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

/** Report 38.12 part 8 (A5.2): "Q1 2027 goals close in 7 days" to the owner and admins (Summary), once per document. */
export async function notifyGoalsClosingSoon(now = new Date()) {
  const docs = Array.from(await db.execute<{ id: string; slug: string; period: string; workspace_id: string; ws_slug: string | null; tz: string | null; goals: unknown; owner_id: string }>(sql`
    SELECT d.id, d.slug, d.settings->>'period' AS period, d.workspace_id, w.slug AS ws_slug, w.time_zone AS tz, w.workflow_settings->'goals' AS goals, w.owner_id
    FROM workspace_documents d JOIN workspaces w ON w.id = d.workspace_id AND w.deleted_at IS NULL
    WHERE d.settings->>'section' = 'goals' AND d.settings ? 'period' AND NOT (d.settings ? 'closedAt') LIMIT 2000`));
  let sent = 0;
  for (const d of docs) {
    let end: string;
    try { end = periodRange(d.period, goalSettings(d.goals)).end; } catch { continue; }
    const today = zonedParts(now, d.tz || "UTC").day;
    const days = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
    if (days !== 7) continue;
    const admins = Array.from(await db.execute<{ user_id: string }>(sql`SELECT user_id FROM workspace_members WHERE workspace_id = ${d.workspace_id}::uuid AND role = 'admin'`)).map((r) => r.user_id);
    for (const user of new Set([d.owner_id, ...admins])) {
      await createNotification({
        recipientUserId: user, actorUserId: null, kind: "project_task_activity", category: "tasks", importance: "more",
        title: `${periodLabel(d.period)} goals close in 7 days`,
        href: `/workspaces/${encodeURIComponent(d.ws_slug || d.workspace_id)}?tab=docs&doc=${encodeURIComponent(d.slug)}`,
        entityRefs: { projectId: d.workspace_id, projectSlug: d.ws_slug }, dedupeKey: `goals-closing:${d.id}:${user}`,
      }).then(() => { sent += 1; }).catch(() => undefined);
    }
  }
  return { sent };
}

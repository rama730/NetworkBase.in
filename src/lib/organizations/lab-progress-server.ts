import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { createNotification } from "@/lib/notifications/service";
import { milestoneNotices, supervisionRhythm, type MilestoneState } from "@/lib/organizations/lab-progress";

// Report 35.6 (plan B6.5b, layer 15): hourly notices for supervision and milestones, each claimed once. Server only.

async function tell(to: string[], title: string, slug: string, orgId: string, key: string) {
  for (const u of new Set(to)) {
    await createNotification({ recipientUserId: u, actorUserId: null, kind: "project_task_activity", category: "tasks", importance: "more", title,
      href: `/org/${encodeURIComponent(slug)}`, entityRefs: { projectId: orgId, projectSlug: slug }, dedupeKey: `${key}:${u}` }).catch(() => undefined);
  }
}

export async function progressNotices(now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  let sent = 0;
  // Supervision due: a week past the rhythm, to the person and their supervisors (the PI when none is named), once per gap.
  const people = Array.from(await db.execute<{ org: string; slug: string | null; owner: string; user_id: string; name: string; start: string; weeks: number; co: string | null; sup: string | null; last: string | null }>(sql`
    SELECT lp.org_id AS org, o.slug, o.owner_id AS owner, lp.user_id, coalesce(p.full_name, p.username, 'Someone') AS name, lp.start_date::text AS start, lp.supervision_weeks AS weeks,
      lp.co_supervisor_id AS co, o.org_settings->'staffGrowth'->'reportsTo'->>lp.user_id::text AS sup,
      (SELECT max(met_on)::text FROM lab_supervision_notes n WHERE n.org_id = lp.org_id AND n.student_id = lp.user_id) AS last
    FROM lab_progress lp JOIN workspaces o ON o.id = lp.org_id AND o.org_type = 'research' AND o.deleted_at IS NULL AND o.suspended_at IS NULL AND o.status <> 'archived'
      JOIN workspace_members m ON m.workspace_id = lp.org_id AND m.user_id = lp.user_id AND m.completed_at IS NULL JOIN profiles p ON p.id = lp.user_id
    WHERE lp.supervision_notice_at IS NULL LIMIT 2000`));
  for (const r of people) {
    if (!supervisionRhythm(r.last, r.start, r.weeks, today).overdue) continue;
    const [claimed] = Array.from(await db.execute<{ ok: number }>(sql`UPDATE lab_progress SET supervision_notice_at = now() WHERE org_id = ${r.org}::uuid AND user_id = ${r.user_id}::uuid AND supervision_notice_at IS NULL RETURNING 1 AS ok`));
    if (!claimed) continue;
    const sup = r.sup ?? r.owner;
    await tell([r.user_id], "Your supervision is due: book a time with your supervisor", r.slug ?? r.org, r.org, `lab-sup-due:${r.org}:${r.user_id}:${today}`);
    await tell([sup, ...(r.co ? [r.co] : [])].filter((u) => u !== r.user_id), `Supervision with ${r.name} is due`, r.slug ?? r.org, r.org, `lab-sup-due:${r.org}:${r.user_id}:${today}`);
    sent++;
  }
  // Milestones due in 30 and 7 days: to the person and their supervisor.
  const ms = Array.from(await db.execute<{ org: string; slug: string | null; owner: string; user_id: string; key: string; name: string; due_on: string; state: MilestoneState; n30: string | null; n7: string | null; sup: string | null; co: string | null }>(sql`
    SELECT x.org_id AS org, o.slug, o.owner_id AS owner, x.user_id, x.key, x.name, x.due_on::text, x.state, x.notice_30_at::text AS n30, x.notice_7_at::text AS n7,
      o.org_settings->'staffGrowth'->'reportsTo'->>x.user_id::text AS sup, lp.co_supervisor_id AS co
    FROM lab_milestones x JOIN workspaces o ON o.id = x.org_id AND o.org_type = 'research' AND o.deleted_at IS NULL AND o.suspended_at IS NULL AND o.status <> 'archived'
      JOIN workspace_members m ON m.workspace_id = x.org_id AND m.user_id = x.user_id AND m.completed_at IS NULL LEFT JOIN lab_progress lp ON lp.org_id = x.org_id AND lp.user_id = x.user_id
    WHERE x.state <> 'done' AND x.due_on BETWEEN ${today}::date AND ${today}::date + 30 LIMIT 2000`));
  for (const m of ms) {
    const due = milestoneNotices({ dueOn: m.due_on, state: m.state, notice30At: m.n30, notice7At: m.n7 }, today);
    const col = due.d7 ? "notice_7_at" : due.d30 ? "notice_30_at" : null;
    if (!col) continue;
    const [claimed] = Array.from(await db.execute<{ ok: number }>(sql`UPDATE lab_milestones SET ${sql.raw(col)} = now() WHERE org_id = ${m.org}::uuid AND user_id = ${m.user_id}::uuid AND key = ${m.key}
      AND ${sql.raw(col)} IS NULL RETURNING 1 AS ok`));
    if (!claimed) continue;
    const when = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${m.due_on}T00:00:00Z`));
    await tell([m.user_id, m.sup ?? m.owner, ...(m.co ? [m.co] : [])], `${m.name} is due on ${when}`, m.slug ?? m.org, m.org, `lab-ms:${m.org}:${m.user_id}:${m.key}:${col}`);
    sent++;
  }
  return { sent };
}

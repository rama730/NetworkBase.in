import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { notifyOrg, orgHref } from "@/lib/organizations/notify";
import { readSprintMaterials } from "@/lib/organizations/sprints";

// Org sprint notices (report §26 C). Best effort: a failed notice never fails the sprint change.

type Org = { id: string; title: string; slug: string | null; settings: unknown; parentId: string | null; kind: string | null };

async function projectOf(projectId: string): Promise<Org | null> {
  const [row] = await db.execute<{ id: string; title: string | null; slug: string | null; settings: unknown; parent_id: string | null; kind: string | null }>(sql`
    SELECT id, title, slug, org_settings AS settings, parent_id, kind FROM projects WHERE id = ${projectId} AND deleted_at IS NULL`);
  return row ? { id: row.id, title: row.title || "Organization", slug: row.slug, settings: row.settings, parentId: row.parent_id, kind: row.kind } : null;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

async function safely(label: string, work: () => Promise<unknown>) {
  try { await work(); } catch (error) { logger.warn("org_sprint_notice.failed", { module: "notifications", label, error: error instanceof Error ? error.message : String(error) }); }
}

/** Started: members hear "CO1 started · 3 assignments · 2 materials" (Notify on start, on by default); leads without a linked sprint hear to plan one. */
export function notifyOrgSprintStarted(sprintId: string, projectId: string, actorId: string | null) {
  return safely("started", async () => {
    const org = await projectOf(projectId);
    if (!org || org.kind !== "organization") return;
    const [sprint] = await db.execute<{ name: string; assignments: number }>(sql`
      SELECT s.name, (SELECT count(*)::int FROM tasks m WHERE m.sprint_id = s.id AND m.kind = 'assignment' AND m.deleted_at IS NULL
        AND m.assignment_settings->>'publishedAt' IS NOT NULL) AS assignments
      FROM project_sprints s WHERE s.id = ${sprintId}`);
    if (!sprint) return;
    const href = orgHref(org, "?tab=sprints");
    if ((org.settings as { sprintNotifyOnStart?: unknown } | null)?.sprintNotifyOnStart !== false) {
      const materials = (await readSprintMaterials(sprintId)).length;
      const parts = [sprint.assignments ? plural(sprint.assignments, "assignment") : null, materials ? plural(materials, "material") : null].filter(Boolean);
      await notifyOrg({ orgId: org.id, eventKey: "org_sprints.started", actorId, title: [`${sprint.name} started`, ...parts].join(" · "), href, sourceEventId: `sprint-started:${sprintId}` });
    }
    const leads = await db.execute<{ owner_id: string; title: string; slug: string | null; id: string }>(sql`
      SELECT p.owner_id, p.title, p.slug, p.id FROM projects p
      WHERE p.parent_id = ${org.id} AND p.deleted_at IS NULL AND p.status <> 'archived'
        AND NOT EXISTS (SELECT 1 FROM project_sprints c WHERE c.project_id = p.id AND c.parent_sprint_id = ${sprintId})`);
    for (const lead of leads) {
      await notifyOrg({ orgId: org.id, eventKey: "org_sprints.notice", actorId, to: [lead.owner_id], title: `${sprint.name} started. Plan your sprint in ${lead.title}`,
        href: `/projects/${encodeURIComponent(lead.slug ?? lead.id)}?tab=sprints`, sourceEventId: `sprint-plan:${sprintId}:${lead.id}` });
    }
  });
}

/** Closed: each member hears how much of the sprint's work they finished ("CO1 closed · you completed 3 of 3"). */
export async function notifyOrgSprintCompleted(sprintId: string, projectId: string, actorId: string | null): Promise<boolean> {
  const org = await projectOf(projectId).catch(() => null);
  if (!org || org.kind !== "organization") return false;
  await safely("completed", async () => {
    const [sprint] = await db.execute<{ name: string }>(sql`SELECT name FROM project_sprints WHERE id = ${sprintId}`);
    if (!sprint) return;
    // Per person: their own copies and their team's, of the assignments in this sprint.
    const counts = await db.execute<{ user_id: string; done: number; total: number }>(sql`
      SELECT pm.user_id, count(c.id) FILTER (WHERE c.status = 'done')::int AS done, count(c.id)::int AS total
      FROM project_members pm
      LEFT JOIN tasks c ON c.deleted_at IS NULL AND c.excused_at IS NULL
        AND c.assignment_id IN (SELECT m.id FROM tasks m WHERE m.sprint_id = ${sprintId} AND m.kind = 'assignment' AND m.deleted_at IS NULL)
        AND (c.assignee_id = pm.user_id OR EXISTS (SELECT 1 FROM task_team_members tm WHERE tm.task_id = c.id AND tm.user_id = pm.user_id))
      WHERE pm.project_id = ${org.id}
      GROUP BY pm.user_id`);
    // One notice per distinct line, so 2,000 members are a handful of fan-outs.
    const groups = new Map<string, string[]>();
    for (const row of counts) {
      const line = row.total ? `${sprint.name} closed · you completed ${row.done} of ${row.total}` : `${sprint.name} closed`;
      groups.set(line, [...(groups.get(line) ?? []), row.user_id]);
    }
    let i = 0;
    for (const [title, to] of groups) {
      await notifyOrg({ orgId: org.id, eventKey: "org_sprints.completed", actorId, to, title, href: orgHref(org, "?tab=sprints"), sourceEventId: `sprint-closed:${sprintId}:${i++}` });
    }
  });
  return true;
}

/** Dates changed: leads whose linked sprint now falls outside hear "Your sprint is outside CO1's new dates". */
export function notifyLinkedSprintsOutside(sprintId: string, projectId: string, actorId: string | null) {
  return safely("dates", async () => {
    const org = await projectOf(projectId);
    if (!org || org.kind !== "organization") return;
    const rows = await db.execute<{ id: string; name: string; parent: string; owner_id: string; slug: string | null; project_id: string; stamp: string }>(sql`
      SELECT c.id, c.name, o.name AS parent, p.owner_id, p.slug, p.id AS project_id, o.updated_at::text AS stamp
      FROM project_sprints o JOIN project_sprints c ON c.parent_sprint_id = o.id AND c.status <> 'completed'
      JOIN projects p ON p.id = c.project_id AND p.deleted_at IS NULL
      WHERE o.id = ${sprintId} AND (c.start_date < o.start_date OR c.end_date > o.end_date)`);
    for (const r of rows) {
      await notifyOrg({ orgId: org.id, eventKey: "org_sprints.notice", actorId, to: [r.owner_id], title: `Your sprint ${r.name} is outside ${r.parent}'s new dates`,
        href: `/projects/${encodeURIComponent(r.slug ?? r.project_id)}?tab=sprints`, sourceEventId: `sprint-outside:${r.id}:${r.stamp}` });
    }
  });
}

/** Auto-start blocked by an active sprint: admins hear once ("CO2 couldn't start: CO1 is still active"). */
export function notifyOrgSprintBlocked(sprintId: string, projectId: string) {
  return safely("blocked", async () => {
    const org = await projectOf(projectId);
    if (!org || org.kind !== "organization") return;
    const [row] = await db.execute<{ name: string; active: string }>(sql`
      SELECT s.name, a.name AS active FROM project_sprints s JOIN project_sprints a ON a.project_id = s.project_id AND a.status = 'active'
      WHERE s.id = ${sprintId} LIMIT 1`);
    if (!row) return;
    const admins = await db.execute<{ user_id: string }>(sql`
      SELECT owner_id AS user_id FROM projects WHERE id = ${org.id}
      UNION SELECT user_id FROM project_members WHERE project_id = ${org.id} AND role IN ('owner', 'admin')`);
    await notifyOrg({ orgId: org.id, eventKey: "org_sprints.notice", to: admins.map((a) => a.user_id), title: `${row.name} couldn't start: ${row.active} is still active`,
      href: orgHref(org, "?tab=sprints"), sourceEventId: `sprint-blocked:${sprintId}` });
  });
}

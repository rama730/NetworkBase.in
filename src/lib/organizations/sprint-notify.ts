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
    SELECT id, title, slug, org_settings AS settings, parent_id, kind FROM workspaces WHERE id = ${projectId} AND deleted_at IS NULL`);
  return row ? { id: row.id, title: row.title || "Organization", slug: row.slug, settings: row.settings, parentId: row.parent_id, kind: row.kind } : null;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

async function safely(label: string, work: () => Promise<unknown>) {
  try { await work(); } catch (error) { logger.warn("org_sprint_notice.failed", { module: "notifications", label, error: error instanceof Error ? error.message : String(error) }); }
}

/** Started: members hear "CO1 started · 3 assignments · 2 materials" when the sprint's Notify is on; leads without a linked sprint hear to plan one. */
export function notifyOrgSprintStarted(sprintId: string, projectId: string, actorId: string | null) {
  return safely("started", async () => {
    const org = await projectOf(projectId);
    if (!org || org.kind !== "organization") return;
    const [sprint] = await db.execute<{ name: string; notify: boolean; assignments: number }>(sql`
      SELECT s.name, s.notify_on_start AS notify, (SELECT count(*)::int FROM tasks m WHERE m.sprint_id = s.id AND m.kind = 'assignment' AND m.deleted_at IS NULL
        AND m.assignment_settings->>'publishedAt' IS NOT NULL) AS assignments
      FROM workspace_sprints s WHERE s.id = ${sprintId}`);
    if (!sprint) return;
    const href = orgHref(org, "?tab=sprints");
    if (sprint.notify) {
      const materials = (await readSprintMaterials(sprintId)).length;
      const parts = [sprint.assignments ? plural(sprint.assignments, "assignment") : null, materials ? plural(materials, "material") : null].filter(Boolean);
      await notifyOrg({ orgId: org.id, eventKey: "org_sprints.started", actorId, title: [`${sprint.name} started`, ...parts].join(" · "), href, sourceEventId: `sprint-started:${sprintId}` });
    }
    const leads = await db.execute<{ owner_id: string; title: string; slug: string | null; id: string }>(sql`
      SELECT p.owner_id, p.title, p.slug, p.id FROM workspaces p
      WHERE p.parent_id = ${org.id} AND p.deleted_at IS NULL AND p.status <> 'archived'
        AND NOT EXISTS (SELECT 1 FROM workspace_sprints c WHERE c.workspace_id = p.id AND c.parent_sprint_id = ${sprintId})`);
    for (const lead of leads) {
      await notifyOrg({ orgId: org.id, eventKey: "org_sprints.notice", actorId, to: [lead.owner_id], title: `${sprint.name} started. Plan your sprint in ${lead.title}`,
        href: `/workspaces/${encodeURIComponent(lead.slug ?? lead.id)}?tab=sprints`, sourceEventId: `sprint-plan:${sprintId}:${lead.id}` });
    }
  });
}

/** Closed: each member hears how much of the sprint's work they finished ("CO1 closed · you completed 3 of 3"). */
export async function notifyOrgSprintCompleted(sprintId: string, projectId: string, actorId: string | null): Promise<boolean> {
  const org = await projectOf(projectId).catch(() => null);
  if (!org || org.kind !== "organization") return false;
  await safely("completed", async () => {
    const [sprint] = await db.execute<{ name: string }>(sql`SELECT name FROM workspace_sprints WHERE id = ${sprintId}`);
    if (!sprint) return;
    // Per person: their own copies and their team's, of the assignments in this sprint.
    const counts = await db.execute<{ user_id: string; done: number; total: number }>(sql`
      SELECT pm.user_id, count(c.id) FILTER (WHERE c.status = 'done')::int AS done, count(c.id)::int AS total
      FROM workspace_members pm
      LEFT JOIN tasks c ON c.deleted_at IS NULL AND c.excused_at IS NULL
        AND c.assignment_id IN (SELECT m.id FROM tasks m WHERE m.sprint_id = ${sprintId} AND m.kind = 'assignment' AND m.deleted_at IS NULL)
        AND (c.assignee_id = pm.user_id OR EXISTS (SELECT 1 FROM task_team_members tm WHERE tm.task_id = c.id AND tm.user_id = pm.user_id))
      WHERE pm.workspace_id = ${org.id}
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
      FROM workspace_sprints o JOIN workspace_sprints c ON c.parent_sprint_id = o.id AND c.status <> 'completed'
      JOIN workspaces p ON p.id = c.workspace_id AND p.deleted_at IS NULL
      WHERE o.id = ${sprintId} AND (c.start_date < o.start_date OR c.end_date > o.end_date)`);
    for (const r of rows) {
      await notifyOrg({ orgId: org.id, eventKey: "org_sprints.notice", actorId, to: [r.owner_id], title: `Your sprint ${r.name} is outside ${r.parent}'s new dates`,
        href: `/workspaces/${encodeURIComponent(r.slug ?? r.project_id)}?tab=sprints`, sourceEventId: `sprint-outside:${r.id}:${r.stamp}` });
    }
  });
}

/** Auto-start blocked by an active sprint: admins hear once ("CO2 couldn't start: CO1 is still active"). */
export function notifyOrgSprintBlocked(sprintId: string, projectId: string) {
  return safely("blocked", async () => {
    const org = await projectOf(projectId);
    if (!org || org.kind !== "organization") return;
    const [row] = await db.execute<{ name: string; active: string }>(sql`
      SELECT s.name, a.name AS active FROM workspace_sprints s JOIN workspace_sprints a ON a.workspace_id = s.workspace_id AND a.status = 'active'
      WHERE s.id = ${sprintId} LIMIT 1`);
    if (!row) return;
    const admins = await db.execute<{ user_id: string }>(sql`
      SELECT owner_id AS user_id FROM workspaces WHERE id = ${org.id}
      UNION SELECT user_id FROM workspace_members WHERE workspace_id = ${org.id} AND role IN ('owner', 'admin')`);
    await notifyOrg({ orgId: org.id, eventKey: "org_sprints.notice", to: admins.map((a) => a.user_id), title: `${row.name} couldn’t start: ${row.active} is still active`,
      href: orgHref(org, "?tab=sprints"), sourceEventId: `sprint-blocked:${sprintId}` });
  });
}

type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/** A new org sprint's "Notify members when it starts", from the org's Work default (report §21); on otherwise. */
export async function orgSprintNotifyDefault(executor: Executor, projectId: string) {
  const [row] = await executor.execute<{ value: unknown }>(sql`SELECT org_settings->'sprintNotifyOnStart' AS value FROM workspaces WHERE id = ${projectId}`);
  return row?.value !== false;
}

export type LinkedChildSprint = { sprintName: string; ownerId: string; projectId: string; slug: string | null };

/** Read inside the cancel transaction, before the links go. */
export async function readLinkedChildSprints(executor: Executor, orgSprintId: string): Promise<LinkedChildSprint[]> {
  return executor.execute<LinkedChildSprint>(sql`
    SELECT c.name AS "sprintName", p.owner_id AS "ownerId", p.id AS "projectId", p.slug FROM workspace_sprints c JOIN workspaces p ON p.id = c.workspace_id
    WHERE c.parent_sprint_id = ${orgSprintId} AND p.deleted_at IS NULL`);
}

/** Cancel (report §15.3): each lead hears their sprint is no longer inside the org sprint. */
export function notifyChildSprintsUnlinked(orgId: string, orgSprintId: string, linked: LinkedChildSprint[], actorId: string) {
  return safely("unlinked", async () => {
    if (linked.length === 0) return;
    const [org] = await db.execute<{ kind: string | null; name: string }>(sql`
      SELECT p.kind, s.name FROM workspaces p JOIN workspace_sprints s ON s.id = ${orgSprintId} WHERE p.id = ${orgId}`);
    if (org?.kind !== "organization") return;
    for (const child of linked) {
      await notifyOrg({ orgId, eventKey: "org_sprints.notice", actorId, to: [child.ownerId], title: `${org.name} was canceled. ${child.sprintName} is no longer linked to it`,
        href: `/workspaces/${encodeURIComponent(child.slug ?? child.projectId)}?tab=sprints`, sourceEventId: `sprint-unlinked:${orgSprintId}:${child.projectId}`, refs: { projectId: child.projectId } });
    }
  });
}

/** "Move due dates too": the sprint's published assignments and every copy shift by the same amount; people hear the new date. */
export function shiftOrgSprintDueDates(orgId: string, sprintId: string, shiftMs: number, actorId: string) {
  return safely("shift", async () => {
    const seconds = Math.round(shiftMs / 1000);
    const masters = await db.execute<{ id: string; title: string; due_date: string }>(sql`
      UPDATE tasks SET due_date = due_date + make_interval(secs => ${seconds}), updated_at = now()
      WHERE workspace_id = ${orgId} AND sprint_id = ${sprintId} AND kind = 'assignment' AND deleted_at IS NULL AND due_date IS NOT NULL
      RETURNING id, title, due_date::text`);
    if (masters.length === 0) return;
    await db.execute(sql`
      UPDATE tasks SET due_date = due_date + make_interval(secs => ${seconds}), updated_at = now()
      WHERE assignment_id IN (${sql.join(masters.map((m) => sql`${m.id}::uuid`), sql`, `)}) AND deleted_at IS NULL AND due_date IS NOT NULL`);
    const [org] = await db.execute<{ title: string | null; slug: string | null; time_zone: string | null }>(sql`SELECT title, slug, time_zone FROM workspaces WHERE id = ${orgId}`);
    for (const master of masters) {
      const people = await db.execute<{ user_id: string }>(sql`
        SELECT c.assignee_id AS user_id FROM tasks c WHERE c.assignment_id = ${master.id} AND c.deleted_at IS NULL AND c.assignee_id IS NOT NULL
        UNION SELECT tm.user_id FROM task_team_members tm JOIN tasks c ON c.id = tm.task_id WHERE c.assignment_id = ${master.id} AND c.deleted_at IS NULL`);
      if (people.length === 0) continue;
      const due = new Intl.DateTimeFormat("en", { timeZone: org?.time_zone || "UTC", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(master.due_date));
      await notifyOrg({ orgId, eventKey: "assignments.due_changed", actorId, to: people.map((p) => p.user_id), title: `${master.title} is now due ${due}`,
        href: orgHref({ id: orgId, slug: org?.slug ?? null }, "?tab=tasks"), sourceEventId: `shift:${master.id}:${master.due_date}`, refs: { taskId: master.id } });
    }
  });
}

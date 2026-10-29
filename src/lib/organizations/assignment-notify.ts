import "server-only";

import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { workspaces, taskSubtasks, taskTeamMembers, tasks } from "@/lib/db/schema";
import type { OrgEmailData } from "@/lib/email/org-templates";
import type { AssignmentSettings } from "@/lib/organizations/assignment-rules";
import { namesOf, notifyOrg, orgHref, orgLabel, queueOrgEmails } from "@/lib/organizations/notify";

// Assignment notices (report §26.3 D): published, submitted, returned or approved, extended or excused.
// Privacy: each person sees only their own copy and their own team; materials skip Admins-only folders.

type CopyRow = { id: string; projectId: string; assigneeId: string | null; teamName: string | null };

async function teamsOf(copyIds: string[]) {
  const rows = copyIds.length ? await db.select({ taskId: taskTeamMembers.taskId, userId: taskTeamMembers.userId }).from(taskTeamMembers).where(inArray(taskTeamMembers.taskId, copyIds)) : [];
  const byCopy = new Map<string, string[]>();
  for (const r of rows) byCopy.set(r.taskId, [...(byCopy.get(r.taskId) ?? []), r.userId]);
  return byCopy;
}

/** Everyone a copy belongs to: its assignee and, for a team copy, the whole team. */
export async function copyPeople(copyId: string) {
  const [copy] = await db.select({ assigneeId: tasks.assigneeId }).from(tasks).where(eq(tasks.id, copyId)).limit(1);
  const team = (await teamsOf([copyId])).get(copyId) ?? [];
  return [...new Set([copy?.assigneeId, ...team].filter((id): id is string => Boolean(id)))];
}

/** Linked files of the master, minus anything under an Admins-only folder (report §26.10 #5). */
async function materialsOf(masterId: string, orgId: string) {
  return db.execute<{ name: string; size: number | null }>(sql`
    SELECT n.name, n.size FROM workspace_nodes n
    WHERE n.workspace_id = ${orgId} AND n.type = 'file' AND n.deleted_at IS NULL
      AND (n.task_id = ${masterId} OR EXISTS (SELECT 1 FROM task_node_links l WHERE l.task_id = ${masterId} AND l.node_id = n.id))
      AND NOT EXISTS (
        SELECT 1 FROM workspace_nodes f WHERE f.workspace_id = n.workspace_id AND f.type = 'folder' AND f.deleted_at IS NULL
          AND f.metadata->>'access' = 'admins' AND starts_with(n.path, f.path || '/'))
    ORDER BY n.name LIMIT 10`);
}

/**
 * Published (individual, team, group copy): tray for everyone, E5 for each recipient with their own copy.
 * `onlyCopyIds` narrows it to copies made later (a late joiner, a new child project).
 */
export async function notifyAssignmentPublished(masterId: string, actorId: string, onlyCopyIds?: string[]) {
  const [master] = await db.select({ id: tasks.id, projectId: tasks.projectId, title: tasks.title, description: tasks.description, dueDate: tasks.dueDate, settings: tasks.assignmentSettings })
    .from(tasks).where(eq(tasks.id, masterId)).limit(1);
  const org = master ? await orgLabel(master.projectId) : null;
  if (!master || !org) return;
  const settings = master.settings as AssignmentSettings | null;
  const copies: CopyRow[] = await db.select({ id: tasks.id, projectId: tasks.projectId, assigneeId: tasks.assigneeId, teamName: tasks.teamName })
    .from(tasks).where(and(eq(tasks.assignmentId, masterId), isNull(tasks.deletedAt), onlyCopyIds ? inArray(tasks.id, onlyCopyIds) : undefined));
  if (copies.length === 0) return;
  const teams = await teamsOf(copies.map((c) => c.id));
  const childIds = [...new Set(copies.filter((c) => c.projectId !== master.projectId).map((c) => c.projectId))];
  const children = new Map(childIds.length ? (await db.select({ id: workspaces.id, title: workspaces.title }).from(workspaces).where(inArray(workspaces.id, childIds))).map((c) => [c.id, c.title]) : []);
  const names = await namesOf([...new Set([...teams.values()].flat())]);
  const actor = (await namesOf([actorId])).get(actorId) ?? "Someone";
  const [steps, materials] = await Promise.all([
    db.select({ title: taskSubtasks.title }).from(taskSubtasks).where(eq(taskSubtasks.taskId, masterId)).orderBy(asc(taskSubtasks.position)),
    materialsOf(masterId, master.projectId),
  ]);

  const perUser = new Map<string, Partial<OrgEmailData>>();
  const base = {
    title: master.title, dueAt: master.dueDate?.toISOString() ?? null, description: master.description, steps: steps.map((s) => s.title),
    materials: [...materials], reviewRequired: Boolean(settings?.reviewRequired), submission: settings?.submissionType && settings.submissionType !== "none" ? settings.submissionType : null,
  };
  const href = orgHref(org, "?tab=assignments");
  const individuals: string[] = [];
  for (const copy of copies) {
    const team = teams.get(copy.id) ?? [];
    const people = [...new Set([copy.assigneeId, ...team].filter((id): id is string => Boolean(id)))];
    const childTitle = children.get(copy.projectId);
    if (childTitle || copy.teamName) {
      // Team and group copies each get their own line ("You're in Team A for Lab 2").
      const title = childTitle ? `${org.title} assigned ${master.title} to ${childTitle}` : `You’re in ${copy.teamName} for ${master.title}`;
      await notifyOrg({ orgId: org.id, eventKey: "assignments.published", actorId, to: people, title, href, sourceEventId: `published:${copy.id}`, refs: { taskId: copy.id } });
      // The group copy also lands in the project's own channel (report §25.5): "CSE-3A assigned Mini-project proposal".
      if (childTitle) {
        await db.execute(sql`
          SELECT app_private.chat_post_system(c.id, ${actorId}::uuid, ${`${org.title} assigned ${master.title}`})
          FROM public.chat_channels c WHERE c.workspace_id = ${copy.projectId} AND c.is_default`).catch(() => undefined);
      }
    } else individuals.push(...people);
    for (const userId of people) {
      perUser.set(userId, {
        child: childTitle ? { title: childTitle } : null,
        assignment: { ...base, copyId: copy.id, group: Boolean(childTitle), teamName: copy.teamName, team: team.map((id) => names.get(id) ?? "Teammate") },
      });
    }
  }
  // Individual copies share one line, so a 2,000-person assignment is one tray fan-out, not 2,000.
  if (individuals.length) await notifyOrg({ orgId: org.id, eventKey: "assignments.published", actorId, to: individuals, title: `${actor} assigned ${master.title}`, href, sourceEventId: `published:${masterId}`, refs: { taskId: masterId } });
  await queueOrgEmails(org.id, actorId, `published:${masterId}`, { kind: "org_assignment", data: (userId) => perUser.get(userId) ?? null }, [...perUser.keys()]);
}

async function copyContext(copyId: string) {
  const [copy] = await db.select({ id: tasks.id, title: tasks.title, assignmentId: tasks.assignmentId, version: sql<number | null>`(${tasks.submission}->>'version')::int` })
    .from(tasks).where(eq(tasks.id, copyId)).limit(1);
  const [master] = copy?.assignmentId ? await db.select({ projectId: tasks.projectId }).from(tasks).where(eq(tasks.id, copy.assignmentId)).limit(1) : [];
  const org = master ? await orgLabel(master.projectId) : null;
  return copy && org ? { copy, org, href: orgHref(org, `?tab=assignments&copy=${encodeURIComponent(copy.id)}`) } : null;
}

/** "5 new submissions for Lab 1" for admins, combined in the tray; the daily digest carries the rest. */
export async function notifyAssignmentSubmitted(copyId: string, actorId: string) {
  const ctx = await copyContext(copyId);
  if (!ctx) return;
  await notifyOrg({ orgId: ctx.org.id, eventKey: "assignments.submitted", actorId, title: `New submission for ${ctx.copy.title}`, href: orgHref(ctx.org, "?tab=assignments&view=review"), sourceEventId: `${copyId}:v${ctx.copy.version ?? 1}`, refs: { taskId: ctx.copy.assignmentId } });
}

/** Returned (tray, push, E8) or approved (tray), to the member or the whole team. */
export async function notifyAssignmentReviewed(copyId: string, actorId: string, decision: "approve" | "return", reason?: string | null) {
  const ctx = await copyContext(copyId);
  if (!ctx) return;
  const to = await copyPeople(copyId);
  const returned = decision === "return";
  await notifyOrg({
    orgId: ctx.org.id, eventKey: "assignments.reviewed", actorId, to,
    title: returned ? `${ctx.copy.title} was returned${reason ? `: ${reason}` : ""}` : `${ctx.copy.title} approved`,
    href: ctx.href, sourceEventId: `${copyId}:${decision}:v${ctx.copy.version ?? 1}`, refs: { taskId: copyId },
    email: returned ? { kind: "org_returned", data: { reason: reason ?? null, assignment: { title: ctx.copy.title, copyId, version: ctx.copy.version } } } : null,
  });
}

/** Extended or excused (tray, push). */
export async function notifyAssignmentDueChanged(copyId: string, actorId: string, title: (assignment: string) => string, eventId: string) {
  const ctx = await copyContext(copyId);
  if (!ctx) return;
  await notifyOrg({ orgId: ctx.org.id, eventKey: "assignments.due_changed", actorId, to: await copyPeople(copyId), title: title(ctx.copy.title), href: ctx.href, sourceEventId: eventId, refs: { taskId: copyId } });
}

/**
 * After a join or a new child project commits: E5 and the tray line for the copies it received (report §26 D,
 * "late joiner"). Copies already announced are skipped by the per-person dedupe.
 */
export async function notifyNewCopies(orgId: string, where: { userId?: string; projectId?: string }) {
  const rows = await db.execute<{ master_id: string; creator_id: string | null; copy_id: string }>(sql`
    SELECT m.id AS master_id, m.creator_id, c.id AS copy_id FROM tasks c JOIN tasks m ON m.id = c.assignment_id
    WHERE m.workspace_id = ${orgId} AND m.deleted_at IS NULL AND c.deleted_at IS NULL AND m.assignment_settings->>'closedAt' IS NULL
      AND c.created_at > now() - interval '1 hour'
      AND ${where.userId ? sql`c.assignee_id = ${where.userId}` : sql`c.workspace_id = ${where.projectId ?? null}`}`);
  const byMaster = new Map<string, { creator: string | null; copies: string[] }>();
  for (const r of rows) byMaster.set(r.master_id, { creator: r.creator_id, copies: [...(byMaster.get(r.master_id)?.copies ?? []), r.copy_id] });
  for (const [masterId, { creator, copies }] of byMaster) if (creator) await notifyAssignmentPublished(masterId, creator, copies);
}

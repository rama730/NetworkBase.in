import "server-only";

import { randomUUID } from "node:crypto";

import { and, eq, inArray, isNotNull, isNull, ne, or, sql, type SQL } from "drizzle-orm";

import { db } from "@/lib/db";
import { projectMembers, projectSprints, projectWorkflowColumns, projects, sprintTaskMemberships, taskSubtasks, taskTeamMembers, tasks } from "@/lib/db/schema";
import type { ProjectAccess } from "@/lib/data/project-access";
import type { AssignmentSettings, AssignmentTarget } from "@/lib/organizations/assignment-rules";

// Assignments (report §16, §16.11): a master task on the org and one copy per person, team or child project.

type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export type CopyRecipient = { projectId: string; assigneeId: string; teamName?: string; members?: string[] };

/**
 * Decision-19 read rule for task lists in an organization, mirroring app_private.nb_task_visible (0244):
 * members and guests see the masters, their own copies and their team's copies; owners and admins see all,
 * with copies kept off their board (they live in the roster and the Review queue).
 */
export function orgTaskReadFilter(access: ProjectAccess, viewerId: string | null, scope: string = "all"): SQL | undefined {
  if (access.project?.kind !== "organization") return undefined;
  const isAdmin = access.isOwner || access.memberRole === "admin";
  if (isAdmin) return scope === "review" ? undefined : isNull(tasks.assignmentId);
  const master = and(eq(tasks.kind, "assignment"), isNull(tasks.assignmentId));
  if (!viewerId) return master;
  return or(
    master,
    eq(tasks.assigneeId, viewerId),
    sql`EXISTS (SELECT 1 FROM ${taskTeamMembers} tm WHERE tm.task_id = ${tasks.id} AND tm.user_id = ${viewerId})`,
  );
}

/** Whether one task passes the same rule (task detail, sprint rows, the extension). */
export async function canSeeOrgTask(access: ProjectAccess, viewerId: string | null, taskId: string) {
  const filter = orgTaskReadFilter(access, viewerId, "review");
  if (!filter) return true;
  const [row] = await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.id, taskId), filter)).limit(1);
  return Boolean(row);
}

/** Who gets a copy (report §16.2): people in the org, teams, or each (or some) child project's lead. */
export async function resolveRecipients(executor: Executor, orgId: string, target: AssignmentTarget): Promise<CopyRecipient[]> {
  const members = await executor
    .select({ userId: projectMembers.userId, role: projectMembers.role })
    .from(projectMembers)
    .where(eq(projectMembers.projectId, orgId));
  const roleOf = new Map(members.map((m) => [m.userId, m.role]));
  // Guests never get copies; owners and admins only when picked by name or by the admin role.
  const assignable = (userId: string) => roleOf.has(userId) && roleOf.get(userId) !== "viewer";

  if (target.mode === "everyone") return members.filter((m) => m.role === "member").map((m) => ({ projectId: orgId, assigneeId: m.userId }));
  if (target.mode === "role") return members.filter((m) => m.role === target.role || (target.role === "admin" && m.role === "owner")).map((m) => ({ projectId: orgId, assigneeId: m.userId }));
  if (target.mode === "people") {
    const ids = [...new Set(target.userIds)];
    if (ids.some((id) => !assignable(id))) throw new Error("Pick people who are members of the organization.");
    return ids.map((assigneeId) => ({ projectId: orgId, assigneeId }));
  }
  if (target.mode === "teams") {
    const everyone = [...target.teams.flatMap((t) => t.userIds), ...target.individuals];
    if (new Set(everyone).size !== everyone.length) throw new Error("A person can be in one team per assignment.");
    if (everyone.some((id) => !assignable(id))) throw new Error("Pick people who are members of the organization.");
    if (target.teams.some((t) => t.userIds.length === 0)) throw new Error("Every team needs at least one person.");
    const names = target.teams.map((t) => t.name.trim().toLowerCase());
    if (names.some((n) => !n) || new Set(names).size !== names.length) throw new Error("Give each team its own name.");
    return [
      ...target.teams.map((team) => {
        const lead = team.leadId && team.userIds.includes(team.leadId) ? team.leadId : team.userIds[0]!;
        return { projectId: orgId, assigneeId: lead, teamName: team.name.trim().slice(0, 60), members: team.userIds };
      }),
      ...target.individuals.map((assigneeId) => ({ projectId: orgId, assigneeId })),
    ];
  }
  const children = await executor
    .select({ id: projects.id, ownerId: projects.ownerId })
    .from(projects)
    .where(and(eq(projects.parentId, orgId), isNull(projects.deletedAt), ne(projects.status, "archived")));
  const picked = target.mode === "children" ? children.filter((c) => target.projectIds.includes(c.id)) : children;
  if (picked.length === 0) throw new Error("Create projects in the organization first.");
  return picked.map((child) => ({ projectId: child.id, assigneeId: child.ownerId }));
}

/** Inserts one task the way createTaskAction does: next task number, top of the To do column. */
async function insertTask(executor: Executor, values: {
  projectId: string;
  title: string;
  description: string | null;
  dueDate: Date | null;
  sprintId: string | null;
  assigneeId: string | null;
  creatorId: string;
  kind: "task" | "assignment";
  assignmentId: string | null;
  assignmentSettings: AssignmentSettings | null;
  teamName: string | null;
}) {
  const [counter] = await executor.execute<{ current_task_number: number }>(sql`
    UPDATE ${projects} SET current_task_number = COALESCE(current_task_number, 0) + 1 WHERE id = ${values.projectId} RETURNING current_task_number`);
  const [column] = await executor
    .select({ id: projectWorkflowColumns.id })
    .from(projectWorkflowColumns)
    .where(and(eq(projectWorkflowColumns.projectId, values.projectId), eq(projectWorkflowColumns.status, "todo"), eq(projectWorkflowColumns.isDefault, true)))
    .limit(1);
  const [row] = await executor
    .insert(tasks)
    .values({
      ...values,
      status: "todo",
      workflowColumnId: column?.id ?? null,
      position: column ? sql`(SELECT COALESCE(MAX(position), 0) + 1024 FROM ${tasks} WHERE workflow_column_id = ${column.id} AND deleted_at IS NULL)` : null,
      timelineOriginSprintId: values.sprintId,
      timelineOriginAt: values.sprintId ? new Date() : null,
      taskNumber: counter?.current_task_number ?? null,
    })
    .returning({ id: tasks.id });
  return row!.id;
}

export async function createMasterTask(executor: Executor, input: {
  orgId: string; title: string; description: string | null; dueDate: Date; sprintId: string | null; creatorId: string; settings: AssignmentSettings; steps: string[];
}) {
  const id = await insertTask(executor, {
    projectId: input.orgId, title: input.title, description: input.description, dueDate: input.dueDate, sprintId: input.sprintId,
    assigneeId: null, creatorId: input.creatorId, kind: "assignment", assignmentId: null, assignmentSettings: input.settings, teamName: null,
  });
  if (input.steps.length > 0) {
    await executor.insert(taskSubtasks).values(input.steps.map((title, position) => ({ taskId: id, title, position })));
  }
  // The master shows on the org sprint's timeline; person copies never do (they are private, decision 19).
  if (input.sprintId) await executor.insert(sprintTaskMemberships).values({ projectId: input.orgId, sprintId: input.sprintId, taskId: id, addedBy: input.creatorId });
  return id;
}

/**
 * One copy per recipient, with the master's steps (report §16.3). Group copies go into the child project's
 * sprint linked to the master's sprint, or its backlog. Copies are written in bulk, one task-number bump and one
 * column lookup per project, so 2,000 copies are a handful of statements. ponytail: inline up to
 * ORG_LIMITS.copiesCreatedInline (the member cap); a background job only if that cap is ever raised.
 */
export async function createCopies(executor: Executor, masterId: string, recipients: CopyRecipient[], creatorId: string) {
  const [master] = await executor.select().from(tasks).where(eq(tasks.id, masterId)).limit(1);
  if (!master) throw new Error("Assignment not found");
  const steps = await executor.select({ title: taskSubtasks.title, position: taskSubtasks.position }).from(taskSubtasks).where(eq(taskSubtasks.taskId, masterId));

  // A group copy sits in the child project's sprint linked to the master's sprint (report §16.6).
  const childSprint = new Map<string, string | null>();
  const children = [...new Set(recipients.map((r) => r.projectId).filter((id) => id !== master.projectId))];
  if (master.sprintId && children.length) {
    const linked = await executor.select({ id: projectSprints.id, projectId: projectSprints.projectId }).from(projectSprints)
      .where(and(inArray(projectSprints.projectId, children), eq(projectSprints.parentSprintId, master.sprintId), inArray(projectSprints.status, ["planning", "active"])));
    for (const row of linked) if (!childSprint.has(row.projectId)) childSprint.set(row.projectId, row.id);
  }

  const byProject = new Map<string, Array<CopyRecipient & { id: string; sprintId: string | null }>>();
  for (const recipient of recipients) {
    const sprintId = recipient.projectId === master.projectId ? master.sprintId : childSprint.get(recipient.projectId) ?? null;
    byProject.set(recipient.projectId, [...(byProject.get(recipient.projectId) ?? []), { ...recipient, id: randomUUID(), sprintId }]);
  }

  const now = new Date();
  for (const [projectId, copies] of byProject) {
    // Same numbering and column as createTaskAction: next task numbers, appended to the default To do column.
    const [counter] = await executor.execute<{ current_task_number: number }>(sql`
      UPDATE ${projects} SET current_task_number = COALESCE(current_task_number, 0) + ${copies.length} WHERE id = ${projectId} RETURNING current_task_number`);
    const first = (counter?.current_task_number ?? copies.length) - copies.length + 1;
    const [column] = await executor.select({ id: projectWorkflowColumns.id }).from(projectWorkflowColumns)
      .where(and(eq(projectWorkflowColumns.projectId, projectId), eq(projectWorkflowColumns.status, "todo"), eq(projectWorkflowColumns.isDefault, true))).limit(1);
    const [top] = column ? await executor.execute<{ position: number }>(sql`
      SELECT COALESCE(MAX(position), 0)::float8 AS position FROM ${tasks} WHERE workflow_column_id = ${column.id} AND deleted_at IS NULL`) : [];
    for (let i = 0; i < copies.length; i += 500) {
      await executor.insert(tasks).values(copies.slice(i, i + 500).map((copy, j) => ({
        id: copy.id, projectId, title: master.title, description: master.description, dueDate: master.dueDate, sprintId: copy.sprintId,
        assigneeId: copy.assigneeId, creatorId, kind: "task" as const, assignmentId: masterId, assignmentSettings: null, teamName: copy.teamName ?? null,
        status: "todo" as const, workflowColumnId: column?.id ?? null, position: column ? Number(top?.position ?? 0) + 1024 * (i + j + 1) : null,
        timelineOriginSprintId: copy.sprintId, timelineOriginAt: copy.sprintId ? now : null, taskNumber: counter ? first + i + j : null,
      })));
    }
  }

  const all = [...byProject.values()].flat();
  const subtasks = all.flatMap((copy) => steps.map((step) => ({ taskId: copy.id, title: step.title, position: step.position })));
  for (let i = 0; i < subtasks.length; i += 1000) await executor.insert(taskSubtasks).values(subtasks.slice(i, i + 1000));
  const sprintRows = all.filter((c) => c.sprintId && c.projectId !== master.projectId).map((c) => ({ projectId: c.projectId, sprintId: c.sprintId!, taskId: c.id, addedBy: creatorId }));
  if (sprintRows.length) await executor.insert(sprintTaskMemberships).values(sprintRows);
  const teamRows = all.flatMap((c) => (c.members ?? []).map((userId) => ({ taskId: c.id, userId, isLead: userId === c.assigneeId })));
  for (let i = 0; i < teamRows.length; i += 1000) await executor.insert(taskTeamMembers).values(teamRows.slice(i, i + 1000));
}

/** Late joiners get copies of open assignments that aren't past due; teams mode excepted (report §16.9, §16.11). */
export async function createCopiesForNewMember(executor: Executor, orgId: string, userId: string) {
  const masters = await executor
    .select({ id: tasks.id, settings: tasks.assignmentSettings, dueDate: tasks.dueDate, creatorId: tasks.creatorId })
    .from(tasks)
    .where(and(eq(tasks.projectId, orgId), eq(tasks.kind, "assignment"), isNull(tasks.assignmentId), isNull(tasks.deletedAt)));
  const now = Date.now();
  for (const master of masters) {
    const s = master.settings;
    if (!s?.publishedAt || s.closedAt || (master.dueDate && master.dueDate.getTime() < now)) continue;
    if (!(s.target.mode === "everyone" || (s.target.mode === "role" && s.target.role === "member"))) continue;
    const [existing] = await executor.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.assignmentId, master.id), eq(tasks.assigneeId, userId))).limit(1);
    if (!existing) await createCopies(executor, master.id, [{ projectId: orgId, assigneeId: userId }], master.creatorId ?? userId);
  }
}

/** A new child project gets a group copy of each open "each project" assignment that isn't overdue (report §14.3 Phase 5). */
export async function createCopiesForNewChild(executor: Executor, orgId: string, childId: string, leadId: string) {
  const masters = await executor
    .select({ id: tasks.id, settings: tasks.assignmentSettings, dueDate: tasks.dueDate, creatorId: tasks.creatorId })
    .from(tasks)
    .where(and(eq(tasks.projectId, orgId), eq(tasks.kind, "assignment"), isNull(tasks.assignmentId), isNull(tasks.deletedAt)));
  const now = Date.now();
  for (const master of masters) {
    const s = master.settings;
    if (!s?.publishedAt || s.closedAt || s.target.mode !== "each_child" || (master.dueDate && master.dueDate.getTime() < now)) continue;
    const [existing] = await executor.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.assignmentId, master.id), eq(tasks.projectId, childId))).limit(1);
    if (!existing) await createCopies(executor, master.id, [{ projectId: childId, assigneeId: leadId }], master.creatorId ?? leadId);
  }
}

/** Someone leaving: their unfinished copies go (submitted work stays); a team's lead passes on (report §16.9, §16.11). */
export async function releaseCopiesOnLeave(executor: Executor, orgId: string, userId: string) {
  await executor.update(tasks).set({ deletedAt: new Date(), updatedAt: new Date() }).where(and(
    eq(tasks.projectId, orgId), eq(tasks.assigneeId, userId), isNotNull(tasks.assignmentId), isNull(tasks.deletedAt),
    ne(tasks.reviewStatus, "pending"), ne(tasks.status, "done"),
    sql`NOT EXISTS (SELECT 1 FROM ${taskTeamMembers} tm WHERE tm.task_id = ${tasks.id} AND tm.user_id <> ${userId})`,
  ));
  const teamCopies = await executor.select({ taskId: taskTeamMembers.taskId }).from(taskTeamMembers)
    .innerJoin(tasks, eq(tasks.id, taskTeamMembers.taskId))
    .where(and(eq(taskTeamMembers.userId, userId), eq(tasks.projectId, orgId)));
  for (const { taskId } of teamCopies) {
    await executor.delete(taskTeamMembers).where(and(eq(taskTeamMembers.taskId, taskId), eq(taskTeamMembers.userId, userId)));
    const [next] = await executor.select({ userId: taskTeamMembers.userId }).from(taskTeamMembers).where(eq(taskTeamMembers.taskId, taskId)).limit(1);
    if (next) {
      await executor.update(taskTeamMembers).set({ isLead: true }).where(and(eq(taskTeamMembers.taskId, taskId), eq(taskTeamMembers.userId, next.userId)));
      await executor.update(tasks).set({ assigneeId: next.userId, updatedAt: new Date() }).where(and(eq(tasks.id, taskId), eq(tasks.assigneeId, userId)));
    }
  }
}

/** Detaching a child project turns its group copies into ordinary tasks (report §16.9). */
export async function releaseGroupCopies(executor: Executor, childProjectId: string) {
  await executor.update(tasks).set({ assignmentId: null, updatedAt: new Date() })
    .where(and(eq(tasks.projectId, childProjectId), isNotNull(tasks.assignmentId)));
}

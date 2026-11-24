import "server-only";

import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { lessonProgress, tasks, workspaceSprints, workspaces } from "@/lib/db/schema";
import { createCopies } from "@/lib/organizations/assignments";
import type { AssignmentSettings } from "@/lib/organizations/assignment-rules";

/**
 * Report 31.3 C2 calls 4, 6, 8 (plan B2.2b): a self-paced class's path with its assignments. An assignment placed in
 * a module gets no copies when published; a learner's copy is made when they open the module, due N days from then.
 * A step is done when a lesson is marked done or the learner's copy is Done (handed in with no review, or Approved);
 * an Excused copy leaves the count.
 */
type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export type PathAssignment = { id: string; title: string; dueAfterDays: number | null; published: boolean };
export type PathModule = { id: string; name: string; lessons: Array<{ id: string; number: number | null; title: string; minutes: number | null }>; assignments: PathAssignment[] };

/** Whether the workspace plans a self-paced path (a class set Self-paced, or a workspace's path set Self-paced). */
export async function selfPaced(executor: Executor, projectId: string) {
  const [w] = await executor.select({ pacing: sql<string | null>`${workspaces.workflowSettings}->'path'->>'pacing'` }).from(workspaces).where(eq(workspaces.id, projectId)).limit(1);
  return w?.pacing === "self";
}

/** A master assignment whose sprint is a module of a self-paced path: its copies wait for each learner to open it. */
export async function isPathModuleAssignment(executor: Executor, projectId: string, sprintId: string | null) {
  if (!sprintId) return false;
  const [s] = await executor.select({ id: workspaceSprints.id }).from(workspaceSprints)
    .where(and(eq(workspaceSprints.id, sprintId), eq(workspaceSprints.projectId, projectId), isNotNull(workspaceSprints.pathPosition))).limit(1);
  return Boolean(s) && (await selfPaced(executor, projectId));
}

/** The assignments placed in the path's modules (learners see published ones only). */
export async function moduleAssignments(projectId: string, moduleIds: string[], publishedOnly: boolean) {
  if (!moduleIds.length) return [] as Array<PathAssignment & { sprintId: string }>;
  const rows = await db.select({ id: tasks.id, title: tasks.title, sprintId: tasks.sprintId, settings: tasks.assignmentSettings }).from(tasks)
    .where(and(eq(tasks.projectId, projectId), eq(tasks.kind, "assignment"), isNull(tasks.assignmentId), isNull(tasks.deletedAt), inArray(tasks.sprintId, moduleIds)))
    .orderBy(asc(tasks.createdAt));
  return rows.map((r) => {
    const s = (r.settings ?? {}) as AssignmentSettings & { dueAfterDays?: number | null };
    return { id: r.id, title: r.title, sprintId: r.sprintId!, dueAfterDays: s.dueAfterDays ?? null, published: Boolean(s.publishedAt) };
  }).filter((a) => !publishedOnly || a.published);
}

/** Each learner's done steps (lessons and Done copies, by master id) and excused assignments (master ids). */
export async function learnerSteps(lessonIds: string[], masterIds: string[], userIds: string[]) {
  const out = new Map(userIds.map((u) => [u, { done: new Set<string>(), excused: new Set<string>(), copies: new Map<string, { id: string; status: string; due: string | null; excused: boolean }>(), lastDone: null as Date | null }]));
  if (!userIds.length) return out;
  const marks = lessonIds.length ? await db.select({ taskId: lessonProgress.taskId, userId: lessonProgress.userId, at: lessonProgress.doneAt }).from(lessonProgress)
    .where(and(inArray(lessonProgress.taskId, lessonIds), inArray(lessonProgress.userId, userIds))) : [];
  for (const m of marks) {
    const o = out.get(m.userId)!;
    o.done.add(m.taskId);
    if (!o.lastDone || m.at > o.lastDone) o.lastDone = m.at;
  }
  if (masterIds.length) {
    const copies = Array.from(await db.execute<{ id: string; master: string; user_id: string; status: string; due: string | null; excused: boolean; completed_at: string | null }>(sql`
      SELECT c.id, c.assignment_id AS master, u.id AS user_id, c.status, c.due_date::text AS due, c.excused_at IS NOT NULL AS excused, c.completed_at::text AS completed_at
      FROM tasks c JOIN unnest(ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(userIds)}::jsonb))::uuid[]) AS u(id)
        ON c.assignee_id = u.id OR EXISTS (SELECT 1 FROM task_team_members tm WHERE tm.task_id = c.id AND tm.user_id = u.id)
      WHERE c.deleted_at IS NULL AND c.assignment_id IN (SELECT jsonb_array_elements_text(${JSON.stringify(masterIds)}::jsonb)::uuid)`));
    for (const c of copies) {
      const o = out.get(c.user_id)!;
      o.copies.set(c.master, { id: c.id, status: c.status, due: c.due, excused: c.excused });
      if (c.excused) o.excused.add(c.master);
      else if (c.status === "done") {
        o.done.add(c.master);
        const at = c.completed_at ? new Date(c.completed_at) : null;
        if (at && (!o.lastDone || at > o.lastDone)) o.lastDone = at;
      }
    }
  }
  return out;
}

/** The path as steps for the % and lock rules: lessons plus assignments, an excused one left out (call 6). */
export const countedModules = (modules: PathModule[], excused: Set<string>) =>
  modules.map((m) => ({ id: m.id, lessons: [...m.lessons.map((l) => ({ id: l.id })), ...m.assignments.filter((a) => !excused.has(a.id)).map((a) => ({ id: a.id }))] }));

/** Opening a module (call 4): a copy of each published, open assignment in it, due `dueAfterDays` from now. */
export async function openModuleFor(executor: Executor, projectId: string, moduleId: string, userId: string) {
  const masters = await executor.select({ id: tasks.id, settings: tasks.assignmentSettings, creatorId: tasks.creatorId }).from(tasks)
    .where(and(eq(tasks.projectId, projectId), eq(tasks.kind, "assignment"), isNull(tasks.assignmentId), isNull(tasks.deletedAt), eq(tasks.sprintId, moduleId)));
  let made = 0;
  for (const m of masters) {
    const s = (m.settings ?? {}) as AssignmentSettings & { dueAfterDays?: number | null };
    if (!s.publishedAt || s.closedAt) continue;
    // One per learner: a lock on the master keeps two opens at once from making two.
    await executor.execute(sql`SELECT 1 FROM tasks WHERE id = ${m.id}::uuid FOR UPDATE`);
    const [existing] = await executor.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.assignmentId, m.id), eq(tasks.assigneeId, userId), isNull(tasks.deletedAt))).limit(1);
    if (existing) continue;
    await createCopies(executor, m.id, [{ projectId, assigneeId: userId }], m.creatorId ?? userId);
    const due = s.dueAfterDays ? new Date(Date.now() + s.dueAfterDays * 86_400_000) : null;
    await executor.update(tasks).set({ dueDate: due, updatedAt: new Date() }).where(and(eq(tasks.assignmentId, m.id), eq(tasks.assigneeId, userId), isNull(tasks.deletedAt)));
    made += 1;
  }
  return made;
}

/** The path's modules with their lessons and assignments (Archived lessons left out). */
export async function pathModules(projectId: string, publishedOnly: boolean): Promise<PathModule[]> {
  const steps = await db.select({ id: workspaceSprints.id, name: workspaceSprints.name }).from(workspaceSprints)
    .where(and(eq(workspaceSprints.projectId, projectId), isNotNull(workspaceSprints.pathPosition), isNull(workspaceSprints.archivedAt)))
    .orderBy(asc(workspaceSprints.pathPosition), asc(workspaceSprints.createdAt));
  if (!steps.length) return [];
  const ids = steps.map((s) => s.id);
  const lessons = await db.select({ id: tasks.id, number: tasks.taskNumber, title: tasks.title, sprintId: tasks.sprintId, stage: tasks.stage, fields: tasks.typeFields }).from(tasks)
    .where(and(eq(tasks.projectId, projectId), eq(tasks.itemType, "class_lesson"), isNull(tasks.deletedAt), inArray(tasks.sprintId, ids))).orderBy(asc(tasks.createdAt));
  const assignments = await moduleAssignments(projectId, ids, publishedOnly);
  return steps.map((s) => ({ id: s.id, name: s.name,
    lessons: lessons.filter((l) => l.sprintId === s.id && l.stage !== "archived").map((l) => ({ id: l.id, number: l.number, title: l.title, minutes: (l.fields as { minutes?: number } | null)?.minutes ?? null })),
    assignments: assignments.filter((a) => a.sprintId === s.id) }));
}

/** Completion in a self-paced class (call 6 with C1): every step on the path, per learner — required and done. */
export async function pathCounts(projectId: string, userIds: string[]) {
  const modules = await pathModules(projectId, true);
  const steps = await learnerSteps(modules.flatMap((m) => m.lessons.map((l) => l.id)), modules.flatMap((m) => m.assignments.map((a) => a.id)), userIds);
  return new Map(userIds.map((u) => {
    const s = steps.get(u)!;
    const items = countedModules(modules, s.excused).flatMap((m) => m.lessons);
    return [u, { required: items.length, approved: items.filter((i) => s.done.has(i.id)).length }];
  }));
}

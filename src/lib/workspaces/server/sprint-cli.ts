import "server-only";
/**
 * Sprints from the terminal (report F2, M7): create, add tasks, close with the unfinished work moved on, and a
 * burndown for `nb sprint view`. Creating and closing reuse the app's actions (same rules, notifications and words).
 */
import { and, asc, eq, gt, inArray, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { tasks, workspaceSprints } from "@/lib/db/schema";
import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { completeSprintAction, createSprintAction } from "@/lib/workspaces/server/sprints";

export class SprintCliError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) { super(message); }
}
const fail = (message: string, status: number, code: string): never => { throw new SprintCliError(message, status, code); };
const DAY = 86_400_000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

async function sprintOf(projectId: string, sprintId: string) {
  const [sprint] = await db.select().from(workspaceSprints).where(and(eq(workspaceSprints.id, sprintId), eq(workspaceSprints.projectId, projectId), isNull(workspaceSprints.archivedAt))).limit(1);
  return sprint ?? fail("Sprint not found", 404, "NOT_FOUND");
}

export async function createSprintFromCli(projectId: string, input: { name: string; from: string; to: string; goal?: string | null }) {
  const res = await createSprintAction({ projectId, name: input.name, startDate: input.from, endDate: input.to, goal: input.goal ?? undefined } as never);
  if (!res.success) fail(res.error ?? "Couldn't create the sprint", 400, "BAD_REQUEST");
  return { sprint: (res as { sprint: unknown }).sprint };
}

/** Tasks by number into a planning or running sprint: anyone who can change tasks here. At most 200 at once. */
export async function addTasksToSprint(userId: string, projectId: string, sprintId: string, numbers: number[]) {
  const access = await getWorkspaceAccessById(projectId, userId);
  if (!access.project || !access.canWrite) fail("You can read this workspace but not change it", 403, "FORBIDDEN");
  const wanted = [...new Set(numbers)].filter((n) => Number.isInteger(n) && n > 0);
  if (!wanted.length || wanted.length > 200) fail("Name 1 to 200 task numbers", 400, "BAD_REQUEST");
  const sprint = await sprintOf(projectId, sprintId);
  if (!["planning", "active"].includes(sprint.status)) fail(`That sprint is ${sprint.status}; add tasks to a planned or running one`, 409, "CONFLICT");
  const found = await db.select({ id: tasks.id, number: tasks.taskNumber }).from(tasks)
    .where(and(eq(tasks.projectId, projectId), inArray(tasks.taskNumber, wanted), isNull(tasks.deletedAt)));
  const missing = wanted.filter((n) => !found.some((t) => t.number === n));
  if (missing.length) fail(`No task ${missing.map((n) => `#${n}`).join(", ")} here`, 404, "NOT_FOUND");
  await db.update(tasks).set({ sprintId, updatedAt: new Date() }).where(inArray(tasks.id, found.map((t) => t.id)));
  return { sprint: { id: sprint.id, name: sprint.name }, added: wanted };
}

/**
 * Closes a running sprint (owners and admins, as in the app). Unfinished tasks move to the next planned sprint (the
 * one starting soonest after this one), or back to the backlog when there's none; the answer says which.
 */
export async function closeSprintFromCli(projectId: string, sprintId: string) {
  const sprint = await sprintOf(projectId, sprintId);
  if (sprint.status !== "active") fail(`Only a running sprint closes; this one is ${sprint.status}`, 409, "CONFLICT");
  const [next] = await db.select({ id: workspaceSprints.id, name: workspaceSprints.name }).from(workspaceSprints)
    .where(and(eq(workspaceSprints.projectId, projectId), eq(workspaceSprints.status, "planning"), isNull(workspaceSprints.archivedAt), gt(workspaceSprints.startDate, sprint.startDate)))
    .orderBy(asc(workspaceSprints.startDate)).limit(1);
  const [{ open } = { open: 0 }] = await db.select({ open: sql<number>`count(*)::int` }).from(tasks)
    .where(and(eq(tasks.sprintId, sprintId), isNull(tasks.deletedAt), sql`${tasks.status} <> 'done'`));
  if (open > 500) fail(`${open} unfinished tasks: close it in the app, which moves them in batches`, 409, "TOO_LARGE");
  const res = await completeSprintAction(sprintId, projectId, next ? { unfinished: "next_sprint", nextSprintId: next.id } : { unfinished: "backlog" });
  if (!res.success) fail((res as { error?: string }).error ?? "Couldn't close the sprint", 400, "BAD_REQUEST");
  return { sprint: { id: sprint.id, name: sprint.name }, moved: open, to: next ? { id: next.id, name: next.name } : "backlog" };
}

/** Tasks left at the end of each day from the start to today (or the end): the text burndown in `nb sprint view`. */
export async function sprintBurndown(projectId: string, sprintId: string) {
  // Only this workspace's sprint and tasks: the id comes from the caller.
  const [sprint] = await db.select({ start: workspaceSprints.startDate, end: workspaceSprints.endDate }).from(workspaceSprints)
    .where(and(eq(workspaceSprints.id, sprintId), eq(workspaceSprints.projectId, projectId))).limit(1);
  if (!sprint) return [];
  const rows = await db.select({ status: tasks.status, completedAt: tasks.completedAt }).from(tasks)
    .where(and(eq(tasks.sprintId, sprintId), eq(tasks.projectId, projectId), isNull(tasks.deletedAt)));
  const last = Math.min(sprint.end.getTime(), Date.now());
  const days: Array<{ date: string; left: number }> = [];
  for (let t = sprint.start.getTime(); t <= last && days.length < 120; t += DAY) {
    const endOfDay = t + DAY - 1;
    days.push({ date: isoDay(new Date(t)), left: rows.filter((r) => !(r.status === "done" && r.completedAt && r.completedAt.getTime() <= endOfDay)).length });
  }
  return days;
}

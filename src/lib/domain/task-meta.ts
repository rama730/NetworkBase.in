import "server-only";

import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { z } from "zod";

import { taskMetaSchema } from "@/lib/api/v1-schemas";
import { db } from "@/lib/db";
import { nodeStars, taskDependencies, taskLinks, taskStars, taskWatchers, tasks } from "@/lib/db/schema";
import { canReadWorkspaceTab, getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { assertAssignmentWrite, canSeeOrgTask } from "@/lib/organizations/assignments";
import { lockTaskForWrite } from "@/lib/workspaces/task-transition-service";

/**
 * Report C2, C3, C12 (0087): what a task carries beside its fields. Labels, "blocked by" and links change the task,
 * so they need the same right as editing it; watching and starring are the reader's own.
 */
export { taskMetaSchema };
export type TaskMetaInput = z.infer<typeof taskMetaSchema>;

export class TaskMetaError extends Error {
  constructor(message: string, readonly status: 403 | 404 | 409) {
    super(message);
  }
}

/** GitHub pull requests and issues get their kind and a short title ("acme/app#42"); anything else is a link. */
export function linkKind(url: string): { kind: "pull_request" | "issue" | "link"; title: string | null } {
  const m = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/(pull|issues)\/(\d+)/.exec(url);
  return m ? { kind: m[2] === "pull" ? "pull_request" : "issue", title: `${m[1]}#${m[3]}` } : { kind: "link", title: null };
}

export async function readableTask(taskId: string, userId: string) {
  const [task] = await db.select({ id: tasks.id, projectId: tasks.projectId }).from(tasks).where(and(eq(tasks.id, taskId), isNull(tasks.deletedAt))).limit(1);
  if (!task) throw new TaskMetaError("Task not found", 404);
  const access = await getWorkspaceAccessById(task.projectId, userId);
  if (!canReadWorkspaceTab(access, "tasks") || !(await canSeeOrgTask(access, userId, taskId))) throw new TaskMetaError("You don’t have access to this", 403);
  return task;
}

const brief = { id: tasks.id, number: tasks.taskNumber, title: tasks.title, status: tasks.status };

export async function readTaskMeta(taskId: string, userId: string) {
  const task = await readableTask(taskId, userId);
  const [[row], blockedBy, blocking, links, [mine]] = await Promise.all([
    db.select({ labels: tasks.labels }).from(tasks).where(eq(tasks.id, taskId)),
    db.select(brief).from(taskDependencies).innerJoin(tasks, eq(tasks.id, taskDependencies.blockedByTaskId)).where(and(eq(taskDependencies.taskId, taskId), isNull(tasks.deletedAt))).orderBy(asc(tasks.taskNumber)),
    db.select(brief).from(taskDependencies).innerJoin(tasks, eq(tasks.id, taskDependencies.taskId)).where(and(eq(taskDependencies.blockedByTaskId, taskId), isNull(tasks.deletedAt))).orderBy(asc(tasks.taskNumber)),
    db.select({ url: taskLinks.url, title: taskLinks.title, kind: taskLinks.kind }).from(taskLinks).where(eq(taskLinks.taskId, taskId)).orderBy(asc(taskLinks.createdAt)),
    db.execute<{ watching: boolean; starred: boolean }>(sql`SELECT
      EXISTS (SELECT 1 FROM task_watchers WHERE task_id = ${taskId} AND user_id = ${userId}) AS watching,
      EXISTS (SELECT 1 FROM task_stars WHERE task_id = ${taskId} AND user_id = ${userId}) AS starred`),
  ]);
  return { taskId, projectId: task.projectId, labels: row?.labels ?? [], blockedBy, blocking, links, watching: Boolean(mine?.watching), starred: Boolean(mine?.starred) };
}

/** Would `taskId` waiting on `blocker` close a loop? Walks what `blocker` waits on (ponytail: 200 steps, ample). */
async function makesCycle(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], taskId: string, blocker: string) {
  const [row] = await tx.execute<{ loop: boolean }>(sql`
    WITH RECURSIVE chain(id, depth) AS (
      SELECT ${blocker}::uuid, 0
      UNION SELECT d.blocked_by_task_id, c.depth + 1 FROM task_dependencies d JOIN chain c ON d.task_id = c.id WHERE c.depth < 200
    ) SELECT EXISTS (SELECT 1 FROM chain WHERE id = ${taskId}::uuid) AS loop`);
  return Boolean(row?.loop);
}

export async function updateTaskMeta(userId: string, taskId: string, input: TaskMetaInput) {
  const task = await readableTask(taskId, userId);
  const changesTask = Boolean(input.labels || input.blockedBy || input.links);
  await db.transaction(async (tx) => {
    if (changesTask) {
      // The same right as editing the task's fields, including the assignment rules.
      const locked = await lockTaskForWrite(tx, taskId, userId);
      await assertAssignmentWrite(tx, taskId, { role: locked.orgRole, isHolder: locked.isHolder, onOrgBoard: locked.onOrgBoard }, "priority");
    }
    if (input.labels) {
      const [row] = await tx.select({ labels: tasks.labels }).from(tasks).where(eq(tasks.id, taskId));
      const next = [...new Set([...(row?.labels ?? []), ...(input.labels.add ?? [])])].filter((l) => !(input.labels?.remove ?? []).includes(l));
      if (next.length > 20) throw new TaskMetaError("A task can have at most 20 labels", 409);
      await tx.update(tasks).set({ labels: next, updatedAt: new Date() }).where(eq(tasks.id, taskId));
    }
    if (input.blockedBy?.remove?.length) {
      await tx.delete(taskDependencies).where(and(eq(taskDependencies.taskId, taskId), inArray(taskDependencies.blockedByTaskId, input.blockedBy.remove)));
    }
    for (const blocker of input.blockedBy?.add ?? []) {
      const [other] = await tx.select({ projectId: tasks.projectId, number: tasks.taskNumber }).from(tasks).where(and(eq(tasks.id, blocker), isNull(tasks.deletedAt))).limit(1);
      if (!other || other.projectId !== task.projectId) throw new TaskMetaError("A task can only wait on tasks in the same workspace", 409);
      if (blocker === taskId || (await makesCycle(tx, taskId, blocker))) throw new TaskMetaError(`#${other.number} already waits on this task, so this one can't wait on it`, 409);
      await tx.insert(taskDependencies).values({ taskId, blockedByTaskId: blocker, createdBy: userId }).onConflictDoNothing();
    }
    if (input.links?.remove?.length) await tx.delete(taskLinks).where(and(eq(taskLinks.taskId, taskId), inArray(taskLinks.url, input.links.remove)));
    for (const link of input.links?.add ?? []) {
      const { kind, title } = linkKind(link.url);
      await tx.insert(taskLinks).values({ taskId, url: link.url, title: link.title ?? title, kind, createdBy: userId }).onConflictDoNothing();
    }
    if (input.watch === true) await tx.insert(taskWatchers).values({ taskId, userId }).onConflictDoNothing();
    if (input.watch === false) await tx.delete(taskWatchers).where(and(eq(taskWatchers.taskId, taskId), eq(taskWatchers.userId, userId)));
    if (input.star === true) await tx.insert(taskStars).values({ taskId, userId }).onConflictDoNothing();
    if (input.star === false) await tx.delete(taskStars).where(and(eq(taskStars.taskId, taskId), eq(taskStars.userId, userId)));
  });
  return readTaskMeta(taskId, userId);
}

/** Starring a file is the reader's own (report C3); the Files tab and `nb file star` share it. */
export async function setNodeStar(userId: string, projectId: string, nodeId: string, starred: boolean) {
  const access = await getWorkspaceAccessById(projectId, userId);
  if (!canReadWorkspaceTab(access, "files")) throw new TaskMetaError("You don’t have access to this", 403);
  const [node] = await db.execute<{ ok: boolean }>(sql`SELECT TRUE AS ok FROM workspace_nodes WHERE id = ${nodeId}::uuid AND workspace_id = ${projectId}::uuid AND deleted_at IS NULL`);
  if (!node) throw new TaskMetaError("File not found", 404);
  if (starred) await db.insert(nodeStars).values({ nodeId, userId }).onConflictDoNothing();
  else await db.delete(nodeStars).where(and(eq(nodeStars.nodeId, nodeId), eq(nodeStars.userId, userId)));
}

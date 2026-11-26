import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { workspaceNodes, taskNodeLinks, tasks } from "@/lib/db/schema";

export function taskFileCountKey(projectId: string, taskId: string) {
  return `${projectId}:${taskId}`;
}

export async function getWorkspaceTaskSummary(projectId: string) {
  const [summary] = await db
    .select({
      taskCount: sql<number>`count(*)`,
      lastTaskUpdatedAt: sql<Date | null>`max(${tasks.updatedAt})`,
    })
    .from(tasks)
    .where(and(eq(tasks.projectId, projectId), isNull(tasks.deletedAt), sql`coalesce(${tasks.itemType}, 'task') <> 'paper'`));
  return {
    taskCount: Number(summary?.taskCount) || 0,
    lastTaskUpdatedAt: summary?.lastTaskUpdatedAt ?? null,
  };
}

export async function getWorkspaceTaskCountMap(projectIds: string[]) {
  if (projectIds.length === 0) return new Map<string, number>();
  const rows = await db
    .select({
      projectId: tasks.projectId,
      count: sql<number>`count(*)`,
    })
    .from(tasks)
    .where(and(inArray(tasks.projectId, projectIds), isNull(tasks.deletedAt), sql`coalesce(${tasks.itemType}, 'task') <> 'paper'`))
    .groupBy(tasks.projectId);
  return new Map(rows.map((row) => [row.projectId, Number(row.count) || 0]));
}

export async function getTaskFileCountMap(projectId: string, taskIds: string[]) {
  if (taskIds.length === 0) return new Map<string, number>();
  const rows = await db
    .select({
      taskId: taskNodeLinks.taskId,
      count: sql<number>`count(*)`,
    })
    .from(taskNodeLinks)
    .innerJoin(workspaceNodes, eq(taskNodeLinks.nodeId, workspaceNodes.id))
    .where(
      and(
        inArray(taskNodeLinks.taskId, taskIds),
        eq(workspaceNodes.projectId, projectId),
        isNull(workspaceNodes.deletedAt),
      ),
    )
    .groupBy(taskNodeLinks.taskId);
  return new Map(rows.map((row) => [row.taskId, Number(row.count) || 0]));
}

export async function getWorkspaceTaskFileCountMap(projectIds: string[]) {
  if (projectIds.length === 0) return new Map<string, number>();
  const rows = await db
    .select({
      projectId: workspaceNodes.projectId,
      taskId: taskNodeLinks.taskId,
      count: sql<number>`count(*)`,
    })
    .from(taskNodeLinks)
    .innerJoin(workspaceNodes, eq(taskNodeLinks.nodeId, workspaceNodes.id))
    .where(
      and(
        inArray(workspaceNodes.projectId, projectIds),
        isNull(workspaceNodes.deletedAt),
      ),
    )
    .groupBy(workspaceNodes.projectId, taskNodeLinks.taskId);
  return new Map(rows.map((row) => [taskFileCountKey(row.projectId, row.taskId), Number(row.count) || 0]));
}

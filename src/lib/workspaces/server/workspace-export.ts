import "server-only";
/**
 * `nb export` (report F8, M7), for the workspace's owners and admins: its tasks, their comments and its docs as one JSON file, written into the zip
 * next to the files. Messages and chats stay out (they're people's private conversations). Up to 20,000 tasks.
 */
import { and, asc, eq, inArray, isNull } from "drizzle-orm";

import { listWorkspaceDocsAction } from "@/app/actions/workspace/doc";
import { db } from "@/lib/db";
import { profiles, taskComments, tasks, workspaceSprints, workspaces } from "@/lib/db/schema";

export const EXPORT_MAX_TASKS = 20_000;

export async function buildExportJson(workspaceId: string) {
  const [ws] = await db.select({ id: workspaces.id, title: workspaces.title, slug: workspaces.slug, description: workspaces.description }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  const rows = await db.select({
    id: tasks.id, number: tasks.taskNumber, title: tasks.title, description: tasks.description, status: tasks.status, priority: tasks.priority,
    dueDate: tasks.dueDate, createdAt: tasks.createdAt, updatedAt: tasks.updatedAt, completedAt: tasks.completedAt, assigneeId: tasks.assigneeId, sprintId: tasks.sprintId,
  }).from(tasks).where(and(eq(tasks.projectId, workspaceId), isNull(tasks.deletedAt))).orderBy(asc(tasks.taskNumber)).limit(EXPORT_MAX_TASKS + 1);
  if (rows.length > EXPORT_MAX_TASKS) throw new Error(`An export holds at most ${EXPORT_MAX_TASKS.toLocaleString()} tasks`);
  const ids = rows.map((r) => r.id);
  const comments: Array<{ taskId: string; userId: string | null; content: string | null; createdAt: Date }> = [];
  for (let i = 0; i < ids.length; i += 1000) {
    comments.push(...await db.select({ taskId: taskComments.taskId, userId: taskComments.userId, content: taskComments.content, createdAt: taskComments.createdAt })
      .from(taskComments).where(and(inArray(taskComments.taskId, ids.slice(i, i + 1000)), isNull(taskComments.deletedAt))).orderBy(asc(taskComments.createdAt)));
  }
  const people = new Map((await db.select({ id: profiles.id, username: profiles.username, name: profiles.fullName }).from(profiles)
    .where(inArray(profiles.id, [...new Set([...rows.map((r) => r.assigneeId), ...comments.map((c) => c.userId)].filter((x): x is string => Boolean(x)))].concat(["00000000-0000-0000-0000-000000000000"])))).map((p) => [p.id, p.username ?? p.name ?? null]));
  const sprints = new Map((await db.select({ id: workspaceSprints.id, name: workspaceSprints.name }).from(workspaceSprints).where(eq(workspaceSprints.projectId, workspaceId))).map((s) => [s.id, s.name]));
  const docs = await listWorkspaceDocsAction(workspaceId);
  return {
    format: "networkbase-export/1",
    exportedAt: new Date().toISOString(),
    workspace: ws ?? null,
    tasks: rows.map((r) => ({
      number: r.number, title: r.title, description: r.description, status: r.status, priority: r.priority, dueDate: r.dueDate?.toISOString() ?? null,
      assignee: r.assigneeId ? people.get(r.assigneeId) ?? null : null, sprint: r.sprintId ? sprints.get(r.sprintId) ?? null : null,
      createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(), completedAt: r.completedAt?.toISOString() ?? null,
      comments: comments.filter((c) => c.taskId === r.id).map((c) => ({ by: c.userId ? people.get(c.userId) ?? null : null, at: c.createdAt.toISOString(), text: c.content })),
    })),
    docs: docs.success ? docs.docs : [],
  };
}

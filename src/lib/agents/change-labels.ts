import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { profiles, tasks, workspaceNodes } from "@/lib/db/schema";

/**
 * Names for the yes prompt (report D4): `#4 "Logo"` for a task and the path for a file, so the person agrees to
 * something they can recognise. Falls back to "the task" / "a file" when it can't be read, or isn't in the workspace the
 * change is for: an id from another workspace must not put that workspace's titles or paths in the prompt.
 */
export async function taskLabel(taskId: string | null | undefined, workspaceId?: string | null) {
  if (!taskId) return "the task";
  const [t] = await db.select({ number: tasks.taskNumber, title: tasks.title }).from(tasks)
    .where(workspaceId ? and(eq(tasks.id, taskId), eq(tasks.projectId, workspaceId)) : eq(tasks.id, taskId)).limit(1).catch(() => []);
  return t ? `${t.number ? `#${t.number} ` : ""}"${t.title.slice(0, 80)}"` : "the task";
}

export async function nodeLabel(nodeId: string | null | undefined, workspaceId: string) {
  if (!nodeId) return "a file";
  const [n] = await db.select({ path: workspaceNodes.path }).from(workspaceNodes)
    .where(and(eq(workspaceNodes.id, nodeId), eq(workspaceNodes.projectId, workspaceId))).limit(1).catch(() => []);
  return n?.path ?? "a file";
}

export async function personLabel(userId: string | null | undefined) {
  if (!userId) return "nobody";
  const [p] = await db.select({ username: profiles.username, fullName: profiles.fullName }).from(profiles).where(eq(profiles.id, userId)).limit(1).catch(() => []);
  return p?.username ? `@${p.username}` : (p?.fullName ?? "someone");
}

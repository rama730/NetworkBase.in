import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { profiles, tasks, workspaceNodes } from "@/lib/db/schema";

/**
 * Names for the yes prompt (report D4): `#4 "Logo"` for a task and the path for a file, so the person agrees to
 * something they can recognise. Falls back to "the task" / "a file" when it can't be read.
 */
export async function taskLabel(taskId: string | null | undefined) {
  if (!taskId) return "the task";
  const [t] = await db.select({ number: tasks.taskNumber, title: tasks.title }).from(tasks).where(eq(tasks.id, taskId)).limit(1).catch(() => []);
  return t ? `${t.number ? `#${t.number} ` : ""}"${t.title.slice(0, 80)}"` : "the task";
}

export async function nodeLabel(nodeId: string | null | undefined) {
  if (!nodeId) return "a file";
  const [n] = await db.select({ path: workspaceNodes.path }).from(workspaceNodes).where(eq(workspaceNodes.id, nodeId)).limit(1).catch(() => []);
  return n?.path ?? "a file";
}

export async function personLabel(userId: string | null | undefined) {
  if (!userId) return "nobody";
  const [p] = await db.select({ username: profiles.username, fullName: profiles.fullName }).from(profiles).where(eq(profiles.id, userId)).limit(1).catch(() => []);
  return p?.username ? `@${p.username}` : (p?.fullName ?? "someone");
}

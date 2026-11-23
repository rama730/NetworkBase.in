import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { createNotification } from "@/lib/notifications/service";
import { projectTaskHref } from "@/lib/workspaces/task-presentation";

/**
 * Report 38.7 part 8 (plan A2.4): New request → the type's triage people (owners and admins when none are set),
 * Normal, Summary above 10 a day; Accepted and Declined → the asker. The person who acted is never told, and only
 * people still in the workspace are.
 */
type Row = { id: string; slug: string | null; key: string | null; role: string };

async function people(workspaceId: string) {
  return Array.from(await db.execute<Row>(sql`
    SELECT w.owner_id AS id, w.slug, w.key, 'owner' AS role FROM workspaces w WHERE w.id = ${workspaceId}::uuid
    UNION SELECT m.user_id, w.slug, w.key, m.role FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id
    WHERE m.workspace_id = ${workspaceId}::uuid`));
}

async function send(p: Row, actorId: string, task: { id: string; title: string; taskNumber: number | null; workspaceId: string }, title: string, importance: "important" | "more", dedupe: string) {
  await createNotification({
    recipientUserId: p.id, actorUserId: actorId, kind: "project_task_activity", category: "tasks", importance, title,
    href: projectTaskHref(p.slug || task.workspaceId, task.id),
    entityRefs: { projectId: task.workspaceId, projectSlug: p.slug, taskId: task.id },
    preview: { contextLabel: task.taskNumber && p.key ? `${p.key}-${task.taskNumber}` : "Request", contextKind: "task", secondaryText: "Request" },
    dedupeKey: `${dedupe}:${p.id}`,
  }).catch((error) => logger.error("requests.notify_failed", { module: "tasks", error: error instanceof Error ? error.message : String(error) }));
}

export async function notifyRequestNew(taskId: string, actorId: string, triagerIds: string[]) {
  const [task] = Array.from(await db.execute<{ id: string; title: string; task_number: number | null; workspace_id: string; today: number }>(sql`
    SELECT t.id, t.title, t.task_number, t.workspace_id,
      (SELECT count(*)::int FROM tasks x WHERE x.workspace_id = t.workspace_id AND x.item_type = 'request' AND x.created_at > now() - interval '1 day') AS today
    FROM tasks t WHERE t.id = ${taskId}::uuid`));
  if (!task) return;
  const all = await people(task.workspace_id);
  const chosen = triagerIds.length ? all.filter((p) => triagerIds.includes(p.id)) : all.filter((p) => p.role === "owner" || p.role === "admin");
  const t = { id: task.id, title: task.title, taskNumber: task.task_number, workspaceId: task.workspace_id };
  for (const p of chosen) if (p.id !== actorId) await send(p, actorId, t, `New request: ${task.title}`, task.today > 10 ? "more" : "important", `request-new:${task.id}`);
}

export async function notifyRequestDecided(taskId: string, actorId: string, words: "Accepted" | "Declined") {
  const [task] = Array.from(await db.execute<{ id: string; title: string; task_number: number | null; workspace_id: string; creator_id: string | null }>(sql`
    SELECT id, title, task_number, workspace_id, creator_id FROM tasks WHERE id = ${taskId}::uuid`));
  if (!task?.creator_id || task.creator_id === actorId) return;
  const p = (await people(task.workspace_id)).find((x) => x.id === task.creator_id);
  if (p) await send(p, actorId, { id: task.id, title: task.title, taskNumber: task.task_number, workspaceId: task.workspace_id }, `${words}: ${task.title}`, "important", `request-${words.toLowerCase()}:${task.id}`);
}

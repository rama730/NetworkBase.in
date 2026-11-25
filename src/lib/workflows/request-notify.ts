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

async function send(p: Row & { href?: string }, actorId: string, task: { id: string; title: string; taskNumber: number | null; workspaceId: string }, title: string, importance: "important" | "more", dedupe: string) {
  await createNotification({
    recipientUserId: p.id, actorUserId: actorId, kind: "project_task_activity", category: "tasks", importance, title,
    href: p.href ?? projectTaskHref(p.slug || task.workspaceId, task.id),
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

/**
 * B4.5 (report 33.6): someone who asked from the company isn't in the team's workspace; while they're still in the
 * company they're told too, with a link to the company's Overview (My asks), never the team's board.
 */
async function askerFromCompany(taskId: string, userId: string): Promise<(Row & { href: string }) | null> {
  const [r] = Array.from(await db.execute<{ slug: string | null; org: string }>(sql`
    SELECT o.slug, o.id AS org FROM tasks t JOIN workspaces o ON o.id::text = t.type_fields->>'fromCompany' AND o.kind = 'organization' AND o.deleted_at IS NULL
    WHERE t.id = ${taskId}::uuid AND t.creator_id = ${userId}::uuid
      AND EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = o.id AND m.user_id = ${userId}::uuid)`));
  return r ? { id: userId, slug: r.slug, key: null, role: "company", href: `/org/${encodeURIComponent(r.slug ?? r.org)}` } : null;
}

export async function notifyRequestDecided(taskId: string, actorId: string, words: "Accepted" | "Declined") {
  const [task] = Array.from(await db.execute<{ id: string; title: string; task_number: number | null; workspace_id: string; creator_id: string | null }>(sql`
    SELECT id, title, task_number, workspace_id, creator_id FROM tasks WHERE id = ${taskId}::uuid`));
  if (!task?.creator_id || task.creator_id === actorId) return;
  const p = (await people(task.workspace_id)).find((x) => x.id === task.creator_id) ?? await askerFromCompany(task.id, task.creator_id);
  if (p) await send(p, actorId, { id: task.id, title: task.title, taskNumber: task.task_number, workspaceId: task.workspace_id }, `${words}: ${task.title}`, "important", `request-${words.toLowerCase()}:${task.id}`);
}

/** A2.6: In review and Delivered tell the asker; Answered No tells the handler (Normal). */
export async function notifyRequestPerson(taskId: string, actorId: string, who: "asker" | "handler", words: string) {
  const [task] = Array.from(await db.execute<{ id: string; title: string; task_number: number | null; workspace_id: string; creator_id: string | null; assignee_id: string | null }>(sql`
    SELECT id, title, task_number, workspace_id, creator_id, assignee_id FROM tasks WHERE id = ${taskId}::uuid`));
  const target = who === "asker" ? task?.creator_id : task?.assignee_id;
  if (!task || !target || target === actorId) return;
  const p = (await people(task.workspace_id)).find((x) => x.id === target) ?? (who === "asker" ? await askerFromCompany(task.id, target) : null);
  if (p) await send(p, actorId, { id: task.id, title: task.title, taskNumber: task.task_number, workspaceId: task.workspace_id }, `${words}: ${task.title}`, "important", `request-${who}-${words.toLowerCase().replace(/\W+/g, "-")}:${task.id}:${Date.now()}`);
}

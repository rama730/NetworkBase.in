import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { createNotification } from "@/lib/notifications/service";
import { projectTaskHref } from "@/lib/workspaces/task-presentation";

/**
 * Report 38.6 part 8 (plan A2.1): bug notices for the workspace's owners and admins (call 5: no triage person
 * setting). "Normal" is the inbox's Important level, "Summary" is More. The person who acted is never told.
 */
type Bug = { id: string; title: string; taskNumber: number | null; workspaceId: string };

/** The owner and admins; with everyone, every current member (viewers included). */
async function leaders(workspaceId: string, everyone = false) {
  return Array.from(await db.execute<{ id: string; slug: string | null; key: string | null }>(sql`
    SELECT w.owner_id AS id, w.slug, w.key FROM workspaces w WHERE w.id = ${workspaceId}::uuid
    UNION SELECT m.user_id, w.slug, w.key FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id
    WHERE m.workspace_id = ${workspaceId}::uuid AND (${everyone} OR m.role IN ('owner', 'admin'))`));
}

async function tell(bug: Bug, actorId: string, title: string, importance: "important" | "more", dedupe: string) {
  for (const p of await leaders(bug.workspaceId)) {
    if (!p.id || p.id === actorId) continue;
    await createNotification({
      recipientUserId: p.id,
      actorUserId: actorId,
      kind: "project_task_activity",
      category: "tasks",
      importance,
      title,
      href: projectTaskHref(p.slug || bug.workspaceId, bug.id),
      entityRefs: { projectId: bug.workspaceId, projectSlug: p.slug, taskId: bug.id },
      preview: { contextLabel: bug.taskNumber && p.key ? `${p.key}-${bug.taskNumber}` : "Bug", contextKind: "task", secondaryText: "Bug" },
      dedupeKey: `${dedupe}:${p.id}`,
    }).catch((error) => logger.error("bugs.notify_failed", { module: "tasks", error: error instanceof Error ? error.message : String(error) }));
  }
}

/** New bug reported: Normal, or Summary once the workspace has had more than 5 today. */
export async function notifyBugReported(bug: Bug, actorId: string) {
  const [today] = await db.execute<{ n: number; num: number | null }>(sql`
    SELECT count(*)::int AS n, (SELECT task_number FROM tasks WHERE id = ${bug.id}::uuid) AS num
    FROM tasks WHERE workspace_id = ${bug.workspaceId}::uuid AND item_type = 'bug' AND created_at > now() - interval '1 day'`);
  bug = { ...bug, taskNumber: bug.taskNumber ?? today?.num ?? null };
  await tell(bug, actorId, `New bug: ${bug.title}`, (today?.n ?? 0) > 5 ? "more" : "important", `bug-new:${bug.id}`);
}

/** Urgent bug confirmed: Important. */
export async function notifyUrgentConfirmed(bug: Bug, actorId: string) {
  await tell(bug, actorId, `Urgent bug confirmed: ${bug.title}`, "important", `bug-urgent:${bug.id}`);
}

/** Your bug is Fixed (Normal): the reporter and the I-see-this-too people, never the person who moved it. */
export async function notifyBugFixed(taskId: string, actorId: string) {
  const [bug] = Array.from(await db.execute<{ id: string; title: string; task_number: number | null; workspace_id: string; slug: string | null; key: string | null; creator_id: string | null; seen: string[] | null }>(sql`
    SELECT t.id, t.title, t.task_number, t.workspace_id, w.slug, w.key, t.creator_id,
      coalesce(t.type_fields->'alsoSeen', '[]'::jsonb) AS seen
    FROM tasks t JOIN workspaces w ON w.id = t.workspace_id WHERE t.id = ${taskId}::uuid`));
  if (!bug) return;
  const wanted = [...new Set([bug.creator_id, ...(Array.isArray(bug.seen) ? bug.seen : [])].filter((p): p is string => Boolean(p) && p !== actorId))];
  // Only people still in the workspace (security review: someone who left keeps no window into it).
  const current = new Set((await leaders(bug.workspace_id, true)).map((p) => p.id));
  const people = wanted.filter((p) => current.has(p));
  for (const p of people) {
    await createNotification({
      recipientUserId: p, actorUserId: actorId, kind: "project_task_activity", category: "tasks", importance: "important",
      title: `Fixed: ${bug.title}`,
      href: projectTaskHref(bug.slug || bug.workspace_id, bug.id),
      entityRefs: { projectId: bug.workspace_id, projectSlug: bug.slug, taskId: bug.id },
      preview: { contextLabel: bug.task_number && bug.key ? `${bug.key}-${bug.task_number}` : "Bug", contextKind: "task", secondaryText: "Bug" },
      dedupeKey: `bug-fixed:${bug.id}:${p}`,
    }).catch((error) => logger.error("bugs.notify_failed", { module: "tasks", error: error instanceof Error ? error.message : String(error) }));
  }
}

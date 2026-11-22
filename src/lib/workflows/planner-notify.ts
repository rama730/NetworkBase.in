import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { createNotification } from "@/lib/notifications/service";
import { projectTaskHref } from "@/lib/workspaces/task-presentation";

/**
 * Report 38.5 part 8 (plan A1.6): the project notifications. "Normal" is our Important level and "Summary" is More
 * (the two levels the inbox has). Each has a dedupe key so a retry or a repeated drag never sends it twice; the
 * person who acted is never told about their own move.
 */
type Row = { id: string; title: string; task_number: number | null; workspace_id: string; slug: string | null; assignee_id: string | null; due: string | null };

const send = (recipient: string, actor: string | null, row: Row, title: string, importance: "important" | "more", dedupeKey: string) =>
  createNotification({
    recipientUserId: recipient,
    actorUserId: actor ?? undefined,
    kind: "project_task_activity",
    category: "tasks",
    importance,
    title,
    href: projectTaskHref(row.slug || row.workspace_id, row.id),
    entityRefs: { projectId: row.workspace_id, projectSlug: row.slug, taskId: row.id },
    preview: { contextLabel: row.task_number ? `#${row.task_number}` : "Project", contextKind: "task", secondaryText: "Project" },
    dedupeKey,
  }).catch((error) => logger.error("planner.notify_failed", { module: "tasks", dedupeKey, error: error instanceof Error ? error.message : String(error) }));

const projects = (ids: string[]) => ids.length ? db.execute<Row>(sql`
  SELECT t.id, t.title, t.task_number, t.workspace_id, w.slug, t.assignee_id, t.due_date::date::text AS due
  FROM tasks t JOIN workspaces w ON w.id = t.workspace_id
  WHERE t.id IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)}) AND t.deleted_at IS NULL`).then((r) => Array.from(r)) : Promise.resolve([] as Row[]);

/** Your project ends in 3 days and isn't Completed (Normal). A step of the hourly job; once per project and end date. */
export async function notifyProjectsEndingSoon(limit = 200) {
  const rows = Array.from(await db.execute<Row>(sql`
    SELECT t.id, t.title, t.task_number, t.workspace_id, w.slug, t.assignee_id, t.due_date::date::text AS due
    FROM tasks t JOIN workspaces w ON w.id = t.workspace_id AND w.deleted_at IS NULL
    WHERE t.item_type = 'project' AND t.deleted_at IS NULL AND t.assignee_id IS NOT NULL
      AND t.stage IS DISTINCT FROM 'completed' AND t.stage IS DISTINCT FROM 'cancelled'
      AND t.due_date::date = (now() AT TIME ZONE 'UTC')::date + 3
    LIMIT ${limit}`));
  for (const row of rows) await send(row.assignee_id!, null, row, `Ends in 3 days: ${row.title}`, "important", `project-ends:${row.id}:${row.due}`);
  return { projectsEnding: rows.length };
}

/** Your project's blocker moved later and it now starts before the blocker ends (Normal), to the project's assignee. */
export async function notifyProjectConflicts(actorId: string, blocker: { title: string; end: string }, blockedIds: string[]) {
  for (const row of await projects(blockedIds)) {
    if (row.assignee_id && row.assignee_id !== actorId) await send(row.assignee_id, actorId, row, `${row.title} now starts before ${blocker.title} ends`, "important", `project-conflict:${row.id}:${blocker.end}`);
  }
}

/** Projects shifted together (Summary), to each moved project's assignee. */
export async function notifyProjectsShifted(actorId: string, blockerTitle: string, movedIds: string[], days: number, token: string) {
  for (const row of await projects(movedIds)) {
    if (row.assignee_id && row.assignee_id !== actorId) await send(row.assignee_id, actorId, row, `${row.title} moved ${Math.abs(days)} ${Math.abs(days) === 1 ? "day" : "days"} ${days > 0 ? "later" : "earlier"} with ${blockerTitle}`, "more", `project-shift:${row.id}:${token}`);
  }
}

/** Completed project (Summary), to the people on it: its assignee and whoever is assigned its work. */
export async function notifyProjectCompleted(actorId: string, projectTaskId: string) {
  const [row] = await projects([projectTaskId]);
  if (!row) return;
  const people = Array.from(await db.execute<{ id: string }>(sql`
    SELECT DISTINCT assignee_id AS id FROM tasks WHERE (id = ${projectTaskId}::uuid OR part_of_id = ${projectTaskId}::uuid) AND deleted_at IS NULL AND assignee_id IS NOT NULL`));
  for (const p of people) if (p.id !== actorId) await send(p.id, actorId, row, `Completed: ${row.title}`, "more", `project-done:${row.id}:${p.id}:${row.due ?? ""}`);
}

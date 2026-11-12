import "server-only";

import { and, asc, eq, isNull, sql } from "drizzle-orm";

import { wakeChatDueIfSoon } from "@/inngest/wake";
import { db } from "@/lib/db";
import { taskReminders } from "@/lib/db/schema";
import { readableTask, TaskMetaError } from "@/lib/domain/task-meta";
import { logger } from "@/lib/logger";
import { createNotification } from "@/lib/notifications/service";
import { projectTaskHref } from "@/lib/workspaces/task-presentation";

/**
 * `nb task remind 4 "tomorrow 9am"` (report C2, 0088): a reminder is the person's own, about a task they can read.
 * The chat due job fires it (chat/due.wake), so reminders cost no new Inngest function or scheduled runs.
 */
export const TASK_REMINDER_LIMIT = 50;
const PENDING_PER_TASK = 10;

export async function addTaskReminder(userId: string, taskId: string, at: Date, note: string | null, now = new Date()) {
  await readableTask(taskId, userId);
  if (at.getTime() < now.getTime() + 30_000) throw new TaskMetaError("That time has passed: pick one in the future", 409);
  if (at.getTime() > now.getTime() + 366 * 86_400_000) throw new TaskMetaError("Reminders can be up to a year ahead", 409);
  const [pending] = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM task_reminders WHERE task_id = ${taskId} AND user_id = ${userId} AND sent_at IS NULL`);
  if ((pending?.n ?? 0) >= PENDING_PER_TASK) throw new TaskMetaError(`You have ${PENDING_PER_TASK} reminders on this task already`, 409);
  const [row] = await db.insert(taskReminders).values({ taskId, userId, remindAt: at, note: note?.trim().slice(0, 300) || null }).returning();
  await wakeChatDueIfSoon(at, now);
  return row!;
}

export async function listTaskReminders(userId: string, taskId: string) {
  await readableTask(taskId, userId);
  return db.select({ id: taskReminders.id, remindAt: taskReminders.remindAt, note: taskReminders.note }).from(taskReminders)
    .where(and(eq(taskReminders.taskId, taskId), eq(taskReminders.userId, userId), isNull(taskReminders.sentAt))).orderBy(asc(taskReminders.remindAt));
}

export async function cancelTaskReminders(userId: string, taskId: string) {
  const gone = await db.delete(taskReminders).where(and(eq(taskReminders.taskId, taskId), eq(taskReminders.userId, userId), isNull(taskReminders.sentAt))).returning({ id: taskReminders.id });
  return gone.length;
}

type DueTaskReminder = { id: string; user_id: string; task_id: string; note: string | null; remind_at: string; title: string; task_number: number | null; workspace_id: string; slug: string | null; eligible: boolean };

/** Sends what's due as an inbox item (and push or email, as the person's settings say). */
export async function fireDueTaskReminders(limit = TASK_REMINDER_LIMIT) {
  const due = await db.execute<DueTaskReminder>(sql`
    UPDATE task_reminders r SET claim_expires_at = now() + interval '5 minutes'
    FROM tasks t JOIN workspaces w ON w.id = t.workspace_id
    WHERE r.id IN (
      SELECT id FROM task_reminders WHERE sent_at IS NULL AND remind_at <= now() AND (claim_expires_at IS NULL OR claim_expires_at < now())
      ORDER BY remind_at LIMIT ${limit} FOR UPDATE SKIP LOCKED
    ) AND t.id = r.task_id
    RETURNING r.id, r.user_id, r.task_id, r.note, r.remind_at::text AS remind_at, t.title, t.task_number, t.workspace_id, w.slug,
      -- Gone, or the person left the workspace: close it without telling them about the task.
      (t.deleted_at IS NULL AND w.deleted_at IS NULL AND (w.owner_id = r.user_id OR EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = w.id AND m.user_id = r.user_id))) AS eligible`);
  const done = (id: string) => db.update(taskReminders).set({ sentAt: new Date(), claimExpiresAt: null }).where(eq(taskReminders.id, id));
  let reminders = 0;
  for (const row of due) {
    if (!row.eligible) { await done(row.id); continue; }
    try {
      await createNotification({
        recipientUserId: row.user_id,
        kind: "task_reminder",
        category: "mentions",
        importance: "important",
        title: `Reminder: ${row.task_number ? `#${row.task_number} ` : ""}${row.title}`,
        body: row.note,
        href: projectTaskHref(row.slug || row.workspace_id, row.task_id),
        entityRefs: { projectId: row.workspace_id, projectSlug: row.slug, taskId: row.task_id },
        preview: { contextLabel: row.task_number ? `#${row.task_number}` : "Task", contextKind: "task", secondaryText: "Reminder" },
        // One per reminder, so a retry after a crash can't send it twice.
        dedupeKey: `task-reminder:${row.id}`,
      });
      await done(row.id);
      reminders += 1;
    } catch (error) {
      // The claim expires and the next run retries.
      logger.error("tasks.reminder_failed", { module: "tasks", reminderId: row.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { taskReminders: reminders, due: due.length };
}

import "server-only";

import { sql } from "drizzle-orm";

import { wakeChatDueIfSoon } from "@/inngest/wake";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

/**
 * Report 38.8 W7.1 (plan A2.8): "Publish now" reaches the writer at the piece's publish time, as a system row in
 * task_reminders (note "content_publish:") fired by the hourly job's exact-time wake; rewritten whenever the piece
 * moves or changes stage, and closed quietly if it's published or has no writer by then.
 */
export const PUBLISH_NOTE = "content_publish:";

export async function scheduleContentReminder(taskId: string) {
  try {
    const first = await db.transaction(async (tx) => {
      const [r] = Array.from(await tx.execute<{ stage: string | null; assignee_id: string | null; publish_at: string | null }>(sql`
        SELECT stage, assignee_id, type_fields->>'publishAt' AS publish_at FROM tasks
        WHERE id = ${taskId}::uuid AND item_type = 'content' AND deleted_at IS NULL FOR UPDATE`));
      await tx.execute(sql`DELETE FROM task_reminders WHERE task_id = ${taskId}::uuid AND sent_at IS NULL AND note LIKE ${`${PUBLISH_NOTE}%`}`);
      if (!r?.assignee_id || !r.publish_at || r.stage === "idea" || r.stage === "published") return null;
      const at = new Date(r.publish_at);
      if (!(at.getTime() > Date.now())) return null;
      await tx.execute(sql`INSERT INTO task_reminders (task_id, user_id, remind_at, note) VALUES (${taskId}::uuid, ${r.assignee_id}::uuid, ${at.toISOString()}::timestamptz, ${`${PUBLISH_NOTE}now`})`);
      return at;
    });
    if (first) await wakeChatDueIfSoon(first);
  } catch (error) {
    logger.error("content.reminder_schedule_failed", { module: "tasks", taskId, error: error instanceof Error ? error.message : String(error) });
  }
}

/** The fired notice's words, or null when it no longer applies (published, or back to an idea). */
export const publishNoticeTitle = (title: string, stage: string | null) => (stage === "published" || stage === "idea" ? null : `Publish now: ${title}`);

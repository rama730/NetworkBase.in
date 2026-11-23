import "server-only";

import { sql } from "drizzle-orm";

import { wakeChatDueIfSoon } from "@/inngest/wake";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { publishedAt, RESULTS_AFTER_MS } from "@/lib/workflows/content";
import { zonedInstant, zonedParts } from "@/lib/workflows/request-clock";

/**
 * Report 38.8 W7.1 (plan A2.8): "Publish now" reaches the writer at the piece's publish time, as a system row in
 * task_reminders (note "content_publish:") fired by the hourly job's exact-time wake; rewritten whenever the piece
 * moves or changes stage, and closed quietly if it's published or has no writer by then. A2.9 adds "Add results" a
 * week after publishing (Summary level).
 */
export const PUBLISH_NOTE = "content_publish:";
/** W8.1 (A2.9): the results reminder shares the system prefix, so people's own reminder lists never show it. */
export const RESULTS_NOTE = "content_publish:results";

export async function scheduleContentReminder(taskId: string) {
  try {
    const first = await db.transaction(async (tx) => {
      const [r] = Array.from(await tx.execute<{ stage: string | null; assignee_id: string | null; f: Record<string, unknown> | null }>(sql`
        SELECT stage, assignee_id, type_fields AS f FROM tasks
        WHERE id = ${taskId}::uuid AND item_type = 'content' AND deleted_at IS NULL FOR UPDATE`));
      await tx.execute(sql`DELETE FROM task_reminders WHERE task_id = ${taskId}::uuid AND sent_at IS NULL AND note LIKE ${`${PUBLISH_NOTE}%`}`);
      if (!r?.assignee_id) return null;
      const f = r.f ?? {};
      // Publish now, at the publish time, until it's published.
      const pub = typeof f.publishAt === "string" ? new Date(f.publishAt) : null;
      const due = r.stage !== "idea" && r.stage !== "published" && r.stage !== "cancelled" && pub && pub.getTime() > Date.now() ? pub : null;
      // W8.1 (A2.9): Add results, 7 days after publishing, once, unless switched off or already typed.
      const done = publishedAt((f.published ?? {}) as Record<string, { at?: string }>);
      const typed = f.results && Object.keys(f.results as object).length > 0;
      const [sent] = Array.from(await tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM task_reminders WHERE task_id = ${taskId}::uuid AND note = ${RESULTS_NOTE} AND sent_at IS NOT NULL`));
      const results = r.stage === "published" && done && f.resultsReminder !== false && !typed && !sent?.n ? new Date(Date.parse(done) + RESULTS_AFTER_MS) : null;
      const rows = [due ? { at: due, note: `${PUBLISH_NOTE}now` } : null, results && results.getTime() > Date.now() ? { at: results, note: RESULTS_NOTE } : null].filter((x) => x !== null);
      for (const x of rows) await tx.execute(sql`INSERT INTO task_reminders (task_id, user_id, remind_at, note) VALUES (${taskId}::uuid, ${r.assignee_id}::uuid, ${x.at.toISOString()}::timestamptz, ${x.note})`);
      return rows.map((x) => x.at).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
    });
    if (first) await wakeChatDueIfSoon(first);
  } catch (error) {
    logger.error("content.reminder_schedule_failed", { module: "tasks", taskId, error: error instanceof Error ? error.message : String(error) });
  }
}

/** The fired notice's words and level, or null when it no longer applies. */
export function contentNotice(note: string, title: string, stage: string | null) {
  if (note === RESULTS_NOTE) return stage === "published" ? { title: `Add results: ${title}`, importance: "more" as const } : null;
  return stage === "published" || stage === "idea" || stage === "cancelled" ? null : { title: `Publish now: ${title}`, importance: "important" as const };
}

/**
 * W9.1 (live check, A2.8): the panel's Publish date is the due date; changing it moves the piece's publish time to that
 * day at the same time of day (the workspace's default time when it had none), and its reminders with it. Cleared: no time.
 */
export async function publishAtFollowsDue(taskId: string) {
  const [r] = Array.from(await db.execute<{ due: string | null; publish_at: string | null; tz: string | null; default_time: string | null }>(sql`
    SELECT t.due_date::text AS due, t.type_fields->>'publishAt' AS publish_at, w.time_zone AS tz, w.workflow_settings->'content'->>'defaultTime' AS default_time
    FROM tasks t JOIN workspaces w ON w.id = t.workspace_id WHERE t.id = ${taskId}::uuid AND t.item_type = 'content' AND t.deleted_at IS NULL`));
  if (!r) return;
  const tz = r.tz || "UTC";
  const time = r.publish_at ? zonedParts(new Date(r.publish_at), tz).time : /^\d{2}:\d{2}$/.test(r.default_time ?? "") ? r.default_time! : "10:00";
  const next = r.due ? zonedInstant(r.due.slice(0, 10), time, tz).toISOString() : null;
  if (next !== (r.publish_at ? new Date(r.publish_at).toISOString() : null)) {
    await db.execute(sql`UPDATE tasks SET type_fields = coalesce(type_fields, '{}'::jsonb) || jsonb_build_object('publishAt', ${next}::text) WHERE id = ${taskId}::uuid`);
  }
  await scheduleContentReminder(taskId);
}

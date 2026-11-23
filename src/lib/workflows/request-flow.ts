import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { readWorkingHours, scheduleRequestClock } from "@/lib/workflows/request-clock-server";
import { workingMinutesBetween } from "@/lib/workflows/request-clock";

/**
 * Report 38.7 W5 and part 6 (plan A2.6): Waiting on you pauses the deliver clock without changing the stage (call 4);
 * the awaited person's reply resumes it. The first comment by anyone other than the asker is the first reply.
 */
type Row = { id: string; workspace_id: string; creator_id: string | null; stage: string | null; type_fields: Record<string, unknown> | null };

export async function readRequest(taskId: string) {
  const [r] = Array.from(await db.execute<Row>(sql`
    SELECT id, workspace_id, creator_id, stage, type_fields FROM tasks WHERE id = ${taskId}::uuid AND item_type = 'request' AND deleted_at IS NULL`));
  return r ?? null;
}

export async function mergeRequestFields(taskId: string, patch: Record<string, unknown>) {
  await db.execute(sql`UPDATE tasks SET type_fields = coalesce(type_fields, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb WHERE id = ${taskId}::uuid`);
}

/** Ends a pause: the paused working minutes are added up so the deadline moves by exactly that much. */
export async function resumeWaiting(taskId: string, now = new Date()) {
  const r = await readRequest(taskId);
  const waiting = r?.type_fields?.waiting as { since?: string } | null | undefined;
  if (!r || !waiting?.since) return false;
  const { hours, tz } = await readWorkingHours(r.workspace_id);
  const paused = (typeof r.type_fields?.pausedMinutes === "number" ? r.type_fields.pausedMinutes : 0) + workingMinutesBetween(new Date(waiting.since), now, hours, tz);
  await mergeRequestFields(taskId, { waiting: null, pausedMinutes: paused });
  await scheduleRequestClock(taskId);
  return true;
}

/** Called after every task comment: a reply by the awaited person resumes; the first non-asker comment is the first reply. */
export async function afterRequestComment(taskId: string, authorId: string) {
  try {
    const r = await readRequest(taskId);
    if (!r) return;
    const f = r.type_fields ?? {};
    if (!f.firstRepliedAt && authorId !== r.creator_id && r.stage === "new") {
      await mergeRequestFields(taskId, { firstRepliedAt: new Date().toISOString() });
      await scheduleRequestClock(taskId);
    }
    if ((f.waiting as { onUserId?: string } | null)?.onUserId === authorId) await resumeWaiting(taskId);
  } catch (error) {
    logger.error("requests.comment_hook_failed", { module: "tasks", taskId, error: error instanceof Error ? error.message : String(error) });
  }
}

/** After a stage move: In review asks the asker to look; Delivered stamps the time and asks "Did this solve it?". */
export async function onRequestTransition(taskId: string, previousStage: string | null, actorId: string) {
  try {
    const r = await readRequest(taskId);
    if (!r || r.stage === previousStage) return;
    const { notifyRequestPerson } = await import("@/lib/workflows/request-notify");
    if (previousStage === "delivered") await mergeRequestFields(taskId, { deliveredAt: null, solved: null });
    if (r.stage === "in_review") await notifyRequestPerson(taskId, actorId, "asker", "Does this work");
    if (r.stage === "delivered" && !r.type_fields?.deliveredAt) {
      await mergeRequestFields(taskId, { deliveredAt: new Date().toISOString(), solved: null, waiting: null });
      await notifyRequestPerson(taskId, actorId, "asker", "Delivered — did this solve it");
    }
  } catch (error) {
    logger.error("requests.transition_hook_failed", { module: "tasks", taskId, error: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * Call 5: the asker's No reopens their delivered request to In progress even when they can't move others' work. The
 * caller checked they're the asker and it's Delivered; the lock is taken as the handler (or the owner), the move is
 * recorded as the asker's.
 */
export async function reopenForAsker(taskId: string, asker: { id: string; user_metadata?: Record<string, unknown> | null }) {
  const { afterTaskTransition, lockTaskForWrite, transitionTaskTx } = await import("@/lib/workspaces/task-transition-service");
  const [t] = Array.from(await db.execute<{ lock_as: string }>(sql`
    SELECT coalesce(t.assignee_id, w.owner_id) AS lock_as FROM tasks t JOIN workspaces w ON w.id = t.workspace_id WHERE t.id = ${taskId}::uuid`));
  if (!t) throw new Error("Not found");
  const { locked, result } = await db.transaction(async (tx) => {
    const locked = await lockTaskForWrite(tx, taskId, t.lock_as);
    return { locked, result: await transitionTaskTx(tx, locked, { taskId, userId: asker.id, stage: "in_progress" }) };
  });
  await afterTaskTransition(asker, locked, taskId, result);
}

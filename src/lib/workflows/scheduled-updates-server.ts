import { and, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { tasks, workspaceScheduledUpdates } from "@/lib/db/schema";
import { logger } from "@/lib/logger";
import { runAsUser } from "@/lib/server/acting-as";

/**
 * Report 38.17 W3 (plan A7.4, calls 2–3): the hourly job's step that posts scheduled Updates when they're due. Each
 * row is claimed for five minutes so two runs can't post it twice; it posts as its author through the ordinary post
 * action (their rights are checked then); success or failure is told to the author.
 */
export const SCHEDULED_UPDATE_LIMIT = 50;
type Row = typeof workspaceScheduledUpdates.$inferSelect;

export async function fireDueScheduledUpdates(limit = SCHEDULED_UPDATE_LIMIT) {
  const due = Array.from(await db.execute<{ id: string }>(sql`
    UPDATE workspace_scheduled_updates SET claim_expires_at = now() + interval '5 minutes'
    WHERE id IN (
      SELECT id FROM workspace_scheduled_updates
      WHERE published_at IS NULL AND cancelled_at IS NULL AND failed_reason IS NULL AND publish_at <= now()
        AND (claim_expires_at IS NULL OR claim_expires_at < now())
      ORDER BY publish_at LIMIT ${limit} FOR UPDATE SKIP LOCKED)
    RETURNING id`));
  let posted = 0;
  for (const { id } of due) {
    const [row] = await db.select().from(workspaceScheduledUpdates).where(eq(workspaceScheduledUpdates.id, id)).limit(1);
    if (row && (await postScheduledRow(row)).posted) posted++;
  }
  return { scheduledUpdatesDue: due.length, scheduledUpdatesPosted: posted };
}

/** Post one claimed row as its author; mark it posted or failed, and tell the author. */
export async function postScheduledRow(row: Row): Promise<{ posted: true; updateId: string } | { posted: false; reason: string }> {
  const { createWorkspaceUpdateAction } = await import("@/app/actions/workspace/updates");
  // ponytail: if the process dies between posting and marking, the claim lapses and the row could post again; the
  // window is one statement. A posted-update link written in the same transaction needs the post moved into lib.
  const result = await runAsUser(row.authorId, () => createWorkspaceUpdateAction(row.projectId, {
    content: row.content, updateType: row.updateType, visibility: row.visibility, media: row.media as never, entityRefs: row.entityRefs as never,
  })).catch((error: unknown) => ({ success: false as const, error: error instanceof Error ? error.message : "Couldn’t post" }));
  const updateId = result.success && result.data ? result.data.id : null;
  if (result.success && updateId) {
    await db.update(workspaceScheduledUpdates).set({ publishedUpdateId: updateId, publishedAt: new Date(), claimExpiresAt: null, updatedAt: new Date() }).where(eq(workspaceScheduledUpdates.id, row.id));
    if (row.sourceTaskId) await markContentPublished(row, updateId);
    await tell(row, "posted");
    return { posted: true, updateId };
  }
  const reason = (!result.success && result.error) || "It couldn’t be posted.";
  await db.update(workspaceScheduledUpdates).set({ failedReason: reason.slice(0, 300), claimExpiresAt: null, updatedAt: new Date() }).where(eq(workspaceScheduledUpdates.id, row.id));
  await tell(row, "failed", reason);
  return { posted: false, reason };
}

/** T5: a content item scheduled as an Update becomes Published with this Update as its link (its NetworkBase channel). */
async function markContentPublished(row: Row, updateId: string) {
  try {
    const [task] = await db.select({ projectId: tasks.projectId }).from(tasks).where(and(eq(tasks.id, row.sourceTaskId!), isNull(tasks.deletedAt))).limit(1);
    if (task?.projectId !== row.projectId) return;
    const { readContentSettings } = await import("@/lib/workflows/content-store");
    const channel = (await readContentSettings(row.projectId))?.channels.find((c) => c.updates)?.id;
    if (!channel) return;
    const { markPublishedAction } = await import("@/app/actions/content");
    await runAsUser(row.authorId, () => markPublishedAction({ projectId: row.projectId, taskId: row.sourceTaskId!, links: { [channel]: { updateId } } }));
  } catch (error) {
    logger.warn("scheduled_update.content_publish_failed", { error: error instanceof Error ? error.message : String(error) });
  }
}

async function tell(row: Row, outcome: "posted" | "failed", reason?: string) {
  const { createNotification } = await import("@/lib/notifications/service");
  await createNotification({ recipientUserId: row.authorId, actorUserId: null, kind: "project_update_activity", category: "projects",
    importance: outcome === "failed" ? "important" : "more",
    title: outcome === "posted" ? "Your scheduled update posted" : `Your scheduled update didn’t post: ${reason ?? ""}`.slice(0, 200),
    href: `/workspaces/${encodeURIComponent(row.projectId)}?tab=updates`, entityRefs: { projectId: row.projectId }, dedupeKey: `scheduled-update:${row.id}:${outcome}` }).catch(() => undefined);
}

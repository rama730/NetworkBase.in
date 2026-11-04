import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { workspaceNodes } from "@/lib/db/schema";
import { finishPermanentDelete, markExpiredTrash } from "@/lib/files/permanent-delete";
import { logger } from "@/lib/logger";
import { inngest } from "../client";

// Durable tombstones also cover a process crash before any event is dispatched.
export const finishPendingFileDeletions = inngest.createFunction(
  { id: "project-files-permanent-delete", retries: 2, concurrency: 1 },
  // ponytail: 6-hourly sweep handles crashed delete tombstones without high-frequency polling. ceiling: 6-hourly cron sweep. upgrade: event-driven file.deleted trigger if instant tombstone recovery required.
  { cron: "0 */6 * * *" },
  async ({ step }) => {
    // Trash older than 30 days joins the queue below. ponytail: 20 a run keeps Inngest steps
    // under ~80 a day; a large expired Trash drains over a few days.
    await step.run("mark-expired-trash", () => markExpiredTrash(20));
    const pending = await step.run("read-pending-deletions", () =>
      db
        .select({ id: workspaceNodes.id, projectId: workspaceNodes.projectId })
        .from(workspaceNodes)
        .where(
          and(
            isNotNull(workspaceNodes.deletedAt),
            sql`${workspaceNodes.metadata}->>'permanentDeleteRoot' = ${workspaceNodes.id}::text`,
          ),
        )
        .orderBy(asc(workspaceNodes.updatedAt))
        .limit(500),
    );
    for (const node of pending)
      await step.run(`finish-${node.id}`, async () => {
        try {
          return await finishPermanentDelete(node.projectId, node.id);
        } catch (error) {
          // Rotate failed work behind other tombstones; one unavailable blob must
          // not starve unrelated deletions. The durable intent remains retryable.
          await db
            .update(workspaceNodes)
            .set({ updatedAt: new Date() })
            .where(
              and(
                eq(workspaceNodes.id, node.id),
                eq(workspaceNodes.projectId, node.projectId),
              ),
            );
          logger.error("File deletion cleanup will retry", {
            projectId: node.projectId,
            nodeId: node.id,
            error: error instanceof Error ? error.message : String(error),
          });
          return { pending: true };
        }
      });
    return { processed: pending.length };
  },
);

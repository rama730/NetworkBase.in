import { and, inArray, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { attachmentUploads, storageAssets } from "@/lib/db/schema";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/server";

import { inngest } from "../client";

const ATTACHMENTS_BUCKET = "chat-attachments";
const CLEANUP_BATCH_SIZE = 500;
const MAX_CLEANUP_ITERATIONS = 10;

export const messageAttachmentRetention = inngest.createFunction(
  {
    id: "message-attachment-retention",
    name: "Expire and remove uncommitted message attachments",
    retries: 3,
  },
  { cron: "0 */2 * * *" },
  async ({ step }) => {
    let totalClaimed = 0;
    let totalDeleted = 0;
    let totalFailed = 0;

    for (let iteration = 0; iteration < MAX_CLEANUP_ITERATIONS; iteration++) {
      const claimed = await step.run(`claim-expired-uploads-${iteration}`, async () => {
        return db.transaction(async (tx) => {
          return tx.execute<{
            id: string;
            storage_path: string | null;
            asset_id: string | null;
          }>(sql`
            WITH candidates AS (
              SELECT id
              FROM ${attachmentUploads}
              WHERE status <> 'committed'
                AND (
                  (expires_at IS NOT NULL AND expires_at <= now())
                  OR error LIKE 'cleanup_pending:%'
                )
              ORDER BY updated_at ASC, id ASC
              FOR UPDATE SKIP LOCKED
              LIMIT ${CLEANUP_BATCH_SIZE}
            )
            UPDATE ${attachmentUploads} upload
            SET
              status = 'expired',
              error = 'cleanup_in_progress',
              updated_at = now()
            FROM candidates
            WHERE upload.id = candidates.id
            RETURNING upload.id, upload.storage_path, upload.asset_id
          `);
        });
      });

      const rows = Array.from(claimed);
      if (rows.length === 0) {
        break;
      }

      totalClaimed += rows.length;

      const paths = Array.from(new Set(
        rows
          .filter((row) => !row.asset_id)
          .map((row) => row.storage_path)
          .filter((path): path is string => Boolean(path)),
      ));

      let cleanupError: string | null = null;
      if (paths.length > 0) {
        cleanupError = await step.run(`remove-expired-objects-${iteration}`, async () => {
          const admin = await createAdminClient();
          const { error } = await admin.storage.from(ATTACHMENTS_BUCKET).remove(paths);
          return error?.message ?? null;
        });
      }

      const ids = rows.map((row) => row.id);
      const assetIds = rows.flatMap((row) => row.asset_id ? [row.asset_id] : []);
      if (cleanupError) {
        totalFailed += ids.length;
        await step.run(`record-cleanup-retry-${iteration}`, async () => {
          await db
            .update(attachmentUploads)
            .set({
              status: "failed",
              error: `cleanup_pending:${cleanupError}`,
              updatedAt: new Date(),
            })
            .where(inArray(attachmentUploads.id, ids));
        });
        logger.error("messages.attachments.cleanup_failed", {
          module: "messaging",
          count: ids.length,
          error: cleanupError,
        });
        break;
      }

      totalDeleted += paths.length;

      await step.run(`finalize-expired-uploads-${iteration}`, async () => {
        await db.transaction(async (tx) => {
          if (assetIds.length > 0) {
            await tx.update(storageAssets)
              .set({
                state: "delete_pending",
                deleteAfter: sql`GREATEST(${storageAssets.expiresAt} + interval '5 minutes', now())`,
                updatedAt: new Date(),
              })
              .where(and(
                inArray(storageAssets.id, assetIds),
                inArray(storageAssets.state, ["pending", "verified"]),
              ));
          }
          await tx
            .update(attachmentUploads)
            .set({
              storagePath: null,
              error: null,
              updatedAt: new Date(),
            })
            .where(inArray(attachmentUploads.id, ids));
        });
      });

      if (rows.length < CLEANUP_BATCH_SIZE) {
        break;
      }
    }

    return { claimed: totalClaimed, deleted: totalDeleted, failed: totalFailed };
  },
);

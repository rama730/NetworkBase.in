import { inngest } from "../client";
import {
  cleanupExpiredStorageAssetPins,
  deleteEligibleStorageAssets,
  scheduleAbandonedStorageAssets,
} from "@/lib/storage/asset-deletion";
import { deleteLegacyStorageCleanupTargets } from "@/lib/storage/legacy-cleanup";
import { logger } from "@/lib/logger";
import { emitStorageQueueMetrics } from "@/lib/storage/observability";

export const storageAssetDeletion = inngest.createFunction(
  { id: "storage-asset-deletion", concurrency: 1 },
  { cron: "0 */2 * * *" },
  async ({ step }) => {
    const scheduled = await step.run("schedule-abandoned-assets", scheduleAbandonedStorageAssets);
    const pins = await step.run("cleanup-expired-storage-pins", cleanupExpiredStorageAssetPins);
    const deleted = await step.run("delete-eligible-assets", deleteEligibleStorageAssets);
    const legacy = await step.run("delete-legacy-cleanup-targets", deleteLegacyStorageCleanupTargets);
    await step.run("emit-storage-queue-metrics", emitStorageQueueMetrics);
    logger.metric("storage.asset_cleanup.batch", {
      module: "storage",
      action: "cleanup",
      outcome: deleted.retryable + legacy.retryable > 0 ? "retrying" : "success",
      scheduled: scheduled.scheduled,
      claimed: deleted.claimed + legacy.claimed,
      deleted: deleted.deleted + legacy.deleted,
      retryable: deleted.retryable + legacy.retryable,
      expiredPins: pins.expiredPins,
    });
    return { ...scheduled, ...pins, ...deleted, legacy };
  },
);

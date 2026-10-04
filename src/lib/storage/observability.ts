import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  normalizeStorageQueueRow,
  STORAGE_QUEUE_DEPTH_LIMIT,
  type RawStorageQueueRow,
} from "@/lib/storage/storage-observability-contract";

const READ_LIMIT = STORAGE_QUEUE_DEPTH_LIMIT + 1;

/**
 * Reads only the first 10,001 due rows from each queue. This makes the metric
 * useful during an outage without turning observability into an unbounded
 * COUNT(*) scan at production scale.
 */
export async function emitStorageQueueMetrics() {
  const rows = await db.execute<RawStorageQueueRow>(sql`
    SELECT 'verification'::text AS queue, count(*) AS depth, min(queued_at) AS oldest_at
    FROM (
      SELECT updated_at AS queued_at
      FROM public.storage_assets
      WHERE state = 'pending'
        AND (verification_lease_token IS NOT NULL OR last_error_code IS NOT NULL)
      ORDER BY verification_lease_expires_at NULLS FIRST, updated_at, id
      LIMIT ${READ_LIMIT}
    ) verification_queue
    UNION ALL
    SELECT 'backup'::text AS queue, count(*) AS depth, min(queued_at) AS oldest_at
    FROM (
      SELECT coalesce(verified_at, updated_at) AS queued_at
      FROM public.storage_assets
      WHERE backup_state = 'pending' AND state IN ('verified', 'delete_pending')
      ORDER BY verified_at NULLS FIRST, id
      LIMIT ${READ_LIMIT}
    ) backup_queue
    UNION ALL
    SELECT 'deletion'::text AS queue, count(*) AS depth, min(queued_at) AS oldest_at
    FROM (
      SELECT delete_after AS queued_at
      FROM public.storage_assets
      WHERE state = 'delete_pending' AND delete_after <= now()
      ORDER BY delete_after, id
      LIMIT ${READ_LIMIT}
    ) deletion_queue
    UNION ALL
    SELECT 'deletion_lease'::text AS queue, count(*) AS depth, min(queued_at) AS oldest_at
    FROM (
      SELECT deletion_lease_expires_at AS queued_at
      FROM public.storage_assets
      WHERE state = 'deleting' AND deletion_lease_expires_at <= now()
      ORDER BY deletion_lease_expires_at, id
      LIMIT ${READ_LIMIT}
    ) deletion_lease_queue
    UNION ALL
    SELECT 'legacy_cleanup'::text AS queue, count(*) AS depth, min(queued_at) AS oldest_at
    FROM (
      SELECT next_attempt_at AS queued_at
      FROM public.storage_legacy_cleanup_targets
      WHERE state IN ('pending', 'retry') AND next_attempt_at <= now()
      ORDER BY next_attempt_at, id
      LIMIT ${READ_LIMIT}
    ) legacy_cleanup_queue
    UNION ALL
    SELECT 'repair'::text AS queue, count(*) AS depth, min(queued_at) AS oldest_at
    FROM (
      SELECT coalesce(next_retry_at, created_at) AS queued_at
      FROM public.storage_repair_failures
      WHERE resolved_at IS NULL AND (next_retry_at IS NULL OR next_retry_at <= now())
      ORDER BY next_retry_at NULLS FIRST, created_at, id
      LIMIT ${READ_LIMIT}
    ) repair_queue
  `);

  const snapshots = Array.from(rows, (row) => normalizeStorageQueueRow(row));
  for (const snapshot of snapshots) {
    logger.metric("storage.queue.snapshot", {
      module: "storage",
      action: "queue_snapshot",
      outcome: snapshot.depth > 0 ? "backlog" : "idle",
      queue: snapshot.queue,
      depth: snapshot.depth,
      capped: snapshot.capped,
      oldestAgeMs: snapshot.oldestAgeMs,
    });
  }
  return snapshots;
}

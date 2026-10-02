export const STORAGE_QUEUE_DEPTH_LIMIT = 10_000;

export type StorageQueueName =
  | "verification"
  | "backup"
  | "deletion"
  | "deletion_lease"
  | "legacy_cleanup"
  | "repair";

export type RawStorageQueueRow = {
  queue: StorageQueueName;
  depth: number | string;
  oldest_at: Date | string | null;
};

export type StorageQueueSnapshot = {
  queue: StorageQueueName;
  depth: number;
  capped: boolean;
  oldestAgeMs: number;
};

export function normalizeStorageQueueRow(
  row: RawStorageQueueRow,
  nowMs = Date.now(),
): StorageQueueSnapshot {
  const rawDepth = Math.max(0, Number(row.depth) || 0);
  const oldestMs = row.oldest_at == null ? nowMs : new Date(row.oldest_at).getTime();
  return {
    queue: row.queue,
    depth: Math.min(rawDepth, STORAGE_QUEUE_DEPTH_LIMIT),
    capped: rawDepth > STORAGE_QUEUE_DEPTH_LIMIT,
    oldestAgeMs: Number.isFinite(oldestMs) ? Math.max(0, nowMs - oldestMs) : 0,
  };
}

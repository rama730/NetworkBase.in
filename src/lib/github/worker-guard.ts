
import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { GITHUB_SYNC_LIMITS } from "@/lib/github/sync-limits";

const TENANT_LOCK_NAMESPACE = "project-git-sync-tenant";

function readPositiveEnv(name: string, fallback: number) {
  const raw = Number(process.env[name] || fallback);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}

export const GITHUB_WORKER_BUDGETS = {
  maxFiles: readPositiveEnv(
    "GITHUB_SYNC_MAX_FILES",
    GITHUB_SYNC_LIMITS.repositoryFiles,
  ),
  maxBytes: readPositiveEnv(
    "GITHUB_SYNC_MAX_BYTES",
    GITHUB_SYNC_LIMITS.repositoryBytes,
  ),
  maxSingleFileBytes: readPositiveEnv(
    "GITHUB_SYNC_MAX_FILE_BYTES",
    GITHUB_SYNC_LIMITS.fileBytes,
  ),
  applyConcurrency: readPositiveEnv("GITHUB_SYNC_APPLY_CONCURRENCY", 8),
};

export async function withTenantSyncLock<T>(
  tenantId: string | null | undefined,
  task: () => Promise<T>,
): Promise<{ skipped: boolean; value: T | null }> {
  if (!tenantId) {
    return {
      skipped: false,
      value: await task(),
    };
  }

  // ponytail: transaction-scoped advisory lock (pg_try_advisory_xact_lock) releases automatically on commit/rollback. ceiling: single Postgres primary. upgrade: Redis redlock if multi-region active-active deployment required.
  return await db.transaction(async (tx) => {
    const lockResult = await tx.execute<{ locked: boolean }>(sql`
      SELECT pg_try_advisory_xact_lock(
        hashtext(${TENANT_LOCK_NAMESPACE}),
        hashtext(CAST(${tenantId} AS text))
      ) AS locked
    `);
    const lockRow = Array.from(lockResult)[0];
    const lockAcquired = !!lockRow?.locked;
    if (!lockAcquired) {
      return { skipped: true, value: null };
    }

    const value = await task();
    return { skipped: false, value };
  });
}


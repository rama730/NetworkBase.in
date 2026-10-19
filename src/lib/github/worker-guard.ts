
import { GITHUB_SYNC_LIMITS } from "@/lib/github/sync-limits";

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

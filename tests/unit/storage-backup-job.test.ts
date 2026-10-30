import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("the backup job checks for a bucket before it reads storage_assets", () => {
  const source = readFileSync("src/lib/storage/asset-backup.ts", "utf8");
  const job = source.slice(source.indexOf("export async function backupPendingStorageAssets"));
  assert.ok(job.indexOf("getS3BackupConfig()") > 0);
  assert.ok(job.indexOf("getS3BackupConfig()") < job.indexOf(".from(storageAssets)"));
});

test("the backup index matches the job's order", () => {
  const sql = readFileSync("drizzle/0025_storage_backup_due_index.sql", "utf8");
  assert.match(sql, /\(\(last_error_code IS NOT NULL\), updated_at, id\)/);
  assert.match(sql, /WHERE backup_state = 'pending' AND state IN \('verified', 'delete_pending'\)/);
});

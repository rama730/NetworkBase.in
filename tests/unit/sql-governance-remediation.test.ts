import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const source = (relativePath: string) =>
  fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");

test("forward migrations own missing task lineage and native hardening", () => {
  const lineage = source("drizzle/0153_task_server_table_lineage.sql");
  const hardening = source("drizzle/0154_native_database_security_hardening.sql");

  assert.match(lineage, /CREATE TABLE IF NOT EXISTS public\.task_pushes/);
  assert.match(lineage, /CREATE TABLE IF NOT EXISTS public\.task_read_receipts/);
  for (const column of ["added_by", "project_id", "removed_by"]) {
    assert.match(lineage, new RegExp(`sprint_task_memberships \\(${column}\\)`));
  }
  assert.match(hardening, /profiles_id_auth_users_fk/);
  assert.match(hardening, /FOREIGN KEY \(id\) REFERENCES auth\.users\(id\).*NOT VALID/);
  assert.match(hardening, /DROP INDEX IF EXISTS public\.dm_pairs_user_low_user_high_key/);
  assert.match(hardening, /SET search_path = ''/);
  assert.match(hardening, /member\.role <> 'viewer'/);
});

test("migration lineage is exact and the duplicate backfill is quarantined", () => {
  const journal = JSON.parse(source("drizzle/meta/_journal.json")) as {
    entries: Array<{ idx: number; tag: string }>;
  };
  const manifest = JSON.parse(source("standards/sql-governance.manifest.json")) as {
    strictLineageFromIndex: number;
    existingMigrationFiles: string[];
    breakGlassExceptions: Array<{ path: string }>;
  };
  const tags = new Set(journal.entries.map((entry) => entry.tag));

  for (const tag of [
    "0153_task_server_table_lineage",
    "0154_native_database_security_hardening",
    "0155_account_deletion_privacy",
    "0156_profile_counter_authority",
  ]) {
    assert.ok(tags.has(tag));
    assert.ok(manifest.existingMigrationFiles.includes(`drizzle/${tag}.sql`));
  }
  assert.equal(manifest.strictLineageFromIndex, 152);
  assert.deepEqual(manifest.breakGlassExceptions, []);
});

test("hard-delete retries Auth finalization and retention anonymizes the kept identity", () => {
  const hardDelete = source("src/lib/account/hard-delete.ts");
  const accountAction = source("src/app/actions/account.ts");

  // Destructive phase only from storage_scheduled; a failed Auth call keeps db_deleted for retry (COR-053).
  assert.match(hardDelete, /deletion\.phase !== "storage_scheduled"/);
  assert.match(hardDelete, /eq\(accountDeletions\.cleanupStatus, "db_deleted"\)/);
  assert.match(hardDelete, /minimalRegistrationRecordRetained: true/);
  const retention = source("src/inngest/functions/data-lifecycle-retention.ts");
  assert.match(retention, /legal_retention_until < now\(\)/);
  assert.match(retention, /SET user_id = deletion\.id,\s*email = 'deleted-account@invalid',\s*username = NULL/);
  assert.doesNotMatch(accountAction, /randomBytes\(32\).*confirmationToken/);
});

test("project node events are one plain table", () => {
  const registry = source("src/inngest/registry.ts");
  const migration = source("drizzle/0173_node_events_single_table.sql");

  assert.equal(fs.existsSync(path.join(process.cwd(), "src/inngest/functions/database-partition-maintenance.ts")), false);
  assert.doesNotMatch(registry, /databasePartitionMaintenance/);
  assert.match(migration, /DROP FUNCTION IF EXISTS public\.create_future_partitions\(\)/);
  assert.doesNotMatch(migration, /PARTITION BY/);
});

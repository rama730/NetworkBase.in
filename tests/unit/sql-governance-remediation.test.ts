import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const source = (relativePath: string) =>
  fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");

test("migrations own the task tables and the native hardening", () => {
  const tasks = source("drizzle/0008_tasks_sprints.sql");
  const accounts = source("drizzle/0002_profiles_accounts.sql");

  assert.match(tasks, /CREATE TABLE public\.task_pushes /);
  assert.match(tasks, /CREATE TABLE public\.task_read_receipts /);
  for (const column of ["added_by", "workspace_id", "removed_by"]) {
    assert.match(tasks, new RegExp(`ON public\\.sprint_task_memberships USING btree \\(${column}\\)`));
  }
  assert.match(accounts, /profiles_id_auth_users_fk FOREIGN KEY \(id\) REFERENCES auth\.users\(id\).*NOT VALID/);
  assert.match(source("drizzle/0006_workspaces_members.sql"), /member\.role <> 'viewer'/);
});

test("migration lineage is exact and nothing is quarantined", () => {
  const journal = JSON.parse(source("drizzle/meta/_journal.json")) as {
    entries: Array<{ idx: number; tag: string }>;
  };
  const manifest = JSON.parse(source("standards/sql-governance.manifest.json")) as {
    strictLineageFromIndex: number;
    existingMigrationFiles: string[];
    breakGlassExceptions: Array<{ path: string }>;
  };
  assert.deepEqual(manifest.existingMigrationFiles, journal.entries.map((entry) => `drizzle/${entry.tag}.sql`));
  assert.ok(manifest.strictLineageFromIndex > 0 && manifest.strictLineageFromIndex <= journal.entries.length);
  assert.equal(journal.entries[0]?.tag, "0001_foundation");
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
  const migration = source("drizzle/0009_files.sql");

  assert.equal(fs.existsSync(path.join(process.cwd(), "src/inngest/functions/database-partition-maintenance.ts")), false);
  assert.doesNotMatch(registry, /databasePartitionMaintenance/);
  assert.match(migration, /CREATE TABLE public\.workspace_node_events /);
  assert.doesNotMatch(migration, /create_future_partitions|PARTITION BY/);
});

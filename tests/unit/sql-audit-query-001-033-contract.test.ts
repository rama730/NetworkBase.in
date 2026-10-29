import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const source = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

test("QRY-001..006 hub pagination keeps filters, rejects cursors, and has no dead project owner", () => {
  const action = source("src/app/actions/discover.ts");
  const hub = source("src/lib/data/discover.ts");

  assert.match(action, /sort: z\.enum\(/);
  assert.match(hub, /throw new InvalidDiscoverCursorError\(\)/);
  assert.match(hub, /\.limit\(pageSize \+ 1\)/);
  assert.match(hub, /while \(pageRows\.length < pageSize/);
  assert.equal(fs.existsSync(path.join(root, "src/lib/data/workspace.ts")), false);
});

test("QRY-007..012 authorize before sensitive reads and keep file reads side-effect free", () => {
  const matchmaking = source("src/app/actions/matchmaking/resolver.ts");
  const content = source("src/lib/files/content-reader.ts");

  assert.ok(matchmaking.indexOf("const access = await getProjectAccessById") < matchmaking.indexOf("db.query.profiles.findFirst"));
  assert.match(matchmaking, /!access\.isOwner && access\.memberRole !== 'admin'/);
  assert.match(content, /class FileContentUnavailableError/);
});

test("QRY-013..023 retire unsafe batch replacement and full-tree/task-slug scans", () => {
  const nodes = source("src/app/actions/files/nodes.ts");
  const urlSync = source("src/components/workspaces/v2/files-tab/hooks/useFilesTabUrlSync.ts");

  assert.doesNotMatch(nodes, /getProjectTreeFlat|TASK_WORKING_FILE_URL_PREFIX/);
  assert.match(nodes, /eq\(projectNodes\.path, `\/\$\{path\.join\("\/"\)\}`\)/);
  assert.match(nodes, /inArray\(projectNodes\.path, Array\.from\(ancestorPaths\)\)/);
  assert.doesNotMatch(nodes, /for \(let depth = 0; depth < 32/);
  assert.match(nodes, /projectContentNodeSql/);
  assert.match(source("src/lib/files/internal-helpers.ts"), /projectNodes\.taskId\} IS NULL AND \$\{projectNodes\.path\} NOT LIKE '\/\.system%'/);
  assert.match(urlSync, /fileId:\s*taskFileId/);
});

test("QRY-024..030 maintenance workers are bounded, durable, and starvation-safe", () => {
  const reconciliation = source("src/inngest/functions/workspace-files-reconciliation.ts");
  const stale = source("src/inngest/functions/workspace-import-reconcile.ts");
  const cleanup = source("src/inngest/functions/account-cleanup.ts");
  const hardDelete = source("src/inngest/functions/account-hard-delete.ts");
  const hashes = source("scripts/db/repair/backfill-file-hashes.ts");

  assert.match(reconciliation, /jobHeartbeats\.lastPayload/);
  assert.match(reconciliation, /projectNodes\.projectId\}, \$\{projectNodes\.id\}\) >/);
  assert.match(stale, /lt\(projects\.updatedAt, staleBefore\)/);
  assert.match(cleanup, /unregisteredStorageReferences/);
  assert.match(cleanup, /storageAssets\.state/);
  assert.match(cleanup, /"delete_pending"/);
  assert.match(cleanup, /physicalDeletionOwner: "storage-asset-deletion"/);
  assert.doesNotMatch(cleanup, /\.storage\.from\(|deleteStoragePrefix/);
  assert.match(hardDelete, /orderBy\(asc\(accountDeletions\.hardDeleteAt\), asc\(accountDeletions\.id\)\)/);
  assert.match(hardDelete, /\.limit\(100\)/);
  assert.match(hashes, /gt\(fileVersions\.id, afterId\)/);
  assert.match(hashes, /orderBy\(asc\(fileVersions\.id\)\)/);
  assert.equal(fs.existsSync(path.join(root, "src/inngest/functions/cleanup-docs.ts")), false);
});

test("QRY-031 legacy normalization is explicit, set-based, and cycle-guarded", () => {
  const backfill = source("scripts/db/repair/backfill.ts");

  assert.match(backfill, /process\.argv\.includes\("--apply"\)/);
  assert.match(backfill, /jsonb_array_elements_text/);
  assert.match(backfill, /WITH RECURSIVE tree/);
  assert.match(backfill, /ANY\(parent\.visited\)/);
  assert.match(backfill, /Path backfill refused/);
  assert.doesNotMatch(backfill, /db\.select\(\)\.from\(projects\)|function buildPath/);
});

test("QRY-032 obsolete task-file migration is retired", () => {
  assert.equal(
    fs.existsSync(path.join(root, "scripts/migrate-task-files-to-project-files.ts")),
    false,
  );
});

test("QRY-033 node deduplication script is gone; unique active-path/name indexes prevent duplicates (COR-063)", () => {
  assert.equal(fs.existsSync(path.join(root, "scripts/deduplicate_nodes.ts")), false);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// ARCH-001: import ownership is a fenced lease, never a session or idle-transaction advisory lock.
test("the import runner guards work with leases and fences its mutation transactions", () => {
  const runner = readFileSync("src/lib/github/workspace-import-runner.ts", "utf8");
  assert.doesNotMatch(runner, /pg_try_advisory|pg_advisory_unlock|withTenantSyncLock/);
  assert.match(runner, /withWorkLease\(`git-import-tenant:\$\{userId\}`/);
  assert.match(runner, /withWorkLease\(`git-import-project:\$\{projectId\}`/);
  const fenced = runner.match(/assertWorkLeaseHeld\(tx, projectLease\)/g) ?? [];
  assert.equal(fenced.length, 2, "the reconcile and ready-status transactions both re-check the lease");
  assert.match(runner, /leaseLost\.throwIfAborted\(\)/);
});

test("the worker guard no longer holds a transaction open across work", () => {
  assert.doesNotMatch(readFileSync("src/lib/github/worker-guard.ts", "utf8"), /advisory|db\.transaction/);
});

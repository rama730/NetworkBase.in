import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// MIG-003: lock, journal bootstrap, statements and unlock share one session.
const source = readFileSync("scripts/setup-database.ts", "utf8");

test("migration runner uses a single reserved session and fails fast on a held lock", () => {
  assert.match(source, /postgres\([^)]*\{\s*max: 1,/s);
  assert.match(source, /pg_try_advisory_lock/);
  assert.doesNotMatch(source, /pg_advisory_lock\(/);
  assert.match(source, /"6543"/);
  const setup = source.slice(source.indexOf("async function setupDatabase"));
  assert.ok(setup.indexOf("acquireMigrationLock()") < setup.indexOf("ensureJournalTable()"), "lock before journal bootstrap");
});

test("new journal rows record their journal index on insert", () => {
  assert.match(source, /VALUES \(\$\{entry\.tag\}, \$\{checksum\}, \$\{entry\.idx\}, 'applying'/);
});

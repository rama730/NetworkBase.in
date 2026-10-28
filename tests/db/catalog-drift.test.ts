import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

// The catalog drift check (scripts/check-db-catalog-drift.ts) only ran by hand, so new server-only tables,
// a widened bucket MIME list and re-created browser policies drifted from it unnoticed. Running it against
// the freshly migrated database here means every migration has to keep it green.
test("the migrated schema passes the catalog drift check", () => {
  const url = process.env.DATABASE_URL_FRESH;
  assert.ok(url, "DATABASE_URL_FRESH is required");
  const run = spawnSync("npx", ["tsx", "scripts/check-db-catalog-drift.ts"], { env: { ...process.env, DATABASE_URL: url }, encoding: "utf8", timeout: 120_000 });
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
});

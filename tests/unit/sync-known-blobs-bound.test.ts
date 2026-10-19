import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// PERF-009: the known-hash lookup carries the bound its comment promises.
test("the known blob hash query is limited to the comparison ceiling", () => {
  const source = readFileSync("src/lib/github/sync-service.ts", "utf8");
  const query = source.slice(source.indexOf("batch known content hashes"), source.indexOf("rows.length > SYNC_LIMITS.comparisonFiles"));
  assert.match(query, /\.limit\(SYNC_LIMITS\.comparisonFiles\)/);
});

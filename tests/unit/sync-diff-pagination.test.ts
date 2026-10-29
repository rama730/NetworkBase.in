import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// API-008: one bounded page per call, resumable from lastDeliveredSequence.
const route = readFileSync("src/app/api/v1/workspaces/[id]/sync-diff/route.ts", "utf8");

test("sync-diff returns a bounded, resumable page", () => {
  assert.match(route, /limitSchema = z\.coerce\.number\(\)\.int\(\)\.min\(1\)\.max\(500\)/);
  assert.match(route, /\.orderBy\(workspaceNodeEvents\.sequenceNumber\)\s*\.limit\(limit \+ 1\)/);
  assert.match(route, /hasMore = rows\.length > limit/);
  assert.match(route, /lastDeliveredSequence: rows\.at\(-1\)\?\.sequenceNumber \?\? since/);
  assert.match(route, /currentSequence: projectSequence\?\.currentSequence \?\? since/);
});

test("linked task metadata is read for the page's nodes only", () => {
  assert.ok(route.indexOf("rows.length = limit") < route.indexOf("const nodeIds"));
});

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { needsInitialSkeleton } from "../../src/lib/network/initial-skeleton";

// Unified back B11: coming back to Network with its people already loaded shows them at once.
test("cached data skips the skeleton", () => {
  assert.equal(needsInitialSkeleton(true, true), false);
  assert.equal(needsInitialSkeleton(true, false), true);
  assert.equal(needsInitialSkeleton(false, false), false);
  assert.equal(needsInitialSkeleton(false, true), false);
});

test("Network checks its cache before showing the skeleton", () => {
  const src = fs.readFileSync("src/components/network/NetworkClient.tsx", "utf8");
  assert.match(src, /needsInitialSkeleton\(\s*isAuthed \|\| activeTab === "suggested",/);
  assert.match(src, /queryKeys\.connections\.root\(\)/);
});

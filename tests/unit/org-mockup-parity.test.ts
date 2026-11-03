import assert from "node:assert/strict";
import { test } from "node:test";

// Organization mockup parity (docs/superpowers/plans/2026-11-04-org-mockup-parity.md).

test("task 1: the four tiles count Done, Submitted, Not in and Excused", async () => {
  const { rosterTiles } = await import("../../src/lib/organizations/assignment-rules");
  assert.deepEqual(rosterTiles({ done: 22, submitted: 6, not_started: 4, in_progress: 3, returned: 1, missing: 2, excused: 2, total: 38 }), { done: 22, submitted: 6, notIn: 10, excused: 2 });
  assert.deepEqual(rosterTiles({ done: 0, submitted: 0, not_started: 0, in_progress: 0, returned: 0, missing: 0, excused: 0, total: 0 }), { done: 0, submitted: 0, notIn: 0, excused: 0 });
});

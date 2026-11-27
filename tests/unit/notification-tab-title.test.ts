import assert from "node:assert/strict";
import test from "node:test";

import { titleWithNeedsCount } from "../../src/lib/notifications/tab-title";

test("the tab title shows the Needs you count once, and drops it at zero", () => {
  assert.equal(titleWithNeedsCount("Discover · NetworkBase", 2), "(2) Discover · NetworkBase");
  assert.equal(titleWithNeedsCount("(2) Discover · NetworkBase", 3), "(3) Discover · NetworkBase");
  assert.equal(titleWithNeedsCount("(3) Discover · NetworkBase", 0), "Discover · NetworkBase");
  assert.equal(titleWithNeedsCount("Discover · NetworkBase", 140), "(99+) Discover · NetworkBase");
  assert.equal(titleWithNeedsCount("(99+) Discover · NetworkBase", 1), "(1) Discover · NetworkBase");
});

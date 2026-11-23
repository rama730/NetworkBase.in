import assert from "node:assert/strict";
import test from "node:test";
import { markerBox, padCount } from "../../src/lib/ui/tab-marker";

test("the marker sits under the open tab, measured inside the list, scrolled lists included", () => {
  assert.deepEqual(markerBox({ left: 100 }, { left: 160, width: 80 }, 0), { left: 60, width: 80 });
  assert.deepEqual(markerBox({ left: 100 }, { left: 40, width: 70 }, 120), { left: 60, width: 70 });
});

test("tab counts are two-digit mono: 3 → 03, 12 → 12, 148 → 148", () => {
  assert.equal(padCount(3), "03");
  assert.equal(padCount(0), "00");
  assert.equal(padCount(12), "12");
  assert.equal(padCount(148), "148");
});

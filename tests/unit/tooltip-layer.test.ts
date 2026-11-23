import assert from "node:assert/strict";
import test from "node:test";
import { placeTip, tipDelay } from "../../src/lib/ui/tooltip-layer";

test("a tooltip sits above its control, centred, and flips below near the top edge", () => {
  assert.deepEqual(placeTip({ top: 200, bottom: 232, left: 100, width: 32 }, { width: 80, height: 24 }, { width: 1200 }), { top: 168, left: 76, side: "top" });
  assert.deepEqual(placeTip({ top: 10, bottom: 42, left: 100, width: 32 }, { width: 80, height: 24 }, { width: 1200 }), { top: 50, left: 76, side: "bottom" });
});

test("it stays 8 px inside the screen's sides", () => {
  assert.equal(placeTip({ top: 200, bottom: 232, left: 0, width: 32 }, { width: 120, height: 24 }, { width: 1200 }).left, 8);
  assert.equal(placeTip({ top: 200, bottom: 232, left: 1180, width: 20 }, { width: 120, height: 24 }, { width: 1200 }).left, 1072);
});

test("500 ms for the first one, at once while another was just showing, at once for keyboard focus", () => {
  assert.equal(tipDelay({ warm: false, keyboard: false }), 500);
  assert.equal(tipDelay({ warm: true, keyboard: false }), 0);
  assert.equal(tipDelay({ warm: false, keyboard: true }), 0);
});

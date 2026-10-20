import assert from "node:assert/strict";
import test from "node:test";

import { createMotionBudget } from "@/lib/presence/motion-budget";

test("motion budget: three full animations at once, the fourth waits for a free slot", () => {
  const pending: Array<() => void> = [];
  const budget = createMotionBudget(3, 1800, (fn) => pending.push(fn));
  assert.deepEqual([budget.take(), budget.take(), budget.take(), budget.take()], [true, true, true, false]);
  assert.equal(pending.length, 3);
  pending.shift()?.();
  assert.equal(budget.take(), true);
  assert.equal(budget.take(), false);
});

test("motion budget: a slot is held for the animation's length", () => {
  const delays: number[] = [];
  const budget = createMotionBudget(1, 1800, (_fn, ms) => delays.push(ms));
  budget.take();
  assert.deepEqual(delays, [1800]);
});

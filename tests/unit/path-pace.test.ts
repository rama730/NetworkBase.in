import assert from "node:assert/strict";
import test from "node:test";

import { dropOff, paceState, pathPercent, stuckDays } from "@/lib/workflows/path-pace";

const modules = [
  { id: "m1", lessons: [{ id: "a" }, { id: "b" }] },
  { id: "m2", lessons: [{ id: "c" }, { id: "d" }] },
  { id: "m3", lessons: [{ id: "e" }] },
];
const day = (d: string) => new Date(`${d}T00:00:00Z`);

test("percent counts steps; an empty path is 0%", () => {
  assert.deepEqual(pathPercent(modules, new Set(["a", "b", "c"])), { done: 3, total: 5, percent: 60 });
  assert.deepEqual(pathPercent([], new Set()), { done: 0, total: 0, percent: 0 });
});

test("pace: modules due by today must be finished; off or not started reads null", () => {
  const start = day("2027-01-01");
  assert.equal(paceState(modules, new Set(["a", "b"]), start, 1, day("2027-01-10")), "on", "one module due, finished");
  assert.equal(paceState(modules, new Set(["a"]), start, 1, day("2027-01-10")), "behind");
  assert.equal(paceState(modules, new Set(), start, 1, day("2027-01-05")), "on", "nothing due yet");
  assert.equal(paceState(modules, new Set(["a", "b", "c", "d", "e"]), start, 1, day("2027-06-01")), "on", "past the end, all done");
  assert.equal(paceState(modules, new Set(), start, null), null);
  assert.equal(paceState(modules, new Set(), null, 1), null);
});

test("stuck after 14 days since the last step or the start; never when finished", () => {
  const now = day("2027-02-01");
  assert.equal(stuckDays(day("2027-01-10"), day("2027-01-01"), false, 14, now), 22);
  assert.equal(stuckDays(day("2027-01-25"), day("2027-01-01"), false, 14, now), null);
  assert.equal(stuckDays(null, day("2027-01-01"), false, 14, now), 31);
  assert.equal(stuckDays(null, day("2027-01-01"), true, 14, now), null);
  assert.equal(stuckDays(null, null, false, 14, now), null);
});

test("drop-off: reached per module, with the biggest fall", () => {
  const r = dropOff(modules, [new Set(["a", "c", "e"]), new Set(["a", "c"]), new Set(["a"]), new Set(["b"])]);
  assert.deepEqual(r.reached, [4, 2, 1]);
  assert.equal(r.worst, 1);
  assert.equal(r.dropPercent, 50);
  assert.deepEqual(dropOff(modules, []).worst, null);
});

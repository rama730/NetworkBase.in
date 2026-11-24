import assert from "node:assert/strict";
import { test } from "node:test";

import { autoStartEligible, isLocked, lessonFieldsSchema, readPathSettings, sprintDatesValid, stepProgress, upNext } from "../../src/lib/workflows/learning-path";

test("A7.6: sprint dates are both or neither; undated sprints never auto-start", () => {
  assert.deepEqual([sprintDatesValid(null, null), sprintDatesValid("2026-12-01", null), sprintDatesValid("2026-12-01", "2026-12-08"), sprintDatesValid("2026-12-08", "2026-12-01")], [true, false, true, false]);
  const now = new Date("2026-12-02T00:00:00Z");
  assert.equal(autoStartEligible({ startDate: null, autoStart: true, status: "planning" }, now), false);
  assert.equal(autoStartEligible({ startDate: new Date("2026-12-01"), autoStart: true, status: "planning" }, now), true);
  assert.deepEqual(readPathSettings(null), { pacing: "self", lockInOrder: false, public: false });
});

test("A7.6–A7.7: progress per person, Up next, Lock in order", () => {
  const steps = [{ id: "s1", lessons: [{ id: "a" }, { id: "b" }] }, { id: "s2", lessons: [{ id: "c" }] }, { id: "s3", lessons: [] }];
  const done = new Set(["a"]);
  assert.deepEqual(stepProgress(steps[0]!, done), { done: 1, total: 2 });
  assert.deepEqual(upNext(steps, done), { stepId: "s1", lessonId: "b" });
  assert.deepEqual(upNext(steps, new Set(["a", "b", "c"])), null);
  assert.deepEqual([isLocked(steps, 1, done, true), isLocked(steps, 1, done, false), isLocked(steps, 1, new Set(["a", "b"]), true), isLocked(steps, 0, done, true)], [true, false, false, false]);
  assert.equal(lessonFieldsSchema.safeParse({ minutes: 20, links: ["https://example.com"] }).success, true);
  assert.equal(lessonFieldsSchema.safeParse({ minutes: 0 }).success, false);
});

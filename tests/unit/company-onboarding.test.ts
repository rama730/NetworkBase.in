import assert from "node:assert/strict";
import { test } from "node:test";

import { STARTER_PLAN, dayLabel, dueFor, onboardingDone, phaseOf, validPlan } from "../../src/lib/organizations/onboarding-plan";

test("33.5: due dates and phases count from the start date; Day N; complete when required steps are done", () => {
  assert.equal(dueFor("2026-12-01", -5), "2026-11-26");
  assert.equal(dueFor("2026-12-01", 30), "2026-12-31");
  assert.deepEqual([-3, 0, 1, 6, 7, 29, 30, 60, 90].map(phaseOf), ["Before day 1", "Day 1", "Week 1", "Week 1", "Month 1", "Month 1", "Month 2", "Month 3", "Month 3"]);
  assert.equal(dayLabel("2026-12-01", "2026-12-03"), "Day 3");
  assert.equal(dayLabel("2026-12-01", "2026-11-29"), "Starts in 2 days");
  assert.equal(onboardingDone([{ required: true, done: true }, { required: false, done: false }]), true);
  assert.equal(onboardingDone([{ required: true, done: false }]), false);
  assert.equal(onboardingDone([]), false);
  assert.equal(validPlan(STARTER_PLAN), true);
  assert.equal(validPlan([{ ...STARTER_PLAN[0]!, day: 120 }]), false, "−14 to +90 days");
  assert.equal(validPlan([STARTER_PLAN[0], STARTER_PLAN[0]]), false, "ids are unique");
});

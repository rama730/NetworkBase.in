import assert from "node:assert/strict";
import { test } from "node:test";

import { activityVisible, getStartedSteps, journeyFromSprints, needsAttention } from "../../src/lib/organizations/dashboard-rules";

const now = new Date("2026-10-30T12:00:00Z");

test("Needs attention lists every reason; archived projects never need it", () => {
  assert.deepEqual(needsAttention({ overdue: 3, lastActivityAt: new Date("2026-10-20T00:00:00Z"), groupCopyState: "missing", leadInOrg: false, now }),
    ["3 overdue", "quiet 7 days", "group assignment missing", "lead left the organization"]);
  assert.deepEqual(needsAttention({ overdue: 2, lastActivityAt: new Date("2026-10-29T00:00:00Z"), groupCopyState: "done", leadInOrg: true, now }), []);
  assert.deepEqual(needsAttention({ overdue: 9, lastActivityAt: null, groupCopyState: null, leadInOrg: false, status: "archived", now }), []);
});

test("the Journey is the org's sprints in date order, current = active or next planned", () => {
  const s = (name: string, status: string, start: string, completedAt: string | null = null) => ({ name, status, startDate: new Date(start), endDate: new Date(start), completedAt: completedAt ? new Date(completedAt) : null });
  const journey = journeyFromSprints([s("CO3", "planning", "2026-11-10"), s("CO1", "completed", "2026-09-01", "2026-10-03T00:00:00Z"), s("CO2", "active", "2026-10-04")]);
  assert.deepEqual(journey.stages, ["CO1", "CO2", "CO3"]);
  assert.equal(journey.currentIndex, 1);
  assert.deepEqual(journey.completionDates, { "0": "2026-10-03T00:00:00.000Z" });
  assert.equal(journeyFromSprints([s("CO1", "completed", "2026-09-01")]).currentIndex, 1, "all done after the last sprint");
  assert.equal(journeyFromSprints([s("CO1", "completed", "2026-09-01"), s("CO2", "planning", "2026-10-04")]).currentIndex, 1, "next planned");
});

test("activity privacy: members never see other people's submissions; About shows public-safe kinds only", () => {
  const member = { isAdmin: false, userId: "m" };
  assert.equal(activityVisible({ kind: "submission", actorId: "other" }, member), false);
  assert.equal(activityVisible({ kind: "submission", actorId: "m" }, member), true);
  assert.equal(activityVisible({ kind: "submission", actorId: "other" }, { isAdmin: true, userId: "a" }), true);
  assert.equal(activityVisible({ kind: "sprint", actorId: null }, member), true);
  const about = { isAdmin: false, userId: null, publicOnly: true };
  assert.equal(activityVisible({ kind: "file", actorId: null }, about), false);
  assert.equal(activityVisible({ kind: "announcement", actorId: null, public: false }, about), false);
  assert.equal(activityVisible({ kind: "announcement", actorId: null, public: true }, about), true);
  assert.equal(activityVisible({ kind: "joins", actorId: null }, about), true);
});

test("Get started drops each step once done", () => {
  assert.deepEqual(getStartedSteps({ members: 1, sprints: 0, files: 0, announcements: 0, assignments: 0 }).length, 5);
  assert.deepEqual(getStartedSteps({ members: 12, sprints: 3, files: 4, announcements: 0, assignments: 1 }), ["Post a welcome announcement"]);
  assert.deepEqual(getStartedSteps({ members: 2, sprints: 1, files: 1, announcements: 1, assignments: 1 }), []);
});

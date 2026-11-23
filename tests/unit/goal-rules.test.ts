import assert from "node:assert/strict";
import { test } from "node:test";

// Report 38.12 D3 part 7 (plan A5.1): goals rules.
test("krProgress: increase, decrease, target = start, overshoot capped", async () => {
  const { krProgress } = await import("../../src/lib/workflows/goals");
  assert.equal(krProgress({ start: 10, target: 50, current: 30, direction: "increase" }), 50);
  assert.equal(krProgress({ start: 20, target: 5, current: 10, direction: "decrease" }), 66);
  assert.equal(krProgress({ start: 5, target: 5, current: 5, direction: "increase" }), 100);
  assert.equal(krProgress({ start: 5, target: 5, current: 4, direction: "increase" }), 0);
  assert.equal(krProgress({ start: 5, target: 5, current: 4, direction: "decrease" }), 100);
  assert.equal(krProgress({ start: 0, target: 10, current: 15, direction: "increase" }), 100);
  assert.equal(krProgress({ start: 0, target: 10, current: -3, direction: "increase" }), 0);
  assert.equal(krProgress({ start: 0, target: 10, current: null, direction: "increase" }), 0);
});

test("periods: quarter by default from January; a fiscal year from April; month, half, year; ranges end-exclusive", async () => {
  const { periodOf, periodRange, periodLabel, nextPeriod } = await import("../../src/lib/workflows/goals");
  assert.equal(periodOf("2027-02-14", {}), "2027-Q1");
  assert.equal(periodOf("2027-05-01", { firstMonth: 4 }), "2027-Q1", "Apr–Jun is Q1");
  assert.equal(periodOf("2028-01-10", { firstMonth: 4 }), "2027-Q4");
  assert.equal(periodOf("2027-08-31", { period: "month" }), "2027-08");
  assert.equal(periodOf("2027-08-31", { period: "half" }), "2027-H2");
  assert.equal(periodOf("2027-08-31", { period: "year", firstMonth: 4 }), "2027");
  assert.deepEqual(periodRange("2027-Q1", { firstMonth: 4 }), { start: "2027-04-01", end: "2027-07-01" });
  assert.deepEqual(periodRange("2027-Q4", { firstMonth: 4 }), { start: "2028-01-01", end: "2028-04-01" });
  assert.deepEqual(periodRange("2027-H2", { period: "half" }), { start: "2027-07-01", end: "2028-01-01" });
  assert.deepEqual(periodRange("2027-12", { period: "month" }), { start: "2027-12-01", end: "2028-01-01" });
  assert.equal(periodLabel("2027-Q1"), "Q1 2027");
  assert.equal(periodLabel("2027-08"), "Aug 2027");
  assert.equal(nextPeriod("2027-Q4", {}), "2028-Q1");
  assert.equal(nextPeriod("2027-12", { period: "month" }), "2028-01");
});

test("pace, status with bands, objective progress, close result, week of", async () => {
  const { expectedPace, goalStatus, objectiveProgress, closeResult, weekOf } = await import("../../src/lib/workflows/goals");
  assert.equal(expectedPace("2027-01-01", "2027-04-01", new Date("2027-02-15T00:00:00Z")), 50);
  assert.equal(expectedPace("2027-01-01", "2027-04-01", new Date("2026-12-01T00:00:00Z")), 0);
  assert.equal(expectedPace("2027-01-01", "2027-04-01", new Date("2027-06-01T00:00:00Z")), 100);
  assert.equal(goalStatus(45, 50), "on_track");
  assert.equal(goalStatus(30, 50), "at_risk");
  assert.equal(goalStatus(20, 50), "off_track");
  assert.equal(goalStatus(20, 50, { atRisk: 35, offTrack: 50 }), "on_track");
  assert.equal(objectiveProgress([50, 100, 0]), 50);
  assert.equal(objectiveProgress([]), 0);
  assert.equal(closeResult(100), "done");
  assert.equal(closeResult(99), "missed");
  assert.equal(weekOf("2027-01-01", "2027-04-01", new Date("2027-02-15T00:00:00Z")), "week 7 of 13");
});

test("goalsMarkdown: title, guide, the period's block, which parses with its period", async () => {
  const { goalsMarkdown } = await import("../../src/lib/workflows/goals");
  const { parseLiveBlocks } = await import("../../src/lib/workspaces/doc-live-blocks");
  const md = goalsMarkdown("2027-Q1");
  assert.match(md, /^# Goals · Q1 2027\n\n_An objective is a direction/);
  assert.deepEqual(parseLiveBlocks(md).map((b) => [b.kind, b.period]), [["goals", "2027-Q1"]]);
  assert.deepEqual(parseLiveBlocks('{% project.goals period="bad" %}').map((b) => b.period), [null]);
});

test("check-ins due: since the last check-in day, in the workspace's zone", async () => {
  const { lastCheckInDay, checkInDue } = await import("../../src/lib/workflows/goals");
  assert.equal(lastCheckInDay("2027-02-17", 1), "2027-02-15", "Wednesday → Monday");
  assert.equal(lastCheckInDay("2027-02-15", 1), "2027-02-15", "Monday itself");
  assert.equal(lastCheckInDay("2027-02-14", 1), "2027-02-08", "Sunday → the Monday before");
  assert.equal(lastCheckInDay("2027-02-17", 5), "2027-02-12", "Friday check-ins");
  assert.equal(checkInDue(null, "2027-02-17", 1), true);
  assert.equal(checkInDue("2027-02-15T03:00:00Z", "2027-02-17", 1), false);
  assert.equal(checkInDue("2027-02-14T20:00:00Z", "2027-02-17", 1, "UTC"), true);
  assert.equal(checkInDue("2027-02-14T20:00:00Z", "2027-02-17", 1, "Asia/Kolkata"), false, "already Monday 01:30 in Kolkata");
});

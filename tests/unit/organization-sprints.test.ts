import assert from "node:assert/strict";
import { test } from "node:test";

import { buildSprintSeries, fitsInside, overlaps } from "../../src/lib/organizations/sprint-rules";

// Report §15.1–15.2: org sprints never overlap; a linked child sprint fits inside its org sprint; Plan a series.
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

test("org sprints may touch end-to-start but never overlap", () => {
  assert.equal(overlaps({ startDate: d("2026-10-27"), endDate: d("2026-11-02") }, { startDate: d("2026-11-02"), endDate: d("2026-11-09") }), false, "CO1 ends the day CO2 starts");
  assert.equal(overlaps({ startDate: d("2026-10-27"), endDate: d("2026-11-03") }, { startDate: d("2026-11-02"), endDate: d("2026-11-09") }), true);
  assert.equal(overlaps({ startDate: d("2026-11-01"), endDate: d("2026-11-30") }, { startDate: d("2026-11-10"), endDate: d("2026-11-12") }), true, "one inside the other");
});

test("a child sprint fits inside its org sprint, bounds included", () => {
  const parent = { startDate: d("2026-10-01"), endDate: d("2026-10-31") };
  assert.equal(fitsInside({ startDate: d("2026-10-01"), endDate: d("2026-10-31") }, parent), true);
  assert.equal(fitsInside({ startDate: d("2026-10-08"), endDate: d("2026-10-14") }, parent), true);
  assert.equal(fitsInside({ startDate: d("2026-09-30"), endDate: d("2026-10-14") }, parent), false);
  assert.equal(fitsInside({ startDate: d("2026-10-20"), endDate: d("2026-11-01") }, parent), false);
});

test("Plan a series: CO1–CO5 weekly, back to back, never overlapping", () => {
  const series = buildSprintSeries({ prefix: "CO", count: 5, lengthDays: 7, startDate: "2026-10-27" });
  assert.deepEqual(series.map((s) => s.name), ["CO1", "CO2", "CO3", "CO4", "CO5"]);
  assert.deepEqual(series[0], { name: "CO1", startDate: "2026-10-27", endDate: "2026-11-03" });
  assert.equal(series[1]!.startDate, "2026-11-03");
  for (let i = 1; i < series.length; i += 1) {
    assert.equal(overlaps({ startDate: d(series[i - 1]!.startDate), endDate: d(series[i - 1]!.endDate) }, { startDate: d(series[i]!.startDate), endDate: d(series[i]!.endDate) }), false);
  }
  assert.equal(buildSprintSeries({ prefix: "Sprint ", count: 2, lengthDays: 14, startDate: "2026-10-01", firstNumber: 12 })[0]!.name, "Sprint 12");
  assert.throws(() => buildSprintSeries({ prefix: "CO", count: 53, lengthDays: 7, startDate: "2026-10-27" }), /52/);
});

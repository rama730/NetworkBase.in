import assert from "node:assert/strict";
import { test } from "node:test";

import { buildSprintSeries, fitsInside, insideError, nextSeriesNumber, overlaps, seriesPreview } from "../../src/lib/organizations/sprint-rules";

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
  // Decision 123: each ends the day before the next starts, so CO1 is over when CO2 is due (problem 3).
  assert.deepEqual(series[0], { name: "CO1", startDate: "2026-10-27", endDate: "2026-11-02" });
  assert.equal(series[1]!.startDate, "2026-11-03");
  for (let i = 1; i < series.length; i += 1) {
    assert.equal(overlaps({ startDate: d(series[i - 1]!.startDate), endDate: d(series[i - 1]!.endDate) }, { startDate: d(series[i]!.startDate), endDate: d(series[i]!.endDate) }), false);
  }
  assert.equal(buildSprintSeries({ prefix: "Sprint ", count: 2, lengthDays: 14, startDate: "2026-10-01", firstNumber: 12 })[0]!.name, "Sprint 12");
  assert.throws(() => buildSprintSeries({ prefix: "CO", count: 53, lengthDays: 7, startDate: "2026-10-27" }), /52/);
});

test("28.2: the Repeat preview blocks overlaps with a Start after fix, and only warns past the term end", () => {
  const rows = buildSprintSeries({ prefix: "CO", count: 3, lengthDays: 14, startDate: "2026-11-01", firstNumber: 4 });
  const preview = seriesPreview(rows, [{ name: "Mid-term break", startDate: d("2026-11-16"), endDate: d("2026-11-20") }], "2026-12-05");
  assert.deepEqual(preview.rows.map((r) => [r.name, r.clash, r.pastTermEnd]), [["CO4", null, false], ["CO5", "Mid-term break", false], ["CO6", null, true]]);
  assert.equal(preview.blocked, true);
  assert.equal(preview.startAfter, "2026-11-21", "the day after the clash ends");
  assert.equal(seriesPreview(rows, [], null).blocked, false);
});

test("28.2: numbering continues from the last sprint with the prefix", () => {
  assert.equal(nextSeriesNumber("CO", ["CO1", "CO2", "CO3", "Mid-term break", "COX"]), 4);
  assert.equal(nextSeriesNumber("Sprint ", []), 1);
});

test("18.2: a linked sprint's dates name the organization sprint's limit", () => {
  const parent = { name: "CO1", startDate: d("2026-11-01"), endDate: d("2026-11-15") };
  assert.equal(insideError({ startDate: d("2026-11-02"), endDate: d("2026-11-16") }, parent), "CO1 ends Nov 15. Pick an earlier date.");
  assert.equal(insideError({ startDate: d("2026-10-30"), endDate: d("2026-11-10") }, parent), "CO1 starts Nov 1. Pick a later date.");
  assert.equal(insideError({ startDate: d("2026-11-01"), endDate: d("2026-11-15") }, parent), null);
});

test("live-fix 32, 33: a new org sprint is named after the last one and starts the day after it ends", async () => {
  const { nextOrgSprintStart } = await import("../../src/lib/organizations/sprint-rules");
  const co1 = { name: "CO1", status: "active", endDate: "2026-11-15T00:00:00.000Z" };
  assert.equal(nextOrgSprintStart([co1], "2026-11-03"), "2026-11-16");
  assert.equal(nextOrgSprintStart([{ ...co1, status: "completed" }], "2026-11-03"), "2026-11-03", "a finished one doesn't push it");
  assert.equal(nextOrgSprintStart([{ ...co1, endDate: "2026-10-01T00:00:00.000Z" }], "2026-11-03"), "2026-11-03", "never in the past");
  assert.equal(nextOrgSprintStart([], "2026-11-03"), "2026-11-03");
  const modal = (await import("node:fs")).readFileSync("src/components/workspaces/v2/sprints/CreateSprintModal.tsx", "utf8");
  assert.match(modal, /Sprints can arrive after the form opens/);
});

test("live-fix 34: the sprint form shares with All, Selected or None, in plain words, with an optional announcement", async () => {
  const modal = (await import("node:fs")).readFileSync("src/components/workspaces/v2/sprints/CreateSprintModal.tsx", "utf8");
  assert.match(modal, /Share with workspaces/);
  assert.match(modal, /\[\["all", "All"\], \["selected", "Selected"\], \["none", "None"\]\]/);
  assert.match(modal, /Teams plan their own sprint inside it/);
  assert.doesNotMatch(modal, /Create a matching sprint|Notify members when it starts|Add to every workspace/);
  assert.match(modal, /Post an announcement/);
  assert.match(modal, /sharedWorkspaceIds: orgFields\.sharedWith === "selected"/);
});

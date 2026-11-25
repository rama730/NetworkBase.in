import assert from "node:assert/strict";
import test from "node:test";

import { bands, daysToGo, LAYOUT_PRESETS, overallScore, readScoreLayout, sectionScore, seriesSummary } from "@/lib/organizations/mocks";

const ielts = { series: "IELTS mocks", ...LAYOUT_PRESETS.ielts!, sections: LAYOUT_PRESETS.ielts!.sections.map((s) => (s.key === "listening" ? { ...s, conversion: [[39, 9], [30, 7], [23, 6]] as Array<[number, number]> } : s)) };

test("a section's score uses its conversion table when there is one", () => {
  const listening = ielts.sections[0]!;
  assert.equal(sectionScore(32, listening), 7);
  assert.equal(sectionScore(39, listening), 9);
  assert.equal(sectionScore(10, listening), 0);
  assert.equal(sectionScore(6.5, ielts.sections[2]!), 6.5, "no table: the raw mark");
  assert.equal(sectionScore(null, listening), null);
});

test("the overall is worked out inside one mock: average to 0.5, sum, or none; a missing section means no overall", () => {
  assert.equal(overallScore(ielts, { listening: 32, reading: 6.5, writing: 6, speaking: 7 }), 6.5);
  assert.equal(overallScore(ielts, { listening: 32, reading: 6.5, writing: null, speaking: 7 }), null);
  assert.equal(overallScore({ series: "SAT", ...LAYOUT_PRESETS.sat! }, { rw: 650, math: 700 }), 1350);
  assert.equal(overallScore({ series: "x", ...LAYOUT_PRESETS.blank! }, { s1: 50 }), null);
});

test("Latest, Best and the gap; missing mocks are never zero; no average", () => {
  assert.deepEqual(seriesSummary([6, 6.5, null, 7], 7), { latest: 7, best: 7, gap: 0, onTarget: true, trend: [6, 6.5, 7] });
  assert.deepEqual(seriesSummary([6, 6.5], 7).gap, 0.5);
  assert.deepEqual(seriesSummary([], 7), { latest: null, best: null, gap: null, onTarget: false, trend: [] });
});

test("bands count the spread, never names or ranks", () => {
  assert.deepEqual(bands([7, 7.5, 6, 6.5, 5, null], [7, 6]).map((b) => b.count), [2, 2, 1]);
});

test("layouts parse strictly; days to go never go negative", () => {
  assert.equal(readScoreLayout({ scoreLayout: { series: "", sections: [] } }), null);
  assert.equal(readScoreLayout({ scoreLayout: ielts })?.sections.length, 4);
  assert.equal(daysToGo("2027-03-14", "2027-02-04"), 38);
  assert.equal(daysToGo("2027-01-01", "2027-02-04"), 0);
  assert.equal(daysToGo(null, "2027-02-04"), null);
});

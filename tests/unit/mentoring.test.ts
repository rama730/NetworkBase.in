import assert from "node:assert/strict";
import test from "node:test";

import { planLine, prepDone, readMentoring, rhythm, suggestMatches, usefulSummary } from "@/lib/organizations/mentoring";

test("mentoring settings: off by default with the agreed plan", () => {
  assert.deepEqual(readMentoring(null), { on: false, everyWeeks: 2, minutes: 30, checkins: 6, rhythmDays: 21, useful: true });
  assert.equal(readMentoring({ mentoring: { on: true, everyWeeks: 1 } }).everyWeeks, 1);
});

test("plan line and a finished plan", () => {
  assert.equal(planLine({ everyWeeks: 2, minutes: 30, checkins: 6 }, 4), "every 2 weeks · 30 min · 4 of 6");
  assert.equal(planLine({ everyWeeks: 1, minutes: 45, checkins: 6 }, 7), "every week · 45 min · 6 of 6 · finished");
});

test("rhythm: within the days since the last check-in or the start", () => {
  assert.deepEqual(rhythm("2027-01-01", null, 21, "2027-01-20"), { on: true, days: 19 });
  assert.deepEqual(rhythm("2027-01-01", null, 21, "2027-01-25"), { on: false, days: 24 });
  assert.deepEqual(rhythm(null, "2027-01-01T09:00:00Z", 21, "2027-01-30"), { on: false, days: 29 });
  assert.deepEqual(rhythm(null, null, 21, "2027-01-30"), { on: true, days: null });
});

test("Useful shows only from 5 answers", () => {
  assert.deepEqual(usefulSummary(["very", "very", "somewhat", "not_really"]), { shown: false, answers: 4 });
  assert.deepEqual(usefulSummary(["very", "very", "somewhat", "not_really", "very"]), { shown: true, answers: 5, useful: 4, line: "Useful: 4 of 5" });
});

test("match suggestions balance load, in name order", () => {
  const r = suggestMatches([{ id: "g1", size: 2 }, { id: "g2", size: 0 }], [{ id: "c", name: "Cy" }, { id: "a", name: "Al" }, { id: "b", name: "Bo" }]);
  assert.deepEqual(r, [{ userId: "a", groupId: "g2" }, { userId: "b", groupId: "g2" }, { userId: "c", groupId: "g1" }]);
  assert.deepEqual(suggestMatches([], [{ id: "a", name: "A" }]), []);
});

test("prep is done once anything is written", () => {
  assert.equal(prepDone(null), false);
  assert.equal(prepDone({ since: "", stuck: "", asks: "" }), false);
  assert.equal(prepDone({ stuck: "CSS grid" }), true);
});

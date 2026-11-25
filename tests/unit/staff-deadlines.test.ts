import assert from "node:assert/strict";
import test from "node:test";

import { clashCheck, deadlineWeeks, HAND_IN_TEMPLATES, weekOfEveryTerm } from "@/lib/organizations/staff-deadlines";
import { schoolYearSchema } from "@/lib/organizations/school-year";

const year = schoolYearSchema.parse({ name: "Y", terms: [{ name: "Term 1", start: "2026-09-02", end: "2026-12-18" }, { name: "Term 2", start: "2027-01-06", end: "2027-03-26" }],
  days: [{ name: "INSET", kind: "staff", start: "2027-02-05", end: "2027-02-05" }] });

test("clash check: same week, same people, quiet weeks; it never blocks", () => {
  const others = [{ id: "a", title: "Reports", due: "2026-10-07", people: ["u1", "u2"] }, { id: "b", title: "Trip", due: "2026-10-20", people: ["u1"] }, { id: "c", title: "Other team", due: "2026-10-08", people: ["u9"] }];
  const r = clashCheck("2026-10-09", ["u1", "u3"], others, [{ name: "Report week", start: "2026-10-05", end: "2026-10-09" }]);
  assert.deepEqual([r.week, r.deadlines.map((d) => [d.title, d.people]), r.quiet], ["2026-10-05", [["Reports", 1]], "Report week"]);
});

test("Week 5 of every term, Friday; a staff day moves it to the day before; only from today on", () => {
  assert.deepEqual(weekOfEveryTerm(year, 5, 4, "2026-09-01"), ["2026-10-02", "2027-02-04"]);
  assert.deepEqual(weekOfEveryTerm(year, 5, 4, "2026-11-01"), ["2027-02-04"]);
  assert.deepEqual(weekOfEveryTerm(year, 30, 0, "2026-09-01"), [], "a week the term doesn't have");
});

test("Deadlines view: counts per week, heavy at 3, quiet weeks named; templates hold no student data", () => {
  const w = deadlineWeeks([1, 2, 3].map((i) => ({ id: `${i}`, title: "x", due: "2026-10-07", people: [`u${i}`] })).concat([{ id: "4", title: "y", due: "2026-10-14", people: ["u1"] }]),
    [{ name: "Exams", start: "2026-10-12", end: "2026-10-16" }]);
  assert.deepEqual(w.map((x) => [x.week, x.count, x.people, x.heavy, x.quiet]), [["2026-10-05", 3, 3, true, null], ["2026-10-12", 1, 1, false, "Exams"]]);
  assert.equal(HAND_IN_TEMPLATES.some((t) => /pupil|student|report comment/i.test(t.title + t.description)), false);
});

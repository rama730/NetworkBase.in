import assert from "node:assert/strict";
import test from "node:test";

import { dayKind, nextHoliday, readSchoolYear, schoolBreaks, schoolYearSchema, termWeek, thisWeek, yearMonths, yearSpan } from "@/lib/organizations/school-year";

const year = schoolYearSchema.parse({
  name: "2026–27",
  terms: [{ name: "Term 1", start: "2026-09-02", end: "2026-12-18" }, { name: "Term 2", start: "2027-01-06", end: "2027-03-26" }],
  days: [{ name: "Half-term", kind: "holiday", start: "2026-10-26", end: "2026-10-30" }, { name: "INSET", kind: "staff", start: "2026-10-09", end: "2026-10-09" }, { name: "Sports day", kind: "half", start: "2026-10-14", end: "2026-10-14" }],
});

test("terms can't overlap and ranges run forwards", () => {
  assert.equal(schoolYearSchema.safeParse({ name: "x", terms: [{ name: "A", start: "2026-09-02", end: "2026-12-18" }, { name: "B", start: "2026-12-01", end: "2027-03-01" }] }).success, false);
  assert.equal(schoolYearSchema.safeParse({ name: "x", terms: [{ name: "A", start: "2026-09-02", end: "2026-09-01" }] }).success, false);
  assert.equal(readSchoolYear({ schoolYear: { name: "" } }), null);
});

test("day kinds: holiday, staff day, half day, exam week, weekend, outside", () => {
  assert.equal(dayKind("2026-10-27", year), "holiday");
  assert.equal(dayKind("2026-10-09", year), "staff");
  assert.equal(dayKind("2026-10-14", year), "half");
  assert.equal(dayKind("2026-10-10", year), "weekend");
  assert.equal(dayKind("2026-11-02", year, [{ start: "2026-11-02", end: "2026-11-06" }]), "exam");
  assert.equal(dayKind("2026-12-25", year), "outside");
  assert.equal(dayKind("2026-10-08", year), "school");
});

test("classes get holidays and staff days as breaks; half days keep classes", () => {
  assert.deepEqual(schoolBreaks(year).map((b) => b.name), ["Half-term", "INSET"]);
  assert.deepEqual(yearSpan(year), { start: "2026-09-02", end: "2027-03-26" });
});

test("term weeks, the next holiday, the year's months and this week", () => {
  assert.deepEqual(termWeek("2026-10-08", year), { term: "Term 1", week: 6, weeks: 16 });
  assert.equal(termWeek("2026-12-25", year), null);
  assert.deepEqual(nextHoliday("2026-10-15", year), { name: "Half-term", start: "2026-10-26", days: 11 });
  const months = yearMonths(year);
  assert.deepEqual([months[0]!.month, months.length, months[0]!.days[0]!.kind], ["2026-09", 7, "outside"]);
  assert.deepEqual(thisWeek("2026-10-08", year).map((d) => [d.day, d.kind]), [["2026-10-09", "staff"]]);
});

import assert from "node:assert/strict";
import test from "node:test";

import { dayView, isoDay, parseTimetableCsv, timetableSettingsSchema, weekLetter } from "@/lib/organizations/school-timetable";

const s = timetableSettingsSchema.parse({
  patterns: [
    { name: "Normal", days: [1, 2, 3, 4], periods: [{ key: "P1", start: "08:50", end: "09:50" }, { key: "Break", start: "09:50", end: "10:10", kind: "break" }, { key: "P2", start: "10:10", end: "11:10" }] },
    { name: "Short Friday", days: [5], periods: [{ key: "P1", start: "08:50", end: "09:40" }] },
  ], weekAB: true, weekAStart: "2026-09-07" });

test("patterns: each day follows one; periods end after they start", () => {
  assert.equal(timetableSettingsSchema.safeParse({ patterns: [{ name: "a", days: [1], periods: [{ key: "P1", start: "09:00", end: "10:00" }] }, { name: "b", days: [1], periods: [{ key: "P1", start: "09:00", end: "10:00" }] }] }).success, false);
  assert.equal(timetableSettingsSchema.safeParse({ patterns: [{ name: "a", days: [1], periods: [{ key: "P1", start: "10:00", end: "09:00" }] }] }).success, false);
});

test("Week A / B and a day's view with break rows and the week's slots", () => {
  assert.deepEqual([weekLetter("2026-09-08", s), weekLetter("2026-09-15", s), weekLetter("2026-09-22", s)], ["A", "B", "A"]);
  assert.equal(isoDay("2026-09-11"), 5);
  const slots = [
    { id: "1", day: 2, period: "P1", week: "A", className: "6A", courseId: null, teacherId: "t", room: "S1" },
    { id: "2", day: 2, period: "P1", week: "B", className: "6B", courseId: null, teacherId: "t", room: "S1" },
    { id: "3", day: 2, period: "P2", week: null, className: "7A", courseId: null, teacherId: "t", room: "S2" },
  ];
  const v = dayView("2026-09-08", slots, s);
  assert.deepEqual(v.map((p) => [p.key, p.kind, p.slots.map((x) => x.className)]), [["P1", "lesson", ["6A"]], ["Break", "break", []], ["P2", "lesson", ["7A"]]]);
  assert.deepEqual(dayView("2026-09-11", slots, s).map((p) => p.key), ["P1"], "the short Friday pattern");
});

test("CSV import: day names, period keys from the school day, errors per row", () => {
  const rows = parseTimetableCsv("day,period,class,teacher,room,week\nTue,P1,6A,Ms Rao,S1,A\nTuesday,P9,6B,Ms Rao,S1,\nFunday,P1,6C,Mr Lee,,\nWed,P2,7A,Mr Lee,S2,C", ["P1", "P2"]);
  assert.deepEqual(rows.map((r) => [r.day, r.period, r.className, r.week, r.error]), [
    [2, "P1", "6A", "A", null], [2, "P9", "6B", null, "No period called P9 in the school day"], [null, "P1", "6C", null, "Day isn’t a weekday name"], [3, "P2", "7A", null, "Week is A or B"]]);
});

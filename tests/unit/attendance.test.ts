import assert from "node:assert/strict";
import test from "node:test";

import { attendancePercent, canMissMore, editableByStaff, readAttendanceSettings, registerCsv, type AttendanceStatus } from "../../src/lib/organizations/attendance";

// Report 30.7 W6 (plan B1.4): the % rule, "you can miss N more", the 7-day rule and the register.
const held = ["2027-01-12T10:30", "2027-01-14T10:30", "2027-01-19T10:30", "2027-01-21T10:30"];
const recs = (list: Array<[string, AttendanceStatus]>) => new Map(list);

test("excused counts as neither; late counts as present by default; not taken is skipped; joiners count from their join day", () => {
  const r = recs([[held[0]!, "present"], [held[1]!, "excused"], [held[2]!, "late"], [held[3]!, "absent"]]);
  assert.deepEqual(attendancePercent({ held, records: r, joinedDay: null, lateCountsPresent: true }), { percent: 67, present: 2, absent: 1, total: 3 });
  assert.equal(attendancePercent({ held, records: r, joinedDay: null, lateCountsPresent: false }).percent, 33);
  assert.equal(attendancePercent({ held, records: r, joinedDay: "2027-01-19", lateCountsPresent: true }).percent, 50);
  assert.equal(attendancePercent({ held, records: new Map(), joinedDay: null, lateCountsPresent: true }).percent, null, "nothing taken yet: —");
});

test("you can miss N more classes, never below zero; settings default on only with a minimum", () => {
  assert.equal(canMissMore({ present: 8, total: 10, remaining: 10, minimum: 75 }), 3);
  assert.equal(canMissMore({ present: 2, total: 10, remaining: 2, minimum: 75 }), 0);
  assert.deepEqual(readAttendanceSettings({}), { on: false, lateCountsPresent: true, lateAfterMinutes: 10, absenceNotes: true, checkInCode: false, minimum: null, minimumLocked: false });
  assert.deepEqual([readAttendanceSettings({ attendanceMinimum: 80, attendance: { minimum: 60 } }).minimum, readAttendanceSettings({ attendanceMinimum: 80 }).minimumLocked], [80, true], "B1.4b: the school's minimum wins");
  assert.equal(readAttendanceSettings({ attendance: { minimum: 75 } }).on, true);
  assert.equal(readAttendanceSettings({ attendance: { minimum: 75, on: false } }).on, false);
});

test("staff edit within 7 days of a session; the register is a CSV with letters", () => {
  assert.equal(editableByStaff("2027-01-12T10:30", new Date("2027-01-18T10:00:00Z")), true);
  assert.equal(editableByStaff("2027-01-12T10:30", new Date("2027-01-21T10:00:00Z")), false);
  const csv = registerCsv(held.slice(0, 2), [{ name: "Rao, A.", records: recs([[held[0]!, "present"]]), percent: 100 }]);
  assert.equal(csv, '"Student","2027-01-12 10:30","2027-01-14 10:30","Attendance %"\n"Rao, A.","P","","100"');
  assert.match(registerCsv([], [{ name: "=HYPERLINK(1)", records: new Map(), percent: null }]), /"'=HYPERLINK\(1\)"/, "a formula in a name is defused");
});

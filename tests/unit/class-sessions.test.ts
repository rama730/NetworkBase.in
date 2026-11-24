import assert from "node:assert/strict";
import test from "node:test";

import { nextSession, officeHoursToday, readClassDetails, readSessionChanges, termSessions } from "../../src/lib/organizations/class-sessions";

// Report 30.2 W1 (plan B1.1): sessions are meets × term − breaks, with changes applied; nothing else is stored.
const details = readClassDetails({ classDetails: {
  courseCode: "CS 301", meets: [{ day: 2, start: "10:30", end: "12:00" }, { day: 4, start: "10:30", end: "12:00" }, { day: 9, start: "10:00", end: "11:00" }],
  breaks: [{ name: "Midterm break", start: "2027-01-18", end: "2027-01-22" }], officeHours: { days: [3], start: "15:00", end: "16:00", place: "Room 12" },
  onlineLink: "http://insecure.example", show: { room: true },
} })!;

test("details are read defensively: bad meets and non-https links dropped, visitor rows default on/off", () => {
  assert.equal(details.meets.length, 2);
  assert.equal(details.onlineLink, null);
  assert.deepEqual(details.show, { courseCode: true, meets: true, term: true, room: true, officeHours: false });
  assert.equal(readClassDetails({}), null);
});

test("Tue and Thu over three weeks, the break week skipped, a cancel and a move applied", () => {
  const changes = readSessionChanges({ sessionChanges: { "2027-01-12T10:30": { cancelled: true }, "2027-01-14T10:30": { movedTo: "2027-01-15T09:00" }, "bad": { cancelled: true } } });
  const list = termSessions(details, { start: "2027-01-11", end: "2027-01-29" }, changes);
  assert.deepEqual(list.map((s) => [s.start, s.status]), [
    ["2027-01-12T10:30", "cancelled"], ["2027-01-15T09:00", "moved"], ["2027-01-26T10:30", "on"], ["2027-01-28T10:30", "on"],
  ]);
  assert.equal(list[1]!.end, "2027-01-15T10:30", "a moved class keeps its length");
  assert.deepEqual(termSessions(details, { start: null, end: "2027-01-29" }), [], "no term, no sessions");
});

test("next class is the first not yet ended, in the class's zone; office hours only on their days", () => {
  const list = termSessions(details, { start: "2027-01-11", end: "2027-01-29" });
  // 10:45 in Kolkata on Tue 12 Jan is 05:15 UTC: that class is still running.
  assert.equal(nextSession(list, "Asia/Kolkata", new Date("2027-01-12T05:15:00Z"))!.start, "2027-01-12T10:30");
  assert.equal(nextSession(list, "Asia/Kolkata", new Date("2027-01-12T07:00:00Z"))!.start, "2027-01-14T10:30");
  assert.equal(nextSession(list, "Asia/Kolkata", new Date("2027-02-01T00:00:00Z")), null);
  assert.ok(officeHoursToday(details, "Asia/Kolkata", new Date("2027-01-13T06:00:00Z")), "Wednesday");
  assert.equal(officeHoursToday(details, "Asia/Kolkata", new Date("2027-01-14T06:00:00Z")), null);
});

test("live check B1.1: a saved or browser zone the browser lists by another name is still an option (never falls back to Africa/Abidjan)", async () => {
  const { timeZoneOptions } = await import("../../src/lib/organizations/zoned-time");
  const list = timeZoneOptions("Mars/Olympus_Mons", null);
  assert.equal(list[0], "Mars/Olympus_Mons");
  assert.ok(list.includes(Intl.DateTimeFormat().resolvedOptions().timeZone));
  assert.equal(timeZoneOptions("UTC").filter((z) => z === "UTC").length <= 1, true, "no duplicates");
});

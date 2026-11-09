import assert from "node:assert/strict";
import { test } from "node:test";

import {
  addDaysToDay, dayList, describeLocal, isTimeOfDay, nextWeekday, relativeDay, timeLabel, TIME_OPTIONS, todayInZone, weeklyDays,
} from "../../src/lib/organizations/zoned-time";

// Assignment form redesign (2026-11-09): pick a date, the time is filled in; the line under it says what was picked.

test("days move by calendar day, whatever the zone", () => {
  assert.equal(addDaysToDay("2026-11-28", 7), "2026-12-05");
  assert.equal(addDaysToDay("2026-03-01", -1), "2026-02-28");
  // 9 Nov 2026 is a Monday: next Monday is a week on, next Friday is this week.
  assert.equal(nextWeekday("2026-11-09", 1), "2026-11-16");
  assert.equal(nextWeekday("2026-11-09", 5), "2026-11-13");
});

test("today is the organization's today", () => {
  // 20:00 UTC on 9 Nov is already 10 Nov in India, still 9 Nov in New York.
  const now = new Date("2026-11-09T20:00:00Z");
  assert.equal(todayInZone("Asia/Kolkata", now), "2026-11-10");
  assert.equal(todayInZone("America/New_York", now), "2026-11-09");
});

test("times read the way people say them", () => {
  assert.equal(timeLabel("23:59"), "11:59 PM");
  assert.equal(timeLabel("00:00"), "12:00 AM");
  assert.equal(timeLabel("12:30"), "12:30 PM");
  assert.equal(timeLabel("08:00"), "8:00 AM");
  assert.ok(TIME_OPTIONS.includes("23:59") && TIME_OPTIONS.includes("08:30") && TIME_OPTIONS.length === 49);
  assert.equal(isTimeOfDay("23:59"), true);
  assert.equal(isTimeOfDay("24:00"), false);
  assert.equal(isTimeOfDay("9:00"), false);
});

test("the summary line: the day, the time, how far away, and your own time when it differs", () => {
  const now = new Date("2026-11-09T04:00:00Z"); // 9:30 AM, 9 Nov in India
  const d = describeLocal("2026-11-14T23:59", "Asia/Kolkata", "Asia/Kolkata", now);
  assert.deepEqual(d, { text: "Sat 14 Nov, 11:59 PM", relative: "in 5 days", yourTime: null });
  // Asia/Calcutta is the same clock: no "your time".
  assert.equal(describeLocal("2026-11-14T23:59", "Asia/Kolkata", "Asia/Calcutta", now).yourTime, null);
  // In London it's 6:29 PM the same day; in New York it's 1:29 PM the same day.
  assert.equal(describeLocal("2026-11-14T23:59", "Asia/Kolkata", "Europe/London", now).yourTime, "6:29 PM");
  // In Tokyo it's already the 15th.
  assert.equal(describeLocal("2026-11-14T23:59", "Asia/Kolkata", "Asia/Tokyo", now).yourTime, "Sun 15 Nov, 3:29 AM");
  assert.equal(relativeDay(0), "today");
  assert.equal(relativeDay(1), "tomorrow");
  assert.equal(relativeDay(-1), "yesterday");
  assert.equal(relativeDay(-3), "3 days ago");
});

test("weekly repeats list the days they make, like the server does", () => {
  const days = weeklyDays("2026-11-14", "2026-12-05");
  assert.deepEqual(days, ["2026-11-14", "2026-11-21", "2026-11-28", "2026-12-05"]);
  assert.equal(dayList(days), "14, 21, 28 Nov, 5 Dec");
  assert.equal(weeklyDays("2026-11-14", "2026-11-20").length, 1);
  // Never more than the server makes (the first week plus 26).
  assert.equal(weeklyDays("2026-01-01", "2028-01-01").length, 27);
});

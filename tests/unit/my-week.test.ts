import assert from "node:assert/strict";
import { test } from "node:test";

import { examStrip, groupWeek, pinsForToday, type WeekItem } from "../../src/lib/organizations/my-week";

// Plan B1.7 (report 30.4 W3).
const item = (id: string, at: string, kind: WeekItem["kind"] = "copy"): WeekItem => ({ id, kind, at, title: id, context: null, href: null, status: null });
const now = new Date("2027-02-17T08:00:00Z"); // Wed 17 Feb, 13:30 in Kolkata

test("days run Today, Tomorrow, then dates; items land on the viewer's day, in time order; 8 a day then +N more", () => {
  const items = [item("late-night", "2027-02-17T19:00:00Z"), item("morning", "2027-02-17T04:00:00Z", "session"), item("tomorrow", "2027-02-18T10:00:00Z"), item("too-far", "2027-02-25T10:00:00Z"), item("past", "2027-02-16T10:00:00Z")];
  const kolkata = groupWeek(items, "Asia/Kolkata", now);
  assert.deepEqual(kolkata.slice(0, 3).map((d) => d.label), ["Today", "Tomorrow", "Fri 19 Feb"]);
  assert.deepEqual(kolkata[0]!.items.map((i) => i.id), ["morning"], "19:00 UTC is already the next day, 00:30, in Kolkata");
  assert.deepEqual(kolkata[1]!.items.map((i) => i.id), ["late-night", "tomorrow"]);
  assert.equal(kolkata.flatMap((d) => d.items).some((i) => i.id === "too-far" || i.id === "past"), false);
  const utc = groupWeek(items, "UTC", now);
  assert.deepEqual(utc[0]!.items.map((i) => i.id), ["morning", "late-night"], "the same rows in UTC");
  const busy = groupWeek(Array.from({ length: 11 }, (_, i) => item(`t${i}`, `2027-02-17T1${i % 10}:00:00Z`)), "UTC", now);
  assert.deepEqual([busy[0]!.items.length, busy[0]!.more], [8, 3]);
});

test("pins: only today's, at most 3; the exam strip shows the nearest within 14 days", () => {
  const pins = [{ taskId: "a", day: "2027-02-17" }, { taskId: "old", day: "2027-02-16" }, { taskId: "b", day: "2027-02-17" }, { taskId: "c", day: "2027-02-17" }, { taskId: "d", day: "2027-02-17" }];
  assert.deepEqual(pinsForToday(pins, "UTC", now), ["a", "b", "c"]);
  const exams = [{ id: "far", title: "Final", context: "CS 301", opensAt: "2027-03-20T10:00:00Z", href: "/x" }, { id: "mid", title: "Midterm", context: "CS 301", opensAt: "2027-02-26T10:00:00Z", href: "/y" }];
  assert.equal(examStrip(exams, "UTC", now)?.when, "In 9 days");
  assert.equal(examStrip([exams[0]!], "UTC", now), null, "beyond 14 days, no strip");
  assert.equal(examStrip([{ ...exams[1]!, opensAt: "2027-02-18T09:00:00Z" }], "UTC", now)?.when, "Tomorrow");
});

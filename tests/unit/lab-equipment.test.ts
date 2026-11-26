import assert from "node:assert/strict";
import { test } from "node:test";

import { bookingIcs, bookingRulesSchema, daySlots, isSlot, weekBounds } from "../../src/lib/organizations/lab-equipment";

const rules = { from: "08:00", to: "12:00", slotMinutes: 120 as const, weeklyCapHours: 4 };

test("35.5 call 7: a day's slots in the lab's zone; a booking must be one of them", () => {
  const slots = daySlots("2026-12-03", rules, "Asia/Calcutta");
  assert.deepEqual(slots.map((s) => s.label), ["08:00–10:00", "10:00–12:00"]);
  assert.equal(slots[0]!.start, "2026-12-03T02:30:00.000Z");
  assert.ok(isSlot("2026-12-03T02:30:00.000Z", rules, "Asia/Calcutta"));
  assert.equal(isSlot("2026-12-03T03:00:00.000Z", rules, "Asia/Calcutta"), null, "off the grid");
  assert.equal(isSlot("2026-12-03T07:30:00.000Z", rules, "Asia/Calcutta"), null, "outside bookable hours");
  assert.equal(bookingRulesSchema.safeParse({ ...rules, from: "12:00", to: "08:00" }).success, false);
});

test("the weekly cap counts Monday to Sunday in the lab's zone; .ics has the slot", () => {
  const w = weekBounds("2026-12-03T02:30:00.000Z", "Asia/Calcutta");
  assert.deepEqual(w, { start: "2026-11-29T18:30:00.000Z", end: "2026-12-06T18:30:00.000Z" });
  const ics = bookingIcs({ id: "b1", start: "2026-12-03T02:30:00.000Z", end: "2026-12-03T04:30:00.000Z", equipment: "Capture rig A", place: "Lab 2", lab: "Vision lab" });
  assert.match(ics, /DTSTART:20261203T023000Z/);
  assert.match(ics, /LOCATION:Lab 2/);
});

test("review: clock-change days drop slots that aren't their length; a cap below one slot is refused", () => {
  const ny = daySlots("2027-03-14", { from: "00:00", to: "04:00", slotMinutes: 30, weeklyCapHours: 8 }, "America/New_York");
  assert.ok(!ny.some((s) => s.label === "01:30–02:00" || s.label === "02:00–02:30"), "the skipped hour has no slots");
  assert.ok(ny.every((s) => Date.parse(s.end) - Date.parse(s.start) === 30 * 60_000));
  assert.equal(bookingRulesSchema.safeParse({ from: "08:00", to: "20:00", slotMinutes: 240, weeklyCapHours: 1 }).success, false);
  assert.doesNotMatch(bookingIcs({ id: "b", start: "2026-12-03T02:30:00Z", end: "2026-12-03T04:30:00Z", equipment: "Rig\rX-INJECT:1", place: null, lab: "L" }), /\rX-INJECT/);
});

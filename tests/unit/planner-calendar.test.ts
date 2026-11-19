import assert from "node:assert/strict";
import { test } from "node:test";

import { agendaDays, calendarCells, dueOn, monthRange, shiftMonth, weekCells } from "../../src/lib/workflows/planner";

// Report 38.5 T1 part 7 (calendarCells) and W8, W10 (plan A1.1).
const items = [
  { id: "a", dueDate: "2026-11-20T00:00:00.000Z" },
  { id: "b", dueDate: "2026-11-20T00:00:00.000Z" },
  { id: "c", dueDate: "2026-11-20T00:00:00.000Z" },
  { id: "d", dueDate: "2026-11-20T00:00:00.000Z" },
  { id: "e", dueDate: "2026-11-30T23:30:00.000Z" },
  { id: "f", dueDate: null },
];

test("calendarCells: Monday first, whole weeks, weekends marked, today marked, +n more after three", () => {
  const weeks = calendarCells("2026-11", items, "2026-11-20");
  assert.equal(weeks[0]![0]!.key, "2026-10-26", "the Monday on or before Nov 1");
  assert.equal(weeks.at(-1)!.at(-1)!.key, "2026-12-06", "the Sunday on or after Nov 30");
  assert.equal(weeks[0]![0]!.inMonth, false);
  const fri = weeks.flat().find((d) => d.key === "2026-11-20")!;
  assert.deepEqual([fri.isToday, fri.weekend, fri.items.map((i) => i.id), fri.more], [true, false, ["a", "b", "c"], 1]);
  assert.equal(weeks.flat().find((d) => d.key === "2026-11-21")!.weekend, true);
});

test("a due date is a calendar day (UTC midnight), so 23:30 UTC stays on its own day", () => {
  const weeks = calendarCells("2026-11", items, "2026-11-20");
  assert.deepEqual(weeks.flat().find((d) => d.key === "2026-11-30")!.items.map((i) => i.id), ["e"]);
  assert.equal(dueOn("2026-11-26"), "2026-11-26T00:00:00.000Z");
});

test("week, agenda, month range and month stepping", () => {
  assert.deepEqual(weekCells("2026-11-16", items, "2026-11-20").map((d) => d.items.length), [0, 0, 0, 0, 4, 0, 0]);
  assert.deepEqual(agendaDays("2026-11-01", "2026-11-30", items).map((d) => [d.key, d.items.length]), [["2026-11-20", 4], ["2026-11-30", 1]]);
  assert.deepEqual(monthRange("2026-11"), { from: "2026-10-26", to: "2026-12-06" });
  assert.deepEqual([shiftMonth("2026-12", 1), shiftMonth("2026-01", -1)], ["2027-01", "2025-12"]);
});

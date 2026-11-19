import assert from "node:assert/strict";
import { test } from "node:test";

import { agendaDays, calendarCells, dueOn, monthRange, shiftMonth, weekCells, timelineRange, barGeometry, conflicts, dependentsToShift } from "../../src/lib/workflows/planner";

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

import { canBeParent, canBePartOf, completion } from "../../src/lib/workflows/planner";
import { footerLine, startingStages } from "../../src/lib/workflows/create-rules";
import { showsIn } from "../../src/lib/workflows/display";

// Report 38.5 T1 part 7 (completion, canBePartOf, canBeParent) and part 5's project stages (plan A1.3).
test("completion: completed ÷ all, cancelled ignored; subtasks when no work; a hand-set number wins", () => {
  const w = (status: string, stage?: string) => ({ status, stage: stage ?? null });
  assert.deepEqual(completion([w("done"), w("done"), w("todo"), w("in_progress")], { done: 0, total: 0 }, null), { percent: 50, source: "work" });
  assert.deepEqual(completion([w("done"), w("todo"), w("done", "cancelled")], { done: 0, total: 0 }, null), { percent: 50, source: "work" });
  assert.deepEqual(completion([], { done: 1, total: 2 }, null), { percent: 50, source: "subtasks" });
  assert.deepEqual(completion([w("done")], { done: 0, total: 0 }, 30), { percent: 30, source: "hand" });
  assert.deepEqual(completion([], { done: 0, total: 0 }, null), { percent: 0, source: "none" });
});

test("Part of: tasks, bugs, requests and content can be; projects can't; only a project is a parent", () => {
  assert.deepEqual(["task", "bug", "request", "content", "project"].map(canBePartOf), [true, true, true, true, false]);
  assert.deepEqual([canBeParent("project"), canBeParent("task")], [true, false]);
});

test("a project starts Not started, Planning or In progress; never on the board; shows in Projects", () => {
  assert.deepEqual(startingStages("project").map((s) => s.key), ["not_started", "planning", "in_progress"]);
  assert.equal(footerLine("project", "not_started", true), "Shows in Projects");
  assert.deepEqual(showsIn("project", "in_progress", "in_progress"), [{ tab: "projects", label: "Projects · In progress" }]);
});

import { defaultStageFor } from "../../src/lib/workflows/rules";
test("a project's default stage is Not started from Tasks too", () => {
  assert.equal(defaultStageFor("project", "tasks"), "not_started");
});

// Report 38.5 part 7 (A1.4): the Timeline's range, bars, conflicts and who shifts.
test("timelineRange: Month shows ±2 months; Week ±3 weeks from Monday; Quarter ±6 months", () => {
  assert.deepEqual(timelineRange("month", "2026-11-20"), { start: "2026-09-01", end: "2027-01-31", days: 153 });
  assert.deepEqual(timelineRange("week", "2026-11-20"), { start: "2026-10-26", end: "2026-12-13", days: 49 });
  assert.equal(timelineRange("quarter", "2026-11-20").start, "2026-05-01");
});

test("barGeometry: in range, a one-day bar, edge markers before and after, clipped ends", () => {
  const r = timelineRange("month", "2026-11-20");
  assert.deepEqual(barGeometry("2026-09-01", "2026-09-03", r), { left: 0, width: 3 });
  assert.deepEqual(barGeometry(null, "2026-11-20", r), { left: 80, width: 1 });
  assert.deepEqual(barGeometry("2026-01-01", "2026-03-12", r), { edge: "before", date: "2026-03-12" });
  assert.deepEqual(barGeometry("2027-03-01", "2027-03-05", r), { edge: "after", date: "2027-03-01" });
  assert.deepEqual(barGeometry("2026-08-20", "2026-09-02", r), { left: 0, width: 2 });
  assert.equal(barGeometry(null, null, r), null);
});

test("conflicts: a blocked project starting before its blocker ends; the same day is fine", () => {
  const projects = [{ id: "a", start: "2026-12-01", end: "2026-12-05" }, { id: "b", start: "2026-12-04", end: "2026-12-10" }, { id: "c", start: "2026-12-05", end: "2026-12-09" }];
  assert.deepEqual(conflicts(projects, [{ taskId: "b", blockedById: "a" }, { taskId: "c", blockedById: "a" }]), [{ blocker: "a", blocked: "b" }]);
});

test("dependentsToShift: a chain moves B and C; a diamond moves each once", () => {
  assert.deepEqual(dependentsToShift("a", [{ taskId: "b", blockedById: "a" }, { taskId: "c", blockedById: "b" }]), ["b", "c"]);
  const diamond = [{ taskId: "b", blockedById: "a" }, { taskId: "c", blockedById: "a" }, { taskId: "d", blockedById: "b" }, { taskId: "d", blockedById: "c" }];
  assert.deepEqual(dependentsToShift("a", diamond), ["b", "c", "d"]);
});

test("calendar spans (call 8, A1.4): an item with a start shows on each of its days across a week break", () => {
  const item = { id: "p", startDate: "2026-11-28T00:00:00.000Z", dueDate: "2026-12-01T00:00:00.000Z" };
  const weeks = calendarCells("2026-11", [item], "2026-11-20");
  const days = weeks.flat().filter((d) => d.items.length).map((d) => d.key);
  assert.deepEqual(days, ["2026-11-28", "2026-11-29", "2026-11-30", "2026-12-01"]);
  assert.equal(new Set(weeks.filter((w) => w.some((d) => d.items.length)).map((w) => w[0]!.key)).size, 2);
});

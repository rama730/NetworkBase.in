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

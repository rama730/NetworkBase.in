import assert from "node:assert/strict";
import test from "node:test";

import { allTaught, behind, draftSoon, lessonTypeOf, plannedPercent, readGroups, readTicks } from "@/lib/organizations/curriculum";

test("lesson types and a course's classes", () => {
  assert.equal(lessonTypeOf({ lessonType: "assessment" }), "assessment");
  assert.equal(lessonTypeOf({ lessonType: "quiz" }), "lesson");
  assert.deepEqual(readGroups({ termPlan: { groups: [" 6A ", "6B", "6A", "", 4, "6C"] } }), ["6A", "6B", "6C"]);
  assert.deepEqual(readTicks({ taught: { "6A": { on: "2026-10-07", by: "u" }, "6B": null } }), { "6A": { on: "2026-10-07", by: "u" } });
});

test("Ready is shared, Taught is per class: a lesson is Taught when every class has it", () => {
  assert.equal(allTaught(["6A", "6B"], { "6A": { on: "x", by: "u" } }), false);
  assert.equal(allTaught(["6A", "6B"], { "6A": { on: "x", by: "u" }, "6B": { on: "y", by: "v" } }), true);
  assert.equal(allTaught([], {}), false, "a course with no classes keeps its own stage");
});

test("Behind the map per class; Planned; Draft ⚠ within 3 school days", () => {
  const t = (g: string[]) => Object.fromEntries(g.map((x) => [x, { on: "2026-10-01", by: "u" }]));
  const lessons = [
    { stage: "taught", day: "2026-10-05", ticks: t(["6A", "6B"]) },
    { stage: "ready", day: "2026-10-06", ticks: t(["6A"]) },
    { stage: "ready", day: "2026-10-07", ticks: {} },
    { stage: "cancelled", day: "2026-10-07", ticks: {} },
    { stage: "draft", day: "2026-10-20", ticks: {} },
  ];
  assert.deepEqual(behind(lessons, "6A", "2026-10-08"), { due: 3, taught: 2, behind: 1, warn: false });
  assert.deepEqual(behind(lessons, "6B", "2026-10-08"), { due: 3, taught: 1, behind: 2, warn: true });
  assert.equal(behind([{ stage: "taught", day: "2026-10-05", ticks: {} }], "6A", "2026-10-08").behind, 0, "found live: Taught before classes were listed counts for every class");
  assert.deepEqual(plannedPercent(lessons), { ready: 3, total: 4, percent: 75 });
  // Thu 2026-10-08 → Tue 2026-10-13 is Thu, Fri, Mon: 3 school days.
  assert.equal(draftSoon("draft", "2026-10-13", "2026-10-08"), true);
  assert.equal(draftSoon("draft", "2026-10-14", "2026-10-08"), false);
  assert.equal(draftSoon("ready", "2026-10-09", "2026-10-08"), false);
});

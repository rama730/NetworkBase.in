import assert from "node:assert/strict";
import { test } from "node:test";

import { PHASE_WORDS, sprintPace, sprintPhase, sprintTime, termRail, workGroups, workProgress } from "../../src/lib/workspaces/sprint-plan";

// Sprint redesign (docs/superpowers/plans/2026-11-04-sprint-redesign.md): the rules behind the page.
const now = new Date("2026-11-04T10:00:00Z");
const s = (id: string, status: string, start: string | null, end: string | null) => ({ id, status, startDate: start, endDate: end }) as never;

test("§4: each sprint has one phase word: Upcoming, Running, Ended, Closed, Canceled, Archived", () => {
  assert.equal(sprintPhase(s("a", "planning", "2026-11-16", "2026-11-30"), now), "upcoming");
  assert.equal(sprintPhase(s("a", "active", "2026-11-01", "2026-11-15"), now), "running");
  assert.equal(sprintPhase(s("a", "active", "2026-10-20", "2026-11-03"), now), "ended", "ended yesterday, not closed yet");
  assert.equal(sprintPhase(s("a", "active", "2026-10-20", "2026-11-04"), now), "running", "its last day still runs");
  assert.equal(sprintPhase(s("a", "completed", null, null), now), "closed");
  assert.deepEqual(Object.values(PHASE_WORDS).map((w) => w.label), ["Upcoming", "Running", "Ended", "Closed", "Canceled", "Archived"]);
});

test("§5.3: time is counted in days, and pace compares work done with time passed", () => {
  assert.deepEqual(sprintTime(s("a", "active", "2026-11-01", "2026-11-15"), now), { day: 4, days: 15, percent: 27, daysLeft: 11 });
  assert.deepEqual(sprintTime(s("a", "planning", "2026-11-16", "2026-11-30"), now), { day: 0, days: 15, percent: 0, daysLeft: 15 });
  assert.equal(sprintPace(27, 50), "ahead");
  assert.equal(sprintPace(40, 35), "on track");
  assert.equal(sprintPace(60, 30), "behind");
  assert.deepEqual(workProgress({ totalTasks: 4, completedTasks: 1, totalStoryPoints: 26, completedStoryPoints: 5 } as never), { done: 5, total: 26, unit: "points", percent: 19 });
  assert.deepEqual(workProgress({ totalTasks: 2, completedTasks: 1, totalStoryPoints: 0, completedStoryPoints: 0 } as never), { done: 1, total: 2, unit: "tasks", percent: 50 });
});

test("§5.1: the rail groups the term into Now, Next, Later and Past, with the gaps between planned sprints", () => {
  const rail = termRail([
    s("co1", "active", "2026-11-01", "2026-11-15"), s("co3", "planning", "2026-12-01", "2026-12-14"), s("co2", "planning", "2026-11-16", "2026-11-30"),
    s("co5", "planning", "2026-12-21", "2027-01-03"), s("old", "completed", "2026-10-01", "2026-10-14"), s("x", "cancelled", "2026-10-15", "2026-10-20"),
  ], now);
  const shape = rail.map((g) => [g.key, g.items.map((i) => (i.type === "gap" ? `gap ${i.from}–${i.to}` : (i.sprint as { id: string }).id))]);
  assert.deepEqual(shape, [["now", ["co1"]], ["next", ["co2"]], ["later", ["co3", "gap 2026-12-15–2026-12-20", "co5"]], ["past", ["x", "old"]]], "past: newest first");
  assert.deepEqual(termRail([], now), []);
});

test("§5.4, §8.5: work groups by state (In progress, Blocked, In review, To do, Done) or by person; removed work folds away", () => {
  const t = (id: string, status: string, extra: Record<string, unknown> = {}) => ({ id, status, reviewStatus: "none", membershipState: "committed", isDeleted: false, assignee: null, ...extra }) as never;
  const tasks = [t("a", "todo"), t("b", "in_progress", { assignee: { id: "u1", fullName: "Ravi" } }), t("c", "done", { reviewStatus: "pending" }), t("d", "blocked"), t("e", "done"), t("f", "todo", { membershipState: "historical" })];
  const byState = workGroups(tasks, "state");
  assert.deepEqual(byState.groups.map((g) => [g.title, g.tasks.map((x: { id: string }) => x.id)]), [["In progress", ["b"]], ["Blocked", ["d"]], ["In review", ["c"]], ["To do", ["a"]], ["Done", ["e"]]]);
  assert.deepEqual(byState.removed.map((x: { id: string }) => x.id), ["f"]);
  const byPerson = workGroups(tasks, "person");
  assert.deepEqual(byPerson.groups.map((g) => g.title), ["Ravi", "Nobody yet"]);
  assert.deepEqual(workGroups(tasks, "state", "u1").groups.map((g) => g.title), ["In progress"], "Mine");
});

test("§6.2: the form's term strip shows the neighbours and says how the new sprint fits", async () => {
  const { termStrip } = await import("../../src/lib/workspaces/sprint-plan");
  const existing = [s("co1", "active", "2026-11-01", "2026-11-15"), s("co3", "planning", "2026-12-01", "2026-12-14"), s("gone", "cancelled", "2026-11-16", "2026-11-20")].map((x: object, i) => ({ ...x, name: ["CO1", "CO3", "Gone"][i] }));
  assert.deepEqual(termStrip({ startDate: "2026-11-16", endDate: "2026-11-30" }, existing as never), { before: "CO1", after: "CO3", clash: null, line: "Starts right after CO1. No overlap." });
  assert.equal(termStrip({ startDate: "2026-11-20", endDate: "2026-11-30" }, existing as never).line, "Starts 4 days after CO1.");
  assert.deepEqual(termStrip({ startDate: "2026-11-10", endDate: "2026-11-30" }, existing as never).clash, "CO1");
  assert.equal(termStrip({ startDate: "2026-11-10", endDate: "2026-11-30" }, existing as never).line, "Overlaps CO1.");
  assert.equal(termStrip({ startDate: "2027-02-01", endDate: "2027-02-10" }, [] as never).line, "No other sprint around these dates.");
  assert.equal(termStrip({ startDate: "2026-11-16", endDate: "2026-11-30" }, existing as never, "co1").before, null, "editing a sprint leaves itself out");
});

test("§6: a sprint inside a main sprint is named with it, and the running one is the sprint inside when both run", async () => {
  const { sprintPath, runningSprint, nestTerm } = await import("../../src/lib/workspaces/sprint-plan");
  const all = [
    { id: "co1", name: "CO1", status: "active", parentSprintId: null, startDate: "2026-11-01", endDate: "2026-12-12" },
    { id: "w1", name: "Week 1–2", status: "completed", parentSprintId: "co1", startDate: "2026-11-01", endDate: "2026-11-14" },
    { id: "w3", name: "Week 3–4", status: "active", parentSprintId: "co1", startDate: "2026-11-15", endDate: "2026-11-28" },
    { id: "team", name: "Parser week", status: "active", parentSprintId: "org-sprint-elsewhere", startDate: "2026-11-02", endDate: "2026-11-08" },
  ];
  assert.equal(sprintPath(all[2]!, all), "CO1 · Week 3–4");
  assert.equal(sprintPath(all[0]!, all), "CO1");
  assert.equal(sprintPath(all[3]!, all), "Parser week", "a parent in another workspace isn't part of the name");
  assert.equal(runningSprint(all)?.id, "w3");
  assert.equal(runningSprint([all[0]!])?.id, "co1");
  const nested = nestTerm(all as never);
  assert.deepEqual(nested.top.map((s: { id: string }) => s.id), ["co1", "team"]);
  assert.deepEqual(nested.inside.get("co1")!.map((s: { id: string }) => s.id), ["w1", "w3"]);
});

test("§6 rail: a CO counts its weeks, and the sprints inside it show the days nobody planned between them", async () => {
  const { weekOf, withGaps } = await import("../../src/lib/workspaces/sprint-plan");
  assert.equal(weekOf({ startDate: "2026-11-01", endDate: "2026-12-12" }, new Date("2026-11-16T10:00:00Z")), "week 3 of 6");
  assert.equal(weekOf({ startDate: "2026-12-01", endDate: "2026-12-12" }, new Date("2026-11-16T10:00:00Z")), null, "not started");
  const inside = [
    { id: "w1", startDate: "2026-11-01", endDate: "2026-11-14", status: "completed" },
    { id: "w3", startDate: "2026-11-20", endDate: "2026-11-28", status: "planning" },
    { id: "x", startDate: "2026-11-15", endDate: "2026-11-19", status: "cancelled" },
    { id: "w5", startDate: "2026-11-29", endDate: "2026-12-12", status: "planning" },
  ];
  assert.deepEqual(withGaps(inside).map((i) => (i.type === "gap" ? `gap ${i.from}–${i.to}` : i.sprint.id)), ["w1", "x", "gap 2026-11-15–2026-11-19", "w3", "w5"]);
});

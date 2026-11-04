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

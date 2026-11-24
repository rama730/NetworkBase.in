import assert from "node:assert/strict";
import test from "node:test";

import { matchSessions, outcomeCoverage, readTermPlanSettings, sessionsInWeek, unitProgress, visibleLessons, weekNumber, type PlanLesson } from "../../src/lib/organizations/term-plan";
import type { Session } from "../../src/lib/organizations/class-sessions";

// Report 30.3 W2 (plan B1.2): the Term plan's rules.
const lesson = (id: string, stage: string, order = 0, outcomes: string[] = []): PlanLesson => ({ id, number: null, title: id, stage, weekId: "w1", order, outcomes, createdAt: `2027-01-0${order + 1}T00:00:00Z` });
const sess = (key: string, status: Session["status"] = "on"): Session => ({ key, start: key, end: key, status });

test("students see Ready and Taught (or Always); staff see everything; cancelled lessons never reach students", () => {
  const all = [lesson("a", "draft"), lesson("b", "ready"), lesson("c", "taught"), lesson("d", "cancelled")];
  assert.deepEqual(visibleLessons(all, false, "ready").map((l) => l.id), ["b", "c"]);
  assert.deepEqual(visibleLessons(all, false, "always").map((l) => l.id), ["a", "b", "c"]);
  assert.equal(visibleLessons(all, true, "ready").length, 4);
});

test("call 5: lessons take the week's sessions in order; a cancelled session leaves its lesson Needs a new session; extras get none", () => {
  const slots = matchSessions([lesson("b", "ready", 1), lesson("a", "draft", 0), lesson("c", "draft", 2), lesson("x", "cancelled", 3)],
    [sess("2027-01-14T10:30", "cancelled"), sess("2027-01-12T10:30")]);
  assert.deepEqual(slots.map((s) => [s.lessonId, s.session?.key ?? null, s.needsNewSession]), [
    ["a", "2027-01-12T10:30", false], ["b", "2027-01-14T10:30", true], ["c", null, false],
  ]);
  assert.equal(matchSessions([lesson("t", "taught")], [sess("2027-01-12T10:30", "moved")])[0]!.needsNewSession, false, "a taught lesson is done");
});

test("weeks hold sessions by their original day; progress, coverage and Week N of M", () => {
  assert.deepEqual(sessionsInWeek([sess("2027-01-12T10:30"), sess("2027-01-19T10:30")], { start: "2027-01-11T00:00:00Z", end: "2027-01-17T00:00:00Z" }).map((s) => s.key), ["2027-01-12T10:30"]);
  assert.deepEqual(unitProgress([lesson("a", "taught"), lesson("b", "ready"), lesson("c", "cancelled")]), { taught: 1, planned: 2, percent: 50 });
  const cov = outcomeCoverage([{ code: "CO1", text: "" }, { code: "CO2", text: "" }], [lesson("a", "ready", 0, ["CO1"]), lesson("b", "cancelled", 1, ["CO2"])]);
  assert.deepEqual([cov.covered, cov.total, cov.missing.map((o) => o.code)], [1, 2, ["CO2"]]);
  const weeks = [{ id: "w2", unitId: "u", name: "W2", goal: null, start: "2027-01-18T00:00:00Z", end: "2027-01-24T00:00:00Z", status: "planning" },
    { id: "w1", unitId: "u", name: "W1", goal: null, start: "2027-01-11T00:00:00Z", end: "2027-01-17T00:00:00Z", status: "active" }];
  assert.deepEqual(weekNumber(weeks, "2027-01-20"), { current: 2, total: 2, weekId: "w2" });
  assert.deepEqual(weekNumber(weeks, "2027-03-01").current, null);
  assert.deepEqual(readTermPlanSettings({ termPlan: { studentsSee: "always", topicsLabel: "Chapters", outcomes: [{ code: " CO1 ", text: "Arrays" }, { code: "", text: "x" }] } }),
    { outcomes: [{ code: "CO1", text: "Arrays" }], studentsSee: "always", topicsLabel: "Chapters" });
});

import assert from "node:assert/strict";
import { test } from "node:test";

import { aWord, cleanMainWord, renamedSprint, sprintWords } from "../../src/lib/organizations/sprint-words";
import { paceLine } from "../../src/lib/workspaces/sprint-plan";

// Sprint redesign (2026-11-09): "CO" becomes Unit for a class and Phase elsewhere; admins may name it themselves.

test("the main sprint's word follows the type, and an admin's own word wins", () => {
  assert.deepEqual(sprintWords("education"), { main: "Unit", inner: "Week", plan: "Term", isClass: true });
  assert.deepEqual(sprintWords("company"), { main: "Phase", inner: "Sprint", plan: "Plan", isClass: false });
  assert.equal(sprintWords("education", { mainSprintWord: "module" }).main, "Module");
  assert.equal(sprintWords("company", { mainSprintWord: "  " }).main, "Phase", "a blank word falls back");
});

test("only a short word of letters is kept", () => {
  assert.equal(cleanMainWord("milestone"), "Milestone");
  assert.equal(cleanMainWord("Course  block"), "Course block");
  assert.equal(cleanMainWord("CO1"), null);
  assert.equal(cleanMainWord("x".repeat(21)), null);
  assert.equal(cleanMainWord(42), null);
});

test("a or an, the way it's said", () => {
  assert.equal(aWord("Unit"), "a unit");
  assert.equal(aWord("Phase"), "a phase");
  assert.equal(aWord("Iteration"), "an iteration");
  assert.equal(aWord("Module"), "a module");
});

test("old numbered names take the new word; anything else stays", () => {
  assert.equal(renamedSprint("CO1", "Unit"), "Unit 1");
  assert.equal(renamedSprint("CO3: Trees", "Unit"), "Unit 3: Trees");
  assert.equal(renamedSprint("CO 2 Arrays and lists", "Unit"), "Unit 2 Arrays and lists");
  assert.equal(renamedSprint("Sprint 4", "Phase"), "Phase 4");
  assert.equal(renamedSprint("Unit 1", "Unit"), null, "already right");
  assert.equal(renamedSprint("COMP101", "Unit"), null);
  assert.equal(renamedSprint("CO1Arrays", "Unit"), null);
  assert.equal(renamedSprint("Parser week", "Unit"), null);
});

test("pace says why", () => {
  assert.equal(paceLine(60, 30), "behind · 60% of the time gone, 30% done");
  assert.equal(paceLine(40, 55), "ahead · 40% of the time gone, 55% done");
  assert.equal(paceLine(50, 45), "on track · 50% of the time gone, 45% done");
});

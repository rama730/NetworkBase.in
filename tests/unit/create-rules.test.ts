import assert from "node:assert/strict";
import { test } from "node:test";

import { addedTypes, footerLine, newMenuLine, moduleTabs, sectionsFor, sprintApplies, startingStages, typeFieldsSchema } from "../../src/lib/workflows/create-rules";
import { defaultStageFor } from "../../src/lib/workflows/rules";

// Report 38.4 F3 part 7 (plan A0.8): the New module's tabs, starting stages, footer line and renamed labels.
test("moduleTabs: Task first, added types in the fixed order, Assignment last in an organization", () => {
  assert.deepEqual(addedTypes(["requests", "bugs", "meetings"]), ["bug", "request"]);
  assert.deepEqual(moduleTabs(addedTypes(["requests", "bugs"])), ["task", "bug", "request"]);
  assert.deepEqual(moduleTabs([], { assignment: true }), ["task", "assignment"]);
  assert.deepEqual(moduleTabs(addedTypes(["roadmap"])), ["task", "roadmap_item"], "A2.10: roadmap items are in the registry");
  assert.deepEqual(addedTypes(["ideas"]), [], "a type the registry doesn't define yet adds no tab");
  assert.deepEqual(startingStages("roadmap_item").map((s) => s.key), ["backlog", "planned", "in_progress", "testing", "launched"], "never on the board: any stage but Won't do");
});

test("startingStages and the default: a bug starts at New, Confirmed or Fixing; from Tasks at Fixing, from Bugs at New", () => {
  assert.deepEqual(startingStages("bug").map((s) => s.key), ["new", "confirmed", "fixing"]);
  assert.deepEqual(startingStages("request").map((s) => s.key), ["new", "accepted"]);
  assert.deepEqual(startingStages("content").map((s) => s.key), ["idea", "drafting"]);
  assert.deepEqual(startingStages("task"), []);
  assert.deepEqual([defaultStageFor("bug", "tasks"), defaultStageFor("bug", "own"), defaultStageFor("content", "tasks")], ["fixing", "new", "drafting"]);
});

test("footerLine: off the board, joining it, and a member's Backlog", () => {
  assert.equal(footerLine("bug", "new", true), "Shows in Bugs · not on the Tasks board yet");
  assert.equal(footerLine("bug", "fixing", true), "Joins Tasks at Fixing · also shows in Bugs");
  assert.equal(footerLine("bug", "fixing", false), "Joins Tasks at Fixing · also shows in Bugs · Goes to the Backlog");
  assert.equal(footerLine("task", null, true), null);
});

test("sectionsFor and sprintApplies: Need by, Publish date; no sprint until the item is on the board", () => {
  assert.deepEqual([sectionsFor("request").dueLabel, sectionsFor("content").dueLabel, sectionsFor("bug").dueLabel], ["Need by", "Publish date", "Due date"]);
  assert.deepEqual([sprintApplies("task", null), sprintApplies("bug", "new"), sprintApplies("bug", "fixing")], [true, false, true]);
});

test("typeFieldsSchema: types without fields yet accept nothing extra, naming the field", () => {
  assert.equal(typeFieldsSchema("bug").safeParse({}).success, true);
  const bad = typeFieldsSchema("bug").safeParse({ severity: "high" });
  assert.equal(bad.success, false);
  assert.match(JSON.stringify(bad.error?.issues), /severity/);
});

test("newMenuLine: a type that joins the board names its stage; a project names its own tab (A1.3 live crash)", () => {
  assert.equal(newMenuLine("bug"), "Joins Tasks at Fixing");
  assert.equal(newMenuLine("project"), "Shows in Projects");
});

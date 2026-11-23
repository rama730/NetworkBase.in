import assert from "node:assert/strict";
import { test } from "node:test";

// Report 38.9 T2 part 7 (plan A2.10): roadmap rules.
test("itemProgress: tasks and Built by projects (a project counts as its task count); nothing linked → null", async () => {
  const { itemProgress } = await import("../../src/lib/workflows/roadmap");
  const work = [{ status: "done" }, { status: "done" }, { status: "todo" }, { status: "in_progress" }];
  assert.equal(itemProgress(work, []), 50);
  assert.equal(itemProgress(work, [{ percent: 50, tasks: 4 }]), 50, "2 of 4 tasks + a 4-task project at 50 %");
  assert.equal(itemProgress([...work, { status: "done", stage: "cancelled" }], []), 50, "cancelled work is left out");
  assert.equal(itemProgress([], [{ percent: 100, tasks: 0 }]), 100, "an empty project counts as one");
  assert.equal(itemProgress([], []), null);
});

test("autoStage: Backlog or Planned + first work → In progress; Testing and Launched stay", async () => {
  const { autoStage } = await import("../../src/lib/workflows/roadmap");
  assert.equal(autoStage("planned", "work_started"), "in_progress");
  assert.equal(autoStage("backlog", "work_started"), "in_progress");
  assert.equal(autoStage("testing", "work_started"), null);
  assert.equal(autoStage("launched", "work_started"), null);
});

test("columns: Backlog becomes Planned when it gets a column; Launched and Won't do leave the board; milestones in order", async () => {
  const { stageAfterColumn, onColumnBoard, milestoneOrder, roadmapSummary } = await import("../../src/lib/workflows/roadmap");
  assert.equal(stageAfterColumn("backlog"), "planned");
  assert.equal(stageAfterColumn("in_progress"), null);
  assert.deepEqual(["launched", "wont_do", "testing"].map(onColumnBoard), [false, false, true]);
  assert.ok(milestoneOrder("Alpha") < milestoneOrder("Beta"));
  assert.equal(milestoneOrder("Other"), 6);
  assert.deepEqual(roadmapSummary([{ stage: "in_progress", typeFields: { column: "now" } }, { stage: "testing", typeFields: { column: "now" } }, { stage: "launched", typeFields: { column: "now" } }, { stage: "planned", typeFields: { column: "next" } }]),
    { now: 2, next: 1, testing: 1 });
});

test("roadmapFieldsSchema: outcome ≤ 200, known columns, types and milestone names only", async () => {
  const { roadmapFieldsSchema } = await import("../../src/lib/workflows/roadmap");
  assert.ok(roadmapFieldsSchema.safeParse({ outcome: "People sign in with SSO", column: "next", itemType: "milestone", milestone: "Alpha" }).success);
  assert.equal(roadmapFieldsSchema.safeParse({ outcome: "x".repeat(201) }).success, false);
  assert.equal(roadmapFieldsSchema.safeParse({ column: "soon" }).success, false);
  assert.equal(roadmapFieldsSchema.safeParse({ milestone: "Gold" }).success, false);
  assert.equal(roadmapFieldsSchema.safeParse({ stray: 1 }).success, false);
});

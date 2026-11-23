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

// Plan A2.11: Timeline spans and the Backlog's hand order.
test("timelineSpan: first work start to target; one end alone is one day; milestones are diamonds; nothing → No dates", async () => {
  const { timelineSpan } = await import("../../src/lib/workflows/roadmap");
  assert.deepEqual(timelineSpan({ workStart: "2026-11-02", dueDate: "2026-12-01", typeFields: {} }), { kind: "bar", start: "2026-11-02", end: "2026-12-01" });
  assert.deepEqual(timelineSpan({ workStart: null, dueDate: "2026-12-01", typeFields: {} }), { kind: "bar", start: "2026-12-01", end: "2026-12-01" });
  assert.deepEqual(timelineSpan({ workStart: "2026-12-05", dueDate: "2026-12-01", typeFields: {} }), { kind: "bar", start: "2026-12-01", end: "2026-12-01" }, "work starting after the target doesn't flip the bar");
  assert.deepEqual(timelineSpan({ workStart: "2026-11-02", dueDate: null, typeFields: {} }), { kind: "bar", start: "2026-11-02", end: "2026-11-02" });
  assert.deepEqual(timelineSpan({ workStart: null, dueDate: "2026-12-10", typeFields: { itemType: "milestone" } }), { kind: "diamond", date: "2026-12-10" });
  assert.equal(timelineSpan({ workStart: null, dueDate: null, typeFields: {} }), null);
});

test("backlogOrder and positionBetween: placed items by position, then newest first; a move lands between neighbours", async () => {
  const { backlogOrder, positionBetween } = await import("../../src/lib/workflows/roadmap");
  const i = (id: string, createdAt: string, backlogPosition?: number) => ({ id, createdAt, typeFields: backlogPosition === undefined ? {} : { backlogPosition } });
  assert.deepEqual(backlogOrder([i("a", "2026-11-01"), i("b", "2026-11-03"), i("c", "2026-11-02", 2000), i("d", "2026-11-04", 1000)]).map((x) => x.id), ["d", "c", "b", "a"]);
  assert.equal(positionBetween(1000, 2000), 1500);
  assert.equal(positionBetween(null, 1000), 0);
  assert.equal(positionBetween(2000, null), 3000);
  assert.equal(positionBetween(null, null), 1000);
});

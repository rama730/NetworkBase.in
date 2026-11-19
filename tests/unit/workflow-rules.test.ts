import assert from "node:assert/strict";
import { test } from "node:test";

import { boardMove, canChangeWorkflows, defaultStageFor, effectiveWorkflows, isOnBoard, removalSummary, stageMove, statusForStage } from "../../src/lib/workflows/rules";
import { WORKFLOW_CATALOG, WORKFLOW_GROUPS } from "../../src/lib/workflows/catalog";
import { stagesOf, workflowType } from "../../src/lib/workflows/types";

// Report 38.2 F1 part 7: every case listed there.
test("statusForStage follows the F1 stage table", () => {
  assert.equal(statusForStage("bug", "new"), "todo");
  assert.equal(statusForStage("bug", "fixing"), "in_progress");
  assert.equal(statusForStage("bug", "verified"), "done");
  assert.equal(statusForStage("bug", "wont_fix"), "done");
  assert.equal(statusForStage("request", "in_review"), "in_progress");
  assert.equal(statusForStage("request", "accepted"), "todo");
  assert.equal(statusForStage("content", "scheduled"), "done");
  assert.throws(() => statusForStage("bug", "nope"), /Unknown stage/);
  assert.throws(() => statusForStage("nope", "new"), /Unknown type/);
});

test("isOnBoard", () => {
  assert.equal(isOnBoard("bug", "confirmed"), false);
  assert.equal(isOnBoard("bug", "fixing"), true);
  assert.equal(isOnBoard("bug", "wont_fix"), false);
  assert.equal(isOnBoard("task", null), true);
  assert.equal(isOnBoard("request", "new"), false);
  assert.equal(isOnBoard("request", "accepted"), true);
  assert.equal(isOnBoard("request", "declined"), false);
  assert.equal(isOnBoard("content", "idea"), false);
  assert.equal(isOnBoard("content", "published"), true);
});

test("stageMove names joins and leaves", () => {
  assert.deepEqual(stageMove("bug", "confirmed", "fixing"), { joins: true, leaves: false, needsSprintChoice: true });
  assert.deepEqual(stageMove("bug", "fixing", "confirmed"), { joins: false, leaves: true, needsSprintChoice: false });
  assert.deepEqual(stageMove("bug", "fixing", "fixed"), { joins: false, leaves: false, needsSprintChoice: false });
  assert.deepEqual(stageMove("bug", "new", "confirmed"), { joins: false, leaves: false, needsSprintChoice: false });
});

test("boardMove changes the stage only at the edges (call 5, B2, B3)", () => {
  assert.deepEqual(boardMove("bug", "fixing", "blocked", false), { stage: "fixing", status: "blocked", review: false });
  assert.deepEqual(boardMove("bug", "fixing", "done", false), { stage: "fixed", status: "done", review: false });
  assert.deepEqual(boardMove("bug", "fixing", "done", true), { stage: "fixing", status: "done", review: true });
  assert.deepEqual(boardMove("bug", "fixed", "in_progress", false), { stage: "fixing", status: "in_progress", review: false });
  assert.deepEqual(boardMove("bug", "fixing", "todo", false), { stage: "fixing", status: "todo", review: false });
  assert.deepEqual(boardMove("content", "drafting", "done", false), { stage: "scheduled", status: "done", review: false });
  assert.deepEqual(boardMove("request", "delivered", "todo", false), { stage: "accepted", status: "todo", review: false });
  assert.deepEqual(boardMove("task", null, "done", true), { stage: null, status: "done", review: true });
});

test("boardMove from an off-board stage (a status change from the panel, bulk, undo or GitHub) lands on a real stage", () => {
  assert.deepEqual(boardMove("bug", "new", "in_progress", false), { stage: "fixing", status: "in_progress", review: false });
  assert.deepEqual(boardMove("bug", "confirmed", "blocked", false), { stage: "fixing", status: "blocked", review: false });
  assert.deepEqual(boardMove("bug", "new", "done", false), { stage: "fixed", status: "done", review: false });
  assert.deepEqual(boardMove("bug", "new", "done", true), { stage: "fixing", status: "done", review: true });
  assert.deepEqual(boardMove("bug", "new", "todo", false), { stage: "new", status: "todo", review: false });
  assert.deepEqual(boardMove("bug", "wont_fix", "in_progress", false), { stage: "fixing", status: "in_progress", review: false });
  assert.deepEqual(boardMove("request", "new", "todo", false), { stage: "accepted", status: "todo", review: false });
  assert.deepEqual(boardMove("request", "new", "in_progress", false), { stage: "in_progress", status: "in_progress", review: false });
  assert.deepEqual(boardMove("content", "idea", "in_progress", false), { stage: "drafting", status: "in_progress", review: false });
  assert.deepEqual(boardMove("content", "idea", "todo", false), { stage: "idea", status: "todo", review: false });
});

test("defaultStageFor: Tasks opens at the join stage, the own tab at the first", () => {
  assert.equal(defaultStageFor("bug", "tasks"), "fixing");
  assert.equal(defaultStageFor("bug", "own"), "new");
  assert.equal(defaultStageFor("request", "tasks"), "accepted");
  assert.equal(defaultStageFor("content", "own"), "idea");
  assert.equal(defaultStageFor("task", "tasks"), null);
});

test("the registry matches the F1 stage table", () => {
  assert.deepEqual(stagesOf("bug").map((s) => s.key), ["new", "confirmed", "fixing", "fixed", "verified", "wont_fix", "duplicate", "cant_reproduce"]);
  assert.deepEqual(stagesOf("request").map((s) => s.label), ["New", "Accepted", "In progress", "In review", "Delivered", "Declined"]);
  assert.deepEqual(stagesOf("content").map((s) => s.label), ["Idea", "Drafting", "Editing", "Scheduled", "Published"]);
  assert.equal(workflowType("bug").icon, "Bug");
  assert.equal(stagesOf("task").length, 0);
});

const row = (workflow: string, extra: Partial<{ hiddenAt: Date | null; pushToChildren: boolean; addedAt: Date }> = {}) => ({ workflow, hiddenAt: null, pushToChildren: false, addedAt: new Date("2026-11-19T10:00:00Z"), ...extra });

test("effectiveWorkflows: own rows, a parent's pushes (locked), hidden rows (F1 part 7)", () => {
  assert.deepEqual(effectiveWorkflows([row("bugs")], [], "Northgate CS"), [{ workflow: "bugs", locked: false, by: null }]);
  assert.deepEqual(effectiveWorkflows([], [row("bugs", { pushToChildren: true })], "Northgate CS"), [{ workflow: "bugs", locked: true, by: "Northgate CS" }]);
  assert.deepEqual(effectiveWorkflows([row("bugs")], [row("bugs", { pushToChildren: true })], "Northgate CS"), [{ workflow: "bugs", locked: true, by: "Northgate CS" }]);
  assert.deepEqual(effectiveWorkflows([row("bugs", { hiddenAt: new Date() })], [row("bugs", { pushToChildren: true })], "Northgate CS"), [{ workflow: "bugs", locked: true, by: "Northgate CS" }]);
  assert.deepEqual(effectiveWorkflows([row("bugs")], [row("bugs")], "Northgate CS"), [{ workflow: "bugs", locked: false, by: null }], "an org's own row that isn't pushed doesn't reach children");
  assert.deepEqual(effectiveWorkflows([row("bugs", { hiddenAt: new Date() })], [], null), []);
  assert.deepEqual(effectiveWorkflows([row("roadmap"), row("bugs")], [], null).map((w) => w.workflow), ["bugs", "roadmap"], "catalog order");
});

test("canChangeWorkflows: owners, admins and inherited org admins only", () => {
  const base = { isOwner: false, memberRole: null as string | null, isInheritedAdmin: false };
  assert.equal(canChangeWorkflows({ ...base, isOwner: true }), true);
  assert.equal(canChangeWorkflows({ ...base, memberRole: "admin" }), true);
  assert.equal(canChangeWorkflows({ ...base, isInheritedAdmin: true }), true);
  assert.equal(canChangeWorkflows({ ...base, memberRole: "member" }), false);
  assert.equal(canChangeWorkflows({ ...base, memberRole: "viewer" }), false);
  assert.equal(canChangeWorkflows(base), false);
});

test("removalSummary counts items, open ones and ones on the board", () => {
  const items = [
    { status: "todo", onBoard: false }, { status: "in_progress", onBoard: true }, { status: "done", onBoard: true },
    { status: "done", onBoard: false }, { status: "blocked", onBoard: true },
  ];
  assert.deepEqual(removalSummary(items), { total: 5, open: 3, onBoard: 3 });
  assert.deepEqual(removalSummary([]), { total: 0, open: 0, onBoard: 0 });
});

test("the catalog: unique ids, known groups, own tabs only in Own tab, nothing built before its round", () => {
  const ids = WORKFLOW_CATALOG.map((w) => w.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const w of WORKFLOW_CATALOG) {
    assert.ok(WORKFLOW_GROUPS.some((g) => g.id === w.group));
    assert.equal(Boolean(w.tab), w.group === "own_tab", w.id);
    assert.ok(w.line.endsWith("."), w.id);
  }
  assert.deepEqual(WORKFLOW_CATALOG.filter((w) => w.built).map((w) => w.id), []);
});

test("wizard suggestions: section 6 in order, built ones only, the first ticked (decision 5)", async () => {
  const { suggestedWorkflows, catalogEntry } = await import("../../src/lib/workflows/catalog");
  assert.deepEqual(suggestedWorkflows("web_app"), [], "nothing is built yet");
  const bugs = catalogEntry("bugs")!, planner = catalogEntry("project_planner")!, roadmap = catalogEntry("roadmap")!;
  bugs.built = planner.built = roadmap.built = true;
  try {
    assert.deepEqual(suggestedWorkflows("web_app"), [{ workflow: "bugs", ticked: true }, { workflow: "roadmap", ticked: false }, { workflow: "project_planner", ticked: false }]);
    assert.deepEqual(suggestedWorkflows("startup"), [{ workflow: "project_planner", ticked: true }, { workflow: "roadmap", ticked: false }]);
    assert.deepEqual(suggestedWorkflows("game"), [{ workflow: "project_planner", ticked: true }, { workflow: "roadmap", ticked: false }, { workflow: "bugs", ticked: false }]);
    assert.deepEqual(suggestedWorkflows("learning"), [], "Course planner is parked");
    assert.deepEqual(suggestedWorkflows("unknown"), []);
  } finally {
    bugs.built = planner.built = roadmap.built = false;
  }
});

test("boardMove: a project (no join stage) keeps a fitting stage, else takes the status's first stage", () => {
  assert.deepEqual(boardMove("project", "paused", "in_progress", false), { stage: "paused", status: "in_progress", review: false });
  assert.deepEqual(boardMove("project", "in_progress", "todo", false), { stage: "not_started", status: "todo", review: false });
  assert.deepEqual(boardMove("project", "completed", "in_progress", false), { stage: "planning", status: "in_progress", review: false });
  assert.deepEqual(boardMove("project", "planning", "done", false), { stage: "completed", status: "done", review: false });
  assert.deepEqual(boardMove("project", "planning", "done", true), { stage: "planning", status: "done", review: true });
  assert.deepEqual(boardMove("project", "planning", "blocked", false), { stage: "planning", status: "blocked", review: false });
});

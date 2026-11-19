import assert from "node:assert/strict";
import { test } from "node:test";

import { boardMove, defaultStageFor, isOnBoard, stageMove, statusForStage } from "../../src/lib/workflows/rules";
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

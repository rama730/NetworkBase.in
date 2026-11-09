import assert from "node:assert/strict";
import test from "node:test";
import { autoStartLine, dropOutcome, reviewDeadlock, stuckPart } from "../../src/lib/organizations/assignment-rules";

// Assignment flow (2026-11-10): people move their own copy, the main card follows, every drop is a real action.

test("decision 1: the first real work says what started it", () => {
  assert.equal(autoStartLine({ kind: "file", name: "stack.c" }), "Started when you added stack.c");
  assert.equal(autoStartLine({ kind: "step", name: "Write push" }), "Started when you ticked “Write push”");
  assert.equal(autoStartLine({ kind: "answer" }), "Started when you began the answer");
  assert.equal(autoStartLine({ kind: "file" }, false), "Started when someone added a file");
});

test("decision 2: a copy dropped on Completed opens Hand in; Blocked asks what's in the way; the rest just move", () => {
  const copy = { master: false, copy: true } as const;
  assert.deepEqual(dropOutcome({ ...copy, from: "in_progress", to: "done", state: "in_progress" }), { kind: "hand_in" });
  assert.deepEqual(dropOutcome({ ...copy, from: "todo", to: "done", state: "not_started" }), { kind: "hand_in" });
  assert.deepEqual(dropOutcome({ ...copy, from: "in_progress", to: "done", state: "returned" }), { kind: "hand_in" });
  assert.deepEqual(dropOutcome({ ...copy, from: "todo", to: "blocked", state: "not_started" }), { kind: "block" });
  assert.deepEqual(dropOutcome({ ...copy, from: "todo", to: "in_progress", state: "not_started" }), { kind: "move" });
  assert.deepEqual(dropOutcome({ ...copy, from: "blocked", to: "todo", state: "in_progress" }), { kind: "move" });
});

test("decision 3: handed-in, approved and excused copies are locked", () => {
  const copy = { master: false, copy: true, from: "done", to: "in_progress" } as const;
  assert.deepEqual(dropOutcome({ ...copy, state: "submitted", reviewer: "Ms. Rao" }), { kind: "refuse", message: "Waiting for Ms. Rao. It moves when it’s reviewed." });
  assert.deepEqual(dropOutcome({ ...copy, state: "done", approved: true }), { kind: "refuse", message: "Approved work is locked." });
  assert.equal(dropOutcome({ ...copy, state: "excused" }).kind, "refuse");
  // Done without review (no approval) may still move back while it's open.
  assert.deepEqual(dropOutcome({ ...copy, state: "done", approved: false }), { kind: "move" });
});

test("decision 4: the main card's drops are publish, close and reopen; nothing else", () => {
  const master = { master: true, copy: false } as const;
  assert.deepEqual(dropOutcome({ ...master, draft: true, from: "todo", to: "in_progress" }), { kind: "publish" });
  assert.equal(dropOutcome({ ...master, draft: true, from: "todo", to: "done" }).kind, "refuse");
  assert.deepEqual(dropOutcome({ ...master, from: "in_progress", to: "done" }), { kind: "close" });
  assert.deepEqual(dropOutcome({ ...master, from: "todo", to: "done" }), { kind: "close" });
  assert.deepEqual(dropOutcome({ ...master, closed: true, from: "done", to: "in_progress" }), { kind: "reopen" });
  assert.equal(dropOutcome({ ...master, closed: true, from: "done", to: "todo" }).kind, "refuse");
  assert.deepEqual(dropOutcome({ ...master, from: "in_progress", to: "todo" }), { kind: "refuse", message: "Published work can’t go back to To do. Close it instead." });
  assert.equal(dropOutcome({ ...master, from: "in_progress", to: "blocked" }).kind, "refuse");
  assert.deepEqual(dropOutcome({ ...master, allDone: true, from: "done", to: "in_progress" }), { kind: "refuse", message: "Everyone is approved. Return someone’s work to reopen it." });
});

test("decision 8: admins-only work with review on needs a second reviewer", () => {
  const admins = { mode: "role", role: "admin" } as const;
  assert.match(reviewDeadlock(admins, true, ["owner"]) ?? "", /Turn review off/);
  assert.match(reviewDeadlock(admins, true, ["owner", "member", "guest"]) ?? "", /Turn review off/);
  assert.equal(reviewDeadlock(admins, true, ["owner", "admin"]), null);
  assert.equal(reviewDeadlock(admins, false, ["owner"]), null);
  assert.equal(reviewDeadlock({ mode: "everyone" }, true, ["owner"]), null);
});

test("decision 6: stuck copies are named on the main card's line", () => {
  assert.equal(stuckPart(0), null);
  assert.equal(stuckPart(2), "2 stuck");
});

import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const source = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

test("decision 1: every way of adding work starts a copy, and only a copy still in To do", () => {
  const helper = source("src/lib/organizations/assignments.ts");
  assert.match(helper, /WHERE t\.id = \$\{taskId\}::uuid AND t\.assignment_id IS NOT NULL AND t\.status = 'todo' AND t\.review_status = 'none'\s+AND t\.excused_at IS NULL AND t\.deleted_at IS NULL/);
  assert.match(helper, /source: "auto_start"/);
  assert.match(source("src/app/actions/subtask.ts"), /if \(completed\) await startCopyOnWork\(tx, row\.taskId, user\.id, \{ kind: "step"/);
  assert.match(source("src/app/actions/files/mutations.ts"), /if \(file\.taskId\) await startCopyOnWork\(tx, file\.taskId, user\.id, \{ kind: "file"/);
  assert.match(source("src/app/actions/files/links.ts"), /if \(file\?\.type === "file"\) await startCopyOnWork\(tx, taskId/);
  assert.match(source("src/app/api/v1/extension/fast-push/route.ts"), /await startCopyOnWork\(tx, taskId, user\.id, \{ kind: "file"/);
  assert.match(source("src/app/api/v1/extension/task-push/route.ts"), /await startCopyOnWork\(tx, taskId, user\.id, \{ kind: "file"/);
  // The answer: its first words start it; the draft stays in the browser and never hands in.
  const handIn = source("src/components/organizations/HandInSection.tsx");
  assert.match(handIn, /h\.state === 'not_started' && \(next\.link \?\? next\.text \?\? ''\)\.trim\(\)/);
  assert.match(handIn, /void startCopyAction\(copyId\)/);
  assert.doesNotMatch(handIn, /typed\([^)]*\)[^\n]*submitAssignmentAction/);
});

test("decision 3: ticking every step only says so; Hand in is still a press", () => {
  assert.match(source("src/components/organizations/HandInSection.tsx"), /h\.steps\.length && !openSteps \? <span[^>]*>All steps done<\/span>/);
});

test("decision 7: whoever holds a copy moves it, in the action and in the shared transition", () => {
  assert.match(source("src/app/actions/task.ts"), /!locked\.isLeader && !locked\.isHolder && locked\.previousAssigneeId/);
  assert.match(source("src/lib/workspaces/task-transition-service.ts"), /!locked\.isTeamMember &&\s*\/\/[^\n]*\n\s*!locked\.isHolder &&/);
});

test("decision 6: the Blocked note is kept on the move, reaches admins as a message, and in Needs you", () => {
  assert.match(source("src/lib/workspaces/task-transition-service.ts"), /\.\.\.\(input\.note && status === "blocked" && \{ note: input\.note \}\)/);
  assert.match(source("src/components/workspaces/v2/tasks/KanbanBoard.tsx"), /createTaskCommentAction\(draggedTask\.id, projectId, `Stuck: \$\{options\.note\}`\)/);
  assert.match(source("src/lib/organizations/needs-you.ts"), /kind: 'stuck'/);
});

test("decision 8: create, publish now and scheduled publish all refuse an admins-only assignment nobody could review", () => {
  const actions = source("src/app/actions/assignments.ts");
  assert.match(actions, /reviewDeadlock\(data\.target, [^\n]*reviewerRolesOf\(db, data\.projectId\)\)/, "create");
  assert.match(actions, /if \(error instanceof NoReviewerError\) return \{ success: false, error: error\.message, noReviewer: true \}/, "publish now");
  // Publish now and the hourly job both go through publishMaster, which checks inside its transaction; the job's
  // failure path puts it back to a draft and tells the person why.
  const publish = source("src/lib/organizations/assignment-publish.ts");
  assert.match(publish, /const reviewRequired = options\.reviewOff \? false : master\.settings\.reviewRequired;\s*await assertSomeoneReviews\(tx, master\.projectId, \{ target: master\.settings\.target, reviewRequired \}\);/);
  assert.match(publish, /publishMaster\(row\.id, row\.actor, \{ dropMissing: true \}\)[\s\S]*wasn’t published: \$\{reason\}/);
  assert.match(source("src/components/workspaces/v2/tasks/AssignmentDropSheets.tsx"), /Turn review off and publish/);
  assert.match(source("src/components/organizations/AssignmentsPanel.tsx"), /Turn review off and publish/);
});

test("decision 5: lanes decide by drop; returned work can't be dragged back", async () => {
  const { laneDrop } = await import("../../src/components/organizations/ReviewLanes");
  assert.equal(laneDrop("review", "approved"), "approve");
  assert.equal(laneDrop("review", "returned"), "return");
  assert.equal(laneDrop("approved", "returned"), "reopen_return");
  assert.deepEqual(laneDrop("approved", "review"), { refuse: "Approved work goes back only through Return." });
  assert.deepEqual(laneDrop("returned", "approved"), { refuse: "Returned work comes back here when they hand it in again." });
  assert.equal(laneDrop("review", "review"), null);
});

test("decision 6: the main card's line and bar name the stuck copies", async () => {
  const { cardLine } = await import("../../src/components/workspaces/tabs/sprint/AssignmentStages");
  const counts = { not_started: 1, in_progress: 3, submitted: 2, returned: 1, done: 4, missing: 1, excused: 0 };
  assert.equal(cardLine({ counts, total: 12, reviewRequired: true, teams: false, stuck: 2 } as never).text, "4 of 12 approved · 2 in review · 1 returned · 2 stuck · 1 missing");
});

test("cards: a locked copy shows its lock, a stuck copy says what's in the way", async () => {
  const { TaskCard } = await import("../../src/components/workspaces/v2/tasks/TaskCard");
  const base = { id: "c", title: "Lab 2", status: "in_progress", reviewStatus: "none", priority: "medium", assignmentId: "m", fromLabel: "Ms. Rao", projectKey: "C3D", taskNumber: 12 };
  const stage = (state: string, extra = {}) => ({ state, late: false, since: null, reason: null, fixBy: null, version: 1, reviewRequired: true, handIn: null, ...extra });
  const render = (task: Record<string, unknown>) => renderToStaticMarkup(React.createElement(TaskCard, { task, showStatus: false }));
  assert.match(render({ ...base, status: "done", reviewStatus: "pending", copyStage: stage("submitted") }), /aria-label="Waiting for review"/);
  assert.match(render({ ...base, status: "done", copyStage: stage("done") }), /aria-label="Approved work is locked"/);
  assert.doesNotMatch(render({ ...base, copyStage: stage("in_progress") }), /Waiting for review|Approved work is locked/);
  const stuck = render({ ...base, status: "blocked", copyStage: stage("in_progress", { stuck: true }), stuckNote: "the starter file won’t compile" });
  assert.match(stuck, />Stuck: the starter file won’t compile</);
  assert.match(stuck, />Blocked</);
  // The why-it-moved line waits for the browser (it's per viewer), so the server never renders it.
  assert.doesNotMatch(render({ ...base, copyStage: stage("in_progress"), lastMove: { text: "Started when you added stack.c", at: "2026-11-10T10:00:00.000Z" } }), /data-why-moved/);
});

test("a closed assignment's card says when it closed", async () => {
  const { TaskCard } = await import("../../src/components/workspaces/v2/tasks/TaskCard");
  const counts = { not_started: 0, in_progress: 0, submitted: 0, returned: 0, done: 26, missing: 6, excused: 0 };
  const html = renderToStaticMarkup(React.createElement(TaskCard, { showStatus: false, task: {
    id: "m", title: "Quiz prep: hashing", kind: "assignment", status: "done", priority: "medium", projectKey: "C3D", taskNumber: 11, audience: { mode: "everyone", count: 32 },
    assignmentProgress: { draft: false, closed: true, closedAt: "2026-11-08T12:00:00.000Z", done: 26, total: 32, toReview: 0, excused: 0 },
    assignmentStages: { counts, names: {}, total: 32, reviewRequired: true, teams: false, remind: { not_started: [], missing: [] }, stuck: 0 } } }));
  assert.match(html, />Closed Nov 8 · 26 of 32 approved · 6 missing</);
});

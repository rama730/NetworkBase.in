import assert from "node:assert/strict";
import { test } from "node:test";

import { copyState, splitIntoTeams } from "../../src/lib/organizations/assignment-rules";

// Report §16.3: Missing and Late are derived from the due date and submission time, never stored.
const now = new Date("2026-11-10T12:00:00Z");
const due = new Date("2026-11-09T18:29:00Z");
const base = { status: "todo", reviewStatus: "none", dueDate: due, submittedAt: null, completedAt: null, excusedAt: null };

test("states before and after the due date", () => {
  assert.deepEqual(copyState({ ...base, dueDate: new Date("2026-11-12T00:00:00Z") }, now), { state: "not_started", late: false });
  assert.deepEqual(copyState({ ...base, status: "in_progress", dueDate: new Date("2026-11-12T00:00:00Z") }, now), { state: "in_progress", late: false });
  assert.deepEqual(copyState(base, now), { state: "missing", late: false });
  assert.deepEqual(copyState({ ...base, excusedAt: now }, now), { state: "excused", late: false });
});

test("a submission after the due date is Late; review decides Submitted vs Done", () => {
  const lateSubmit = { ...base, status: "done", reviewStatus: "pending", submittedAt: new Date("2026-11-10T08:00:00Z") };
  assert.deepEqual(copyState(lateSubmit, now), { state: "submitted", late: true });
  const onTimeDone = { ...base, status: "done", completedAt: new Date("2026-11-09T10:00:00Z") };
  assert.deepEqual(copyState(onTimeDone, now), { state: "done", late: false });
  const returned = { ...base, status: "in_progress", reviewStatus: "rejected", dueDate: new Date("2026-11-12T00:00:00Z") };
  assert.deepEqual(copyState(returned, now), { state: "returned", late: false });
});

test("problem 2: Late is measured from when it was handed in, not when it was approved", () => {
  const handedInOnTime = { ...base, status: "done", submittedAt: new Date("2026-11-09T10:00:00Z"), completedAt: new Date("2026-11-10T09:00:00Z") };
  assert.deepEqual(copyState(handedInOnTime, now), { state: "done", late: false }, "approved after the due date, handed in before it");
  const handedInLate = { ...base, status: "done", submittedAt: new Date("2026-11-10T08:00:00Z"), completedAt: new Date("2026-11-10T09:00:00Z") };
  assert.deepEqual(copyState(handedInLate, now), { state: "done", late: true });
});

test("decision 86: Returned work keeps showing Returned after its due date", () => {
  const returned = { ...base, status: "in_progress", reviewStatus: "rejected", submittedAt: new Date("2026-11-09T10:00:00Z") };
  assert.deepEqual(copyState(returned, now), { state: "returned", late: false });
});

test("auto-make teams: sizes stay within one of each other and everyone is placed once", () => {
  const people = Array.from({ length: 10 }, (_, i) => `p${i}`);
  const teams = splitIntoTeams(people, 3, () => 0.5);
  assert.deepEqual(teams.map((t) => t.length).sort(), [3, 3, 4]);
  assert.deepEqual(teams.flat().sort(), [...people].sort());
  assert.deepEqual(splitIntoTeams(["a", "b"], 5, () => 0.5), [["a", "b"]]);
});

test("report §19.3 and §42.12: one rule for every write to assignment work", async () => {
  const { assignmentWriteBlock } = await import("../../src/lib/organizations/assignment-rules");
  const master = { isMaster: true, isCopy: false, handedIn: false, approved: false, groupCopy: false, orgTitle: "CSE 3B", actorIsOrgAdmin: false };
  const copy = { ...master, isMaster: false, isCopy: true };
  const task = { ...master, isMaster: false };
  // Ordinary tasks: nothing changes.
  assert.equal(assignmentWriteBlock(task, "title"), null);
  // Main assignment (problems 23, 34, 22).
  assert.equal(assignmentWriteBlock(master, "title"), "Only CSE 3B’s admins change an assignment.");
  assert.equal(assignmentWriteBlock({ ...master, actorIsOrgAdmin: true }, "title"), null);
  assert.equal(assignmentWriteBlock({ ...master, actorIsOrgAdmin: true }, "status"), "An assignment’s state comes from its copies.");
  assert.equal(assignmentWriteBlock({ ...master, actorIsOrgAdmin: true, handedIn: true }, "delete"), "Someone has handed this in, so it can’t be deleted. Close it instead.");
  assert.equal(assignmentWriteBlock({ ...master, actorIsOrgAdmin: true }, "delete"), null);
  // A copy (19.3, problems 20, 32, decision 85).
  assert.equal(assignmentWriteBlock(copy, "title"), "Set by CSE 3B");
  assert.equal(assignmentWriteBlock(copy, "dueDate"), "Set by CSE 3B. Ask for an extension.");
  assert.equal(assignmentWriteBlock(copy, "priority"), null);
  assert.equal(assignmentWriteBlock(copy, "done"), "Use Submit to hand this in.");
  assert.equal(assignmentWriteBlock(copy, "status"), null);
  assert.equal(assignmentWriteBlock({ ...copy, approved: true }, "status"), "This was approved, so it’s locked.");
  assert.equal(assignmentWriteBlock(copy, "delete"), "Only CSE 3B’s admins can remove this.");
  assert.equal(assignmentWriteBlock({ ...copy, actorIsOrgAdmin: true, handedIn: true }, "delete"), "This was handed in, so it stays.");
  assert.equal(assignmentWriteBlock({ ...copy, actorIsOrgAdmin: true }, "delete"), null);
  assert.equal(assignmentWriteBlock(copy, "sprintId"), "This moves with its assignment.");
  assert.equal(assignmentWriteBlock({ ...copy, groupCopy: true }, "sprintId"), null, "a team plans its own group work");
});

test("decision 133: every assignment link opens Tasks, with the exact copy's panel in its own workspace", async () => {
  const { assignmentHref } = await import("../../src/lib/organizations/assignment-rules");
  assert.equal(assignmentHref("/org/cse-3b"), "/org/cse-3b?tab=tasks");
  assert.equal(assignmentHref("/workspaces/w1", "c1"), "/workspaces/w1?tab=tasks&drawerType=task&drawerId=c1");
  assert.equal(assignmentHref("/org/cse-3b", null, true), "/org/cse-3b?tab=tasks&taskScope=review");
});

test("problem 13 and smaller bug 16: 'Allowed until a date' needs a date, after the due date", async () => {
  const { lateRuleBlock } = await import("../../src/lib/organizations/assignment-rules");
  const due = new Date("2026-11-20T18:00:00Z");
  assert.equal(lateRuleBlock({ lateRule: "until", lateUntil: null }, due), "Pick the last day late work is accepted.");
  assert.equal(lateRuleBlock({ lateRule: "until", lateUntil: "2026-11-19T00:00:00Z" }, due), "Late work must be accepted until after the due date.");
  assert.equal(lateRuleBlock({ lateRule: "until", lateUntil: "2026-11-27T18:00:00Z" }, due), null);
  assert.equal(lateRuleBlock({ lateRule: "always", lateUntil: null }, due), null);
});

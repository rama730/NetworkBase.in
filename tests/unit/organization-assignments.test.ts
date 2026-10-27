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

test("auto-make teams: sizes stay within one of each other and everyone is placed once", () => {
  const people = Array.from({ length: 10 }, (_, i) => `p${i}`);
  const teams = splitIntoTeams(people, 3, () => 0.5);
  assert.deepEqual(teams.map((t) => t.length).sort(), [3, 3, 4]);
  assert.deepEqual(teams.flat().sort(), [...people].sort());
  assert.deepEqual(splitIntoTeams(["a", "b"], 5, () => 0.5), [["a", "b"]]);
});

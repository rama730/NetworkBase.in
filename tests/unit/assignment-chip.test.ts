import assert from "node:assert/strict";
import { test } from "node:test";

import { assignmentChip } from "../../src/lib/organizations/assignment-chip";

// Sprint work list redesign (2026-11-09): a main assignment has one chip, the same on the board and in a sprint.

const stages = (done: number, total: number, submitted = 0, reviewRequired = true) =>
  ({ total, reviewRequired, teams: false, counts: { not_started: 0, in_progress: total - done - submitted, submitted, returned: 0, done, missing: 0, excused: 0 } }) as never;

test("draft and scheduled come first, then work to review, then closed", () => {
  assert.deepEqual(assignmentChip({ draft: true }, null), { label: "Draft", tone: "muted" });
  assert.deepEqual(assignmentChip({ draft: true, scheduled: true }, null), { label: "Scheduled", tone: "accent" });
  assert.deepEqual(assignmentChip({ toReview: 3, closed: true }, stages(1, 5, 3)), { label: "3 to review", tone: "warning" });
  assert.deepEqual(assignmentChip({ closed: true }, stages(1, 5)), { label: "Closed", tone: "muted" });
});

test("a sprint always shows one; the board leaves out the quiet ones its line already says", () => {
  assert.deepEqual(assignmentChip({}, stages(5, 5)), { label: "All approved", tone: "success" });
  assert.deepEqual(assignmentChip({}, stages(2, 2, 0, false)), { label: "All done", tone: "success" });
  assert.deepEqual(assignmentChip({}, stages(1, 5)), { label: "Open", tone: "info" });
  assert.deepEqual(assignmentChip({}, stages(0, 0)), { label: "Nobody yet", tone: "muted" });
  assert.equal(assignmentChip({}, stages(1, 5), { quiet: true }), null);
  assert.equal(assignmentChip({}, stages(5, 5), { quiet: true }), null);
});

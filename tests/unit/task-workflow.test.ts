import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  TASK_PRIORITY_VALUES,
  TASK_WORKFLOW_STATUSES,
  getTaskPriorityPresentation,
  getTaskStatusPresentation,
} from "@/lib/workspaces/task-workflow";

describe("task workflow config", () => {

  it("returns canonical status labels and tones", () => {
    const blocked = getTaskStatusPresentation("blocked");
    assert.equal(blocked.label, "Blocked");
    assert.match(blocked.badgeClassName, /text-destructive/);
    assert.equal(blocked.accentClassName, "rose");
  });

  it("returns canonical priority labels and tones", () => {
    assert.deepEqual(TASK_PRIORITY_VALUES, ["low", "medium", "high", "urgent"]);
    assert.equal(getTaskPriorityPresentation("urgent").label, "Urgent");
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildTaskSubmitPayload,
  taskEditorDraftSchema,
} from "@/lib/workspaces/task-draft";

const projectId = "123e4567-e89b-42d3-a456-426614174000";

describe("task editor draft", () => {

  it("accepts blocked status and strips unsupported fields", () => {
    const parsed = taskEditorDraftSchema.parse({
      title: "Fix task panel",
      status: "blocked",
      priority: "urgent",
      type: "bug",
      tags: ["ui"],
    });

    assert.equal(parsed.status, "blocked");
    assert.equal(parsed.priority, "urgent");
    assert.equal("type" in parsed, false);
    assert.equal("tags" in parsed, false);
  });

  it("accepts the modal's null values for optional relationships and dates", () => {
    const parsed = taskEditorDraftSchema.parse({
      title: "Create from the task tab",
      sprintId: null,
      assigneeId: null,
      dueDate: null,
    });

    assert.equal(parsed.sprintId, null);
    assert.equal(parsed.assigneeId, null);
    assert.equal(parsed.dueDate, null);
  });

  it("builds a submit payload with only supported task fields", () => {
    const payload = buildTaskSubmitPayload({
      projectId,
      draft: {
        title: "Ship task refactor",
        description: "Tighten task surface",
        sprintId: null,
        status: "blocked",
        priority: "high",
        assigneeId: null,
        dueDate: null,
        storyPoints: 5,
      },
      subtasks: [{ id: "subtask-1", title: "Verify cache patches" }],
      attachments: [{ id: "node-1" } as any],
    });

    assert.deepEqual(payload, {
      projectId,
      title: "Ship task refactor",
      description: "Tighten task surface",
      sprintId: null,
      status: "blocked",
      priority: "high",
      assigneeId: null,
      dueDate: null,
      storyPoints: 5,
      attachmentNodeIds: ["node-1"],
      subtasks: [{ title: "Verify cache patches", completed: false }],
    });
    assert.equal("type" in payload, false);
    assert.equal("tags" in payload, false);
  });

  it("parses and validates story points from string and number", () => {
    assert.equal(taskEditorDraftSchema.parse({ title: "Task A", storyPoints: "8" }).storyPoints, 8);
    assert.equal(taskEditorDraftSchema.parse({ title: "Task B", storyPoints: 13 }).storyPoints, 13);
    assert.equal(taskEditorDraftSchema.parse({ title: "Task C", storyPoints: "" }).storyPoints, null);
    assert.equal(taskEditorDraftSchema.parse({ title: "Task D", storyPoints: null }).storyPoints, null);
  });
});

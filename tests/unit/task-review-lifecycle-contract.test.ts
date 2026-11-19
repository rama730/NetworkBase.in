import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const source = fs.readFileSync(
  path.join(process.cwd(), "src/app/actions/task.ts"),
  "utf8",
);

function actionBody(name: string, nextName: string) {
  const start = source.indexOf(`export async function ${name}`);
  const end = source.indexOf(`export async function ${nextName}`, start + 1);
  assert.notEqual(start, -1, `${name} must exist`);
  return source.slice(start, end === -1 ? undefined : end);
}

// COR-027: both the status control and a drag run the one shared transition.
const service = fs.readFileSync(path.join(process.cwd(), "src/lib/workspaces/task-transition-service.ts"), "utf8");
const transition = service.slice(service.indexOf("async function transitionTaskTx"), service.indexOf("async function afterTaskTransition"));

test("done transitions respect project review policy without publishing task files", () => {
  const updateStatus = actionBody(
    "updateTaskStatusAction",
    "moveTaskToWorkflowColumnAction",
  );
  const moveColumn = actionBody(
    "moveTaskToWorkflowColumnAction",
    "assignTaskAction",
  );

  assert.match(transition, /locked\.reviewRequired/);
  assert.match(transition, /taskReviewSnapshot/);
  assert.match(transition, /completionSource: "direct"/);
  assert.match(updateStatus, /transitionTaskTx\(tx, locked/);
  assert.match(moveColumn, /transitionTaskTx\(tx, locked/);
  assert.match(updateStatus, /afterTaskTransition\(/);
  assert.match(moveColumn, /afterTaskTransition\(/);
  assert.doesNotMatch(source, /promoteTaskFiles/);
});

test("approval clears review state and stamps deliverable versions without changing file ownership", () => {
  const approve = actionBody("approveTaskReviewAction", "");
  assert.match(approve, /locked\.reviewStatus !== "pending"/);
  assert.match(approve, /reviewStatus: "none"/);
  assert.doesNotMatch(approve, /promoteTaskFiles|tx\.update\(workspaceNodes\)|tx\.delete\(/);
  assert.match(approve, /inferTaskFileRole\(file\) === "deliverable"/);
  assert.match(approve, /markTaskFileVersionApproved\(file\.tags, file\.currentVersion, file\.revisedAt\)/);
  assert.doesNotMatch(approve, /for \(const file of linkedFiles\)/);
  assert.doesNotMatch(source, /function promoteTaskFiles/);
});

test("moves between custom sections in the same status remain auditable", () => {
  const moveColumn = actionBody(
    "moveTaskToWorkflowColumnAction",
    "assignTaskAction",
  );
  assert.match(moveColumn, /columnId: workflowColumnId/);
  assert.match(transition, /locked\.currentWorkflowColumnId !== \(column\?\.id \?\? null\)/);
  assert.match(transition, /"workflow_column_changed"/);
});

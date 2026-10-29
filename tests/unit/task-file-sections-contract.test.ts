import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { projectActionsSource } from "./_project-actions-source";

const read = (path: string) => readFileSync(path, "utf8");

test("task creation persists selected files as reference links", () => {
  const source = projectActionsSource();

  assert.match(source, /annotation: "#initial_reference"/);
  assert.match(source, /tags: replaceTaskFileRoleTag\(\[\], "reference"\)/);
});

test("task files render reference, deliverable, and working sections without duplicating roles", () => {
  const explorer = read("src/components/projects/v2/tasks/components/TaskFilesExplorer.tsx");
  const referencePosition = explorer.indexOf("Task references");
  const deliverablePosition = explorer.indexOf("Final deliverables");
  const workingPosition = explorer.lastIndexOf("TASK_WORKING_FILES_TITLE");

  assert.ok(referencePosition >= 0 && referencePosition < deliverablePosition);
  assert.ok(deliverablePosition < workingPosition);
  assert.match(explorer, /inferTaskFileRole\(n\) === "reference"/);
  assert.match(explorer, /inferTaskFileRole\(n\) === "working"/);
  assert.match(explorer, /fileRole=\{role\}/);
});

test("task file actions expose all safe role transitions", () => {
  const row = read("src/components/projects/v2/tasks/components/TaskFileRow.tsx");
  const upload = read("src/components/projects/v2/tasks/components/TaskFileUploadModal.tsx");

  assert.match(row, /Mark as reference/);
  assert.match(row, /Mark as draft/);
  assert.match(row, /Mark as final/);
  assert.match(upload, /Task reference/);
  assert.match(upload, /UploadIntent = "reference" \| "working" \| "deliverable" \| "version"/);
});

test("the task detail surface refreshes after a role move", () => {
  const panel = read("src/components/projects/v2/tasks/TaskDetailPanel.tsx");

  assert.match(panel, /onFilesChanged=\{resource\.loadAttachments\}/);
});

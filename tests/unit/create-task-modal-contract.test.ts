import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const CREATE_TASK_MODAL_PATH = path.join(
  process.cwd(),
  "src/components/workspaces/v2/tasks/CreateTaskModal.tsx",
);

test("CreateTaskModal implements canonical SectionDividers matching Sprint tab standards", () => {
  const content = fs.readFileSync(CREATE_TASK_MODAL_PATH, "utf8");

  assert.match(content, /title="Basics"/);
  assert.match(content, /title="Sprint and assignee"/);
  assert.match(content, /title="Schedule"/);
  assert.match(content, /title="Subtasks and files"/);
});

test("CreateTaskModal enforces drafting-table control geometry and token compliance", () => {
  const content = fs.readFileSync(CREATE_TASK_MODAL_PATH, "utf8");

  // Control height 34px and radius 5px
  assert.match(content, /h-\[34px\]/);
  assert.match(content, /rounded-\[5px\]/);

  // Section 10 micro-buttons for points
  assert.match(content, /h-6 items-center rounded-\[3px\]/);

  // Zero rounded-full pills
  assert.doesNotMatch(content, /rounded-full/);

  // Zero raw zinc / indigo / blue tokens
  assert.doesNotMatch(content, /zinc-(?:50|100|200|300|400|500|600|700|800|900|950)/);
  assert.doesNotMatch(content, /indigo-(?:50|100|200|300|400|500|600|700|800|900|950)/);
  assert.doesNotMatch(content, /blue-(?:50|100|200|300|400|500|600|700|800|900)/);
});

test("CreateTaskModal supports story points estimation and subtask addition", () => {
  const content = fs.readFileSync(CREATE_TASK_MODAL_PATH, "utf8");

  // Estimate input and presets
  assert.match(content, /name="storyPoints"/);
  assert.match(content, /\[1, 2, 3, 5, 8, 13\]/);

  // Explicit + Add button for subtasks
  assert.match(content, /\+ Add/);
});

test("CreateTaskModal removes visual header caption and implements Due date quick setup", () => {
  const content = fs.readFileSync(CREATE_TASK_MODAL_PATH, "utf8");

  // Visual header caption is removed (accessible sr-only description retained)
  assert.doesNotMatch(content, /Capture task details and assign work without extra noise/);
  assert.match(content, /<DialogDescription className="sr-only">/);

  // Due date input is controlled
  assert.match(content, /id="task-due-date"/);
  assert.match(content, /value=\{dueDate\}/);

  // Quick set buttons for 1 week, 2 weeks, 4 weeks
  assert.match(content, /Quick dates:/);
  assert.match(content, /\{ label: "1 week", days: 7 \}/);
  assert.match(content, /\{ label: "2 weeks", days: 14 \}/);
  assert.match(content, /\{ label: "4 weeks", days: 28 \}/);

  // No due date unless one is chosen (a +7-day default put dates on every task).
  assert.match(content, /useState<string>\(""\)/);
  assert.doesNotMatch(content, /useState<string>\(\(\) =>\s*addDaysToDateString/);

  // Prevents word breaking and vertical text wrapping in presets
  assert.match(content, /shrink-0 whitespace-nowrap/);

  // Verifies complete removal of the "Create another" checkbox
  assert.doesNotMatch(content, /Create another/);
  assert.doesNotMatch(content, /createAnother/);
});

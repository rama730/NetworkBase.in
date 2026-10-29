import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const TASKS_COMPONENTS_DIR = path.join(
  process.cwd(),
  "src/components/projects/v2/tasks",
);
const TASKS_TAB_PATH = path.join(
  process.cwd(),
  "src/components/projects/v2/TasksTab.tsx",
);

function getAllFiles(dirPath: string, arrayOfFiles: string[] = []): string[] {
  const files = fs.readdirSync(dirPath);

  files.forEach((file) => {
    const fullPath = path.join(dirPath, file);
    if (fs.statSync(fullPath).isDirectory()) {
      getAllFiles(fullPath, arrayOfFiles);
    } else if (/\.(tsx|ts)$/.test(file)) {
      arrayOfFiles.push(fullPath);
    }
  });

  return arrayOfFiles;
}

test("zero rounded-full classes across TasksTab and all child task components", () => {
  const taskFiles = [TASKS_TAB_PATH, ...getAllFiles(TASKS_COMPONENTS_DIR)];

  for (const filePath of taskFiles) {
    const relativePath = path.relative(process.cwd(), filePath);
    const content = fs.readFileSync(filePath, "utf8");
    assert.doesNotMatch(
      content,
      /rounded-full/,
      `Found forbidden 'rounded-full' in ${relativePath}`,
    );
  }
});

test("zero raw zinc-* token leaks across TasksTab and all child task components", () => {
  const taskFiles = [TASKS_TAB_PATH, ...getAllFiles(TASKS_COMPONENTS_DIR)];

  for (const filePath of taskFiles) {
    const relativePath = path.relative(process.cwd(), filePath);
    const content = fs.readFileSync(filePath, "utf8");
    assert.doesNotMatch(
      content,
      /zinc-(?:50|100|200|300|400|500|600|700|800|900|950)/,
      `Found raw 'zinc-*' color token leak in ${relativePath}`,
    );
  }
});

test("zero raw indigo-* token leaks across TasksTab and all child task components", () => {
  const taskFiles = [TASKS_TAB_PATH, ...getAllFiles(TASKS_COMPONENTS_DIR)];

  for (const filePath of taskFiles) {
    const relativePath = path.relative(process.cwd(), filePath);
    const content = fs.readFileSync(filePath, "utf8");
    assert.doesNotMatch(
      content,
      /indigo-(?:50|100|200|300|400|500|600|700|800|900|950)/,
      `Found raw 'indigo-*' color token leak in ${relativePath}`,
    );
  }
});

test("zero raw blue-* token leaks across TasksTab and all child task components", () => {
  const taskFiles = [TASKS_TAB_PATH, ...getAllFiles(TASKS_COMPONENTS_DIR)];

  for (const filePath of taskFiles) {
    const relativePath = path.relative(process.cwd(), filePath);
    const content = fs.readFileSync(filePath, "utf8");
    assert.doesNotMatch(
      content,
      /blue-(?:50|100|200|300|400|500|600|700|800|900)/,
      `Found raw 'blue-*' color token leak in ${relativePath}`,
    );
  }
});

test("kanban motion conforms to Section 05 180ms easeOut contract without spring overshoot", () => {
  const kanbanContent = fs.readFileSync(
    path.join(TASKS_COMPONENTS_DIR, "KanbanBoard.tsx"),
    "utf8",
  );

  // Assert no spring overshoot easing
  assert.doesNotMatch(
    kanbanContent,
    /cubic-bezier\(0\.18,\s*0\.67,\s*0\.6,\s*1\.22\)/,
    "Found spring overshoot easing in KanbanBoard",
  );

  // Assert canonical 180ms easeOut easing
  assert.match(
    kanbanContent,
    /duration:\s*180/,
    "Expected duration 180ms in KanbanBoard",
  );
  assert.match(
    kanbanContent,
    /cubic-bezier\(0\.2,\s*0\.8,\s*0\.3,\s*1\)/,
    "Expected Section 05 cubic-bezier(0.2, 0.8, 0.3, 1) easing in KanbanBoard",
  );
});

test("badges conform to Section 10 precision geometry and typography", () => {
  const statusBadge = fs.readFileSync(
    path.join(TASKS_COMPONENTS_DIR, "badges/TaskStatusBadge.tsx"),
    "utf8",
  );
  const priorityBadge = fs.readFileSync(
    path.join(TASKS_COMPONENTS_DIR, "badges/TaskPriorityBadge.tsx"),
    "utf8",
  );

  for (const content of [statusBadge, priorityBadge]) {
    assert.match(content, /rounded-\[3px\]/);
    assert.match(content, /font-mono/);
    assert.match(content, /text-\[11px\]/);
    assert.match(content, /uppercase/);
    assert.match(content, /tracking-\[0\.09em\]/);
  }
});

test("task filters conform to Section 05 drafting segmented control and Section 04 typography", () => {
  const filtersContent = fs.readFileSync(
    path.join(TASKS_COMPONENTS_DIR, "TaskFilters.tsx"),
    "utf8",
  );

  assert.match(filtersContent, /h-\[34px\]/);
  assert.match(filtersContent, /rounded-\[5px\]/);
  assert.match(filtersContent, /rounded-\[3px\]/);
  assert.match(filtersContent, /text-xs font-medium/);
  // Filter button labels must use Instrument Sans, not monospace
  assert.doesNotMatch(
    filtersContent,
    /font-mono/,
    "TaskFilters button labels must use Instrument Sans font-medium, not font-mono",
  );
});

test("typography conforms to Section 04: headings and action buttons use Instrument Sans, not font-mono", () => {
  const tasksTabContent = fs.readFileSync(TASKS_TAB_PATH, "utf8");
  const kanbanContent = fs.readFileSync(
    path.join(TASKS_COMPONENTS_DIR, "KanbanBoard.tsx"),
    "utf8",
  );
  const modalContent = fs.readFileSync(
    path.join(TASKS_COMPONENTS_DIR, "CreateTaskModal.tsx"),
    "utf8",
  );
  const detailPanelContent = fs.readFileSync(
    path.join(TASKS_COMPONENTS_DIR, "TaskDetailPanel.tsx"),
    "utf8",
  );

  // TasksTab header and action buttons
  assert.doesNotMatch(
    tasksTabContent,
    /TASK BOARD/,
    "TasksTab header should use title case 'Board' without uppercase tracking",
  );
  assert.doesNotMatch(
    tasksTabContent,
    /font-mono[^"]*New task/,
    "New task button should not use font-mono",
  );

  // Kanban column titles must not use font-mono
  assert.doesNotMatch(
    kanbanContent,
    /font-mono text-xs font-semibold uppercase tracking-\[0\.09em\] text-foreground truncate max-w-\[150px\]/,
    "Kanban column titles must use Instrument Sans, not font-mono",
  );

  // CreateTaskModal title must not use font-mono
  assert.doesNotMatch(
    modalContent,
    /<DialogTitle className="font-mono/,
    "CreateTaskModal title must use Instrument Sans, not font-mono",
  );

  // TaskDetailPanel drawer tabs must use Instrument Sans (text-xs font-medium), not font-mono uppercase tracking
  assert.doesNotMatch(
    detailPanelContent,
    /font-mono text-xs uppercase tracking-\[0\.09em\]/,
    "TaskDetailPanel tabs must use Instrument Sans, not font-mono uppercase tracking",
  );
});

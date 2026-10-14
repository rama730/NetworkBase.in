import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TaskCard } from "../../src/components/projects/v2/tasks/TaskCard";

function renderTask(
  overrides: Record<string, unknown> = {},
  cardProps: Record<string, unknown> = {},
) {
  return renderToStaticMarkup(
    React.createElement(TaskCard, {
      task: {
        id: "task-card-layout",
        title: "A task with every volatile badge enabled",
        status: "todo",
        reviewStatus: "pending",
        priority: "high",
        dueDate: "2025-01-01T00:00:00.000Z",
        taskNumber: 42,
        projectKey: "NB",
        assignee: { id: "assignee", fullName: "Rama", avatarUrl: null },
        assigneeId: "assignee",
        sprint: {
          id: "sprint",
          name: "An intentionally long sprint name",
          status: "active",
        },
        storyPoints: 8,
        subtaskCount: 2,
        completedSubtaskCount: 1,
        newSubtaskCount: 1,
        fileCount: 3,
        newFileCount: 2,
        commentCount: 4,
        newCommentCount: 1,
        ...overrides,
      },
      activeAssignableMemberIds: new Set(),
      ...cardProps,
    }),
  );
}

test("task cards omit status badge when showStatus is false (Kanban board) and retain it when true (Workspace panel)", () => {
  // Kanban board view (showStatus: false)
  const kanbanHtml = renderTask({}, { showStatus: false });
  assert.doesNotMatch(kanbanHtml, />To Do<\/span>/);
  assert.match(kanbanHtml, />High<\/span>/);
  assert.match(kanbanHtml, /In Review/);

  // Workspace panel / default view (showStatus: true)
  const workspaceHtml = renderTask();
  assert.match(workspaceHtml, />To Do<\/span>/);
  assert.match(workspaceHtml, />High<\/span>/);
});

test("task cards wrap titles and badges without hiding workflow information", () => {
  const html = renderTask();

  assert.match(html, /h-\[128px\]/);
  assert.match(html, /w-full min-w-0/);
  assert.match(html, /overflow-hidden/);
  assert.match(html, /grid-rows-\[auto_auto_auto\] gap-3 p-3/);
  assert.match(html, /h-6/);
  assert.match(html, /line-clamp-3 text-left (?:text-sm font-semibold leading-5|text-\[13px\] font-medium leading-\[18px\])/);
  assert.doesNotMatch(html, /overflow-x-auto/);
  assert.match(html, /To Do/);
  assert.match(html, /In Review/);
  assert.match(html, /Overtime/);
  assert.match(html, /Needs reassignment/);
  assert.doesNotMatch(
    html,
    /Edit task|Drag to reorder|hover:-translate-y-0\.5/,
  );
  assert.match(html, />A task with every volatile badge enabled<\/h4>/);
  assert.doesNotMatch(html, /Show \d+ more title words/);
});

test("all task columns retain the same base height and width, whether empty or populated", () => {
  const board = fs.readFileSync(
    path.join(
      process.cwd(),
      "src/components/projects/v2/tasks/KanbanBoard.tsx",
    ),
    "utf8",
  );

  // Fixed 300px from md up; phones clamp to the viewport so one column fits.
  assert.match(board, /w-\[min\(300px,calc\(100vw-48px\)\)\] shrink-0[^"]*md:w-\[300px\]/);
  assert.match(board, /p-3 space-y-3 min-h-\[150px\] flex-1 flex flex-col/);
});

test("kanban drag overlay card matches column inner card width (276px) and never expands to column outer width", () => {
  const board = fs.readFileSync(
    path.join(
      process.cwd(),
      "src/components/projects/v2/tasks/KanbanBoard.tsx",
    ),
    "utf8",
  );

  // Column width is 300px with p-3 (12px padding each side), so card width is exactly 276px
  assert.match(board, /w-\[min\(276px,calc\(100vw-2rem\)\)\]/);
  // Ensure DragOverlay does not have the old expanding 300px card width
  assert.doesNotMatch(board, /w-\[min\(300px,calc\(100vw-2rem\)\)\]/);
  // Ensure SortableTaskCard attaches data-task-id for precise subpixel drag measurement
  assert.match(board, /data-task-id=\{task\.id\}/);
});

test("priority labels use one red intensity scale", async () => {
  const { getTaskPriorityPresentation } =
    await import("../../src/lib/projects/task-workflow");

  for (const priority of ["low", "medium", "high", "urgent"] as const) {
    assert.match(
      getTaskPriorityPresentation(priority).badgeClassName,
      /(rose|red)/,
    );
  }
  assert.equal(getTaskPriorityPresentation("urgent").label, "Urgent");
});

test("subtask, attachment, and comment summaries render exactly once", () => {
  const html = renderTask();

  assert.equal((html.match(/title="Subtasks"/g) ?? []).length, 1);
  assert.equal((html.match(/title="Attachments"/g) ?? []).length, 1);
  assert.equal((html.match(/title="Comments"/g) ?? []).length, 1);
});

test("task-card footers keep the avatar and use its former label space for task counts", () => {
  const source = fs.readFileSync(
    path.join(
      process.cwd(),
      "src/components/projects/v2/tasks/TaskCard.tsx",
    ),
    "utf8",
  );
  const html = renderTask();

  assert.doesNotMatch(html, /<span[^>]*>Rama<\/span>/);
  assert.match(html, /title="Rama"/);
  assert.match(source, /avatar \+ task counts share one fixed footer row/i);
  assert.doesNotMatch(
    source,
    /flex min-w-0 flex-1 items-center gap-2 overflow-x-auto no-scrollbar/,
  );
});

test("task-card footers never expose a storage identifier as a fallback label", () => {
  const html = renderTask({ taskNumber: null, projectKey: null, id: "9fbd8943-e594-473c-8f82-5830851d7a" });
  assert.match(html, />Task<\/span>/);
  assert.doesNotMatch(html, /9fbd89/);
});

test("every unread task counter uses its red icon and total without a dot", () => {
  const html = renderTask();

  assert.match(html, /aria-label="Subtasks, 1\/2, 1 new"/);
  assert.match(html, /aria-label="Attachments, 3, 2 new"/);
  assert.match(html, /aria-label="Comments, 4, 1 new"/);
  assert.doesNotMatch(html, />\+2</);
  assert.equal((html.match(/text-rose-500/g) ?? []).length, 3);
  assert.doesNotMatch(html, /animate-ping|rounded-full bg-red-500/);
});

test("overdue timing badges do not add a second metadata row", () => {
  const html = renderTask({
    reviewStatus: "none",
    status: "todo",
    sprint: {
      id: "completed-sprint",
      name: "Completed sprint",
      status: "completed",
    },
  });

  assert.match(html, /Overdue/);
  assert.equal((html.match(/title="Subtasks"/g) ?? []).length, 1);
  assert.equal((html.match(/title="Attachments"/g) ?? []).length, 1);
  assert.equal((html.match(/title="Comments"/g) ?? []).length, 1);
});

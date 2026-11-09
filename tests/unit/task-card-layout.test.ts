import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TaskCard } from "../../src/components/workspaces/v2/tasks/TaskCard";

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
  assert.doesNotMatch(kanbanHtml, />To do<\/span>/);
  assert.match(kanbanHtml, />High<\/span>/);
  assert.match(kanbanHtml, /In review/);

  // Workspace panel / default view (showStatus: true)
  const workspaceHtml = renderTask({ reviewStatus: "none" });
  assert.match(workspaceHtml, />To do<\/span>/);
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
  assert.doesNotMatch(html, /To do/);
  assert.match(html, /In review/);
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
      "src/components/workspaces/v2/tasks/KanbanBoard.tsx",
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
      "src/components/workspaces/v2/tasks/KanbanBoard.tsx",
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
    await import("../../src/lib/workspaces/task-workflow");

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
  assert.equal((html.match(/title="Files"/g) ?? []).length, 1);
  assert.equal((html.match(/title="Comments"/g) ?? []).length, 1);
});

test("task-card footers keep the avatar and use its former label space for task counts", () => {
  const source = fs.readFileSync(
    path.join(
      process.cwd(),
      "src/components/workspaces/v2/tasks/TaskCard.tsx",
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
  assert.match(html, /aria-label="Files, 3, 2 new"/);
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
  assert.equal((html.match(/title="Files"/g) ?? []).length, 1);
  assert.equal((html.match(/title="Comments"/g) ?? []).length, 1);
});

// Member card lifecycle (2026-11-10): a member's own copy never overlaps, in any state.
const copy = (state: string, extra: Record<string, unknown> = {}) => renderTask({
  assignmentId: "master", fromLabel: "Ms. Rao", teamName: "CSE 3B", reviewStatus: "none", status: "in_progress",
  copyStage: { state, late: false, since: "2026-11-04T10:00:00.000Z", reason: "add the complexity of push and pop", fixBy: "2026-11-13T10:00:00.000Z", version: 1, reviewRequired: true, handIn: null },
  ...extra,
}, { showStatus: false });

test("a copy shows who it's from in the avatar slot, not the holder's own avatar", () => {
  const html = copy("in_progress");
  assert.match(html, /From Ms\. Rao · CSE 3B/);
  assert.doesNotMatch(html, /title="Rama"/);
});

test("a copy's date is what its holder owes next: due while working, fix-by when returned, nothing once handed in", () => {
  assert.match(copy("not_started"), /Jan 1, 2025/);
  assert.match(copy("in_progress"), /Jan 1, 2025/);
  const returned = copy("returned");
  assert.match(returned, /data-deadline="fix-by"[^>]*>.*?Nov 13/);
  assert.doesNotMatch(returned, /Jan 1, 2025/);
  for (const state of ["submitted", "done", "missing", "excused"]) {
    assert.doesNotMatch(copy(state), /data-deadline=/, state);
  }
});

test("a handed-in or missing copy shows no timing chips; Missing already says it", () => {
  for (const state of ["submitted", "done", "missing", "excused"]) {
    assert.doesNotMatch(copy(state), />(Overdue|Overtime|Incomplete)</, state);
  }
  assert.match(copy("in_progress"), />(Overdue|Overtime)</);
});

test("the stage line stops at two lines", () => {
  assert.match(copy("returned"), /line-clamp-2[^"]*"[^>]*>Returned: add the complexity/);
});

test("activity counts share one chip that keeps its size; the From label is the footer's one shrinking item", () => {
  const html = copy("submitted");
  assert.equal((html.match(/aria-label="Task activity summary/g) ?? []).length, 1);
  assert.match(html, /class="flex shrink-0 items-center gap-1 rounded-\[3px\] border[^"]*"[^>]*aria-label="Task activity summary/);
  assert.equal((html.match(/border border-border\/60 bg-muted\/40 px-1 /g) ?? []).length, 1);
  assert.match(html, /class="flex h-4 min-w-0 flex-wrap[^"]*overflow-hidden[^"]*"[^>]*title="Assignment from Ms\. Rao/);
  assert.match(html, /class="min-w-12 flex-1 truncate">From Ms\. Rao · CSE 3B</);
});

test("My work rows: the org chips group shrinks only its context chip and clips instead of overlapping", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "src/components/my-work/MyWorkTasksTab.tsx"), "utf8");
  assert.match(source, /hidden min-w-0 max-w-\[55%\] items-center gap-1 overflow-hidden sm:flex/);
  assert.match(source, /cn\(chip, "min-w-0 shrink truncate"\)\} title=\{task\.org\.context\}/);
});

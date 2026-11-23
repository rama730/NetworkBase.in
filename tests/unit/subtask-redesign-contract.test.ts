import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { upsertTaskSubtask } from "@/lib/workspaces/task-subtasks";

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("subtasks use an accessible grouped checklist with explicit creation and recovery", () => {
  const tab = read("src/components/workspaces/v2/tasks/TaskDetailTabs/SubtasksTab.tsx");

  assert.doesNotMatch(tab, /role="progressbar"/);
  assert.match(tab, /role="checkbox"/);
  assert.match(tab, /aria-checked=\{subtask\.completed\}/);
  // Controls round 2: the filter is a segmented row; counts are mono beside the label.
  assert.match(tab, /className="nb-seg"/);
  assert.match(tab, /Open <span className="nb-seg-n">\{openSubtasks\.length\}<\/span>/);
  assert.match(tab, /Done <span className="nb-seg-n">\{completedSubtasks\.length\}<\/span>/);
  assert.match(tab, /Add a subtask…/);
  assert.match(tab, /onUpdateSubtask/);
  assert.match(tab, /onBlur=\{\(\) => void saveTitle\(subtask\)\}/);
  assert.match(tab, /await onDeleteSubtask\(subtask\.id\)/);
  assert.doesNotMatch(tab, /setTimeout\(\(\) => void commit/);
  assert.match(tab, /void onRetry\(\)/);

  // Redesign enhancements:
  assert.doesNotMatch(tab, /rounded-\[8px\] border border-border bg-card p-4/);
  assert.doesNotMatch(tab, /rounded-full/);
  assert.match(tab, /#\{index \+ 1\}/);
  assert.match(tab, /copySubtaskTitle/);
  assert.match(tab, /inputRef\.current\?\.focus\(\)/);
  assert.match(tab, /Mark as completed/);
  assert.match(tab, /Reopen all/);
});

test("subtask mutations reconcile by id and use deterministic, narrow reads", () => {
  const hook = read("src/hooks/useTaskPanelResource.ts");
  const actions = read("src/app/actions/subtask.ts");
  const reducer = read("src/lib/workspaces/task-subtasks.ts");

  assert.match(hook, /upsertTaskSubtask/);
  assert.match(hook, /const replaceSubtasks/);
  assert.match(reducer, /left\.id\.localeCompare\(right\.id\)/);
  assert.match(hook, /select\("id, task_id, title, completed, position, created_at, updated_at"\)/);
  assert.match(hook, /updateSubtaskAction/);
  assert.match(hook, /completedSubtaskCount: counts\.completedSubtasks/);
  assert.match(hook, /task_panel\.subtask/);
  assert.match(actions, /pg_advisory_xact_lock/);
  assert.match(actions, /export async function updateSubtaskAction/);
  // Results go back without via / agent_name: the label is decided per viewer (report Part B).
  assert.match(actions, /return \{ success: true, data: withoutVia\(updated\) \}/);
  assert.match(actions, /return \{ success: true, data: withoutVia\(created\) \}/);
});

test("subtask upserts preserve concurrent rows and stable order", () => {
  const current = [
    { id: "b", taskId: "task", title: "Second", completed: false, position: 1, createdAt: "2026-01-01T00:00:01.000Z", updatedAt: "2026-01-01T00:00:01.000Z" },
    { id: "a", taskId: "task", title: "First", completed: false, position: 0, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
  ];

  const merged = upsertTaskSubtask(current, {
    ...current[0],
    title: "Second, updated remotely",
    completed: true,
  });

  assert.deepEqual(merged.map((subtask) => subtask.id), ["a", "b"]);
  assert.equal(merged[1]?.title, "Second, updated remotely");
  assert.equal(merged[1]?.completed, true);
});

// API-019: a bounded page never decides the totals, and rows past the first page stay reachable.
import { readFileSync as readSource } from "node:fs";
import { test as contractTest } from "node:test";
import assertStrict from "node:assert/strict";

contractTest("subtask pages expose hasMore, keyset load-more and aggregate totals", () => {
  const hook = readSource("src/hooks/useTaskPanelResource.ts", "utf8");
  assertStrict.match(hook, /\.range\(0, SUBTASK_PAGE_SIZE\)/);
  assertStrict.match(hook, /hasMore = rows\.length > SUBTASK_PAGE_SIZE/);
  assertStrict.match(hook, /count: "exact", head: true/);
  // List length may only stand in for the total when the list is complete.
  assertStrict.match(hook, /loaded\.hasMore\s*\? \{ \.\.\.current, \.\.\.\(loaded\.totals \?\? \{\}\) \}/);
  assertStrict.match(hook, /if \(subtasksHasMoreRef\.current\) \{[^}]*refreshSubtaskTotals/s);
  assertStrict.match(hook, /position\.gt\.\$\{last\.position\},and\(position\.eq\.\$\{last\.position\},id\.gt\.\$\{last\.id\}\)/);
  const tab = readSource("src/components/workspaces/v2/tasks/TaskDetailTabs/SubtasksTab.tsx", "utf8");
  assertStrict.match(tab, /Load more subtasks/);
});

import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

// A task link (?drawerType=task&drawerId=…) whose task isn't in the board's first list is fetched. The board's own
// list arriving re-runs the effect while that fetch is in flight; the answer must still open the panel. It used to be
// dropped by the effect's cleanup flag, so links to new workspaces' tasks, later pages and off-board items opened nothing.
const source = fs.readFileSync("src/components/workspaces/v2/TasksTab.tsx", "utf8");
const start = source.indexOf("void getWorkspaceTaskDetailAction(projectId, initialOpenTaskId)");
const effect = source.slice(start, source.indexOf("const handleCreateTask", start));

test("a linked task's fetched answer is kept while the link is still the one loading", () => {
  assert.ok(start > 0, "the linked-task fetch is in TasksTab");
  assert.doesNotMatch(effect, /\bcancelled\b/, "no effect-cleanup flag drops the answer");
  assert.equal((effect.match(/loadingInitialOpenTaskRef\.current !== initialOpenTaskId/g) ?? []).length, 2, "then and catch both check the link");
});

test("opening a linked task from the board's list retires an older pending fetch", () => {
  const local = source.slice(source.indexOf("const localTask = sprintAwareTasks.find(matchesInitialTask);"), start);
  assert.match(local, /loadingInitialOpenTaskRef\.current = null;/);
});

test("leaving the tab retires a pending linked-task fetch", () => {
  assert.match(source, /useEffect\(\(\) => \(\) => \{ loadingInitialOpenTaskRef\.current = null; \}, \[\]\);/);
});

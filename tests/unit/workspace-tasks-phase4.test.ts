import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { QueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query-keys";
import { patchProjectTaskCaches } from "@/lib/workspaces/task-cache";
import {
  compareTaskSurfaceRecords,
  formatTaskDueDate,
  isTaskOverdue,
  projectTaskHref,
  type TaskSurfaceRecord,
} from "@/lib/workspaces/task-presentation";

const read = (path: string) => readFileSync(path, "utf8");
const task = (overrides: Partial<TaskSurfaceRecord>) => ({
  id: "t1", projectId: "p1", title: "A", status: "todo", priority: "medium", createdAt: "2026-04-01T00:00:00.000Z",
  updatedAt: "2026-04-01T00:00:00.000Z", position: null, ...overrides,
}) as TaskSurfaceRecord;

test("edits reach searched boards too, and only tasks a search already shows", () => {
  const client = new QueryClient();
  const searchKey = queryKeys.project.detail.tasks("p1", "all", "KEY-12");
  client.setQueryData(searchKey, { pages: [{ tasks: [task({ id: "t1", title: "old" })] }], pageParams: [null] });
  client.setQueryData(queryKeys.project.detail.tasks("p1", "all", "other"), { pages: [{ tasks: [] }], pageParams: [null] });
  patchProjectTaskCaches(client, "p1", task({ id: "t1", title: "new", updatedAt: "2026-04-02T00:00:00.000Z" }), { reconcile: false });
  const searched = client.getQueryData<{ pages: { tasks: TaskSurfaceRecord[] }[] }>(searchKey)!;
  assert.equal(searched.pages[0]!.tasks[0]!.title, "new");
  const other = client.getQueryData<{ pages: { tasks: TaskSurfaceRecord[] }[] }>(queryKeys.project.detail.tasks("p1", "all", "other"))!;
  assert.equal(other.pages[0]!.tasks.length, 0, "a search that did not match keeps its own results");
});

test("reconcile refetches every task list, the main board included", () => {
  assert.doesNotMatch(read("src/lib/workspaces/task-cache.ts"), /queryKey\.length > 5/);
});

test("client order is the server's board order: position DESC, then newest", () => {
  const sorted = [task({ id: "a", position: 1 }), task({ id: "b", position: 9 }), task({ id: "c", position: null, createdAt: "2026-05-01T00:00:00.000Z" })]
    .sort(compareTaskSurfaceRecords).map((t) => t.id);
  assert.deepEqual(sorted, ["b", "a", "c"]);
});

test("due dates are calendar dates: never a day early, not overdue on the day", () => {
  assert.equal(formatTaskDueDate("2026-10-14T00:00:00.000Z", new Date(2026, 9, 13)), "Oct 14");
  assert.equal(isTaskOverdue({ dueDate: "2026-10-14T00:00:00.000Z", status: "todo" }, new Date(2026, 9, 14, 23)), false);
  assert.equal(isTaskOverdue({ dueDate: "2026-10-14T00:00:00.000Z", status: "todo" }, new Date(2026, 9, 15, 0, 1)), true);
});

test("an open task is a link: drawer params are written, copy links use them", () => {
  assert.equal(projectTaskHref("atlas", "t1"), "/workspaces/atlas?tab=tasks&drawerType=task&drawerId=t1");
  const tab = read("src/components/workspaces/v2/TasksTab.tsx");
  assert.match(tab, /nextParams\.set\("drawerType", "task"\)/);
  assert.match(tab, /router\.push\(nextUrl, \{ scroll: false \}\)/);
  assert.doesNotMatch(read("src/components/workspaces/v2/tasks/TaskDetailPanel.tsx"), /\?tab=tasks&taskId=/);
});

test("story points are an accepted field and commit on blur", () => {
  assert.match(read("src/lib/validations/task.ts"), /"dueDate", "storyPoints"\]/);
  assert.match(read("src/components/workspaces/v2/tasks/TaskDetailTabs/DetailsTab.tsx"), /onBlur=\{commitPoints\}/);
});

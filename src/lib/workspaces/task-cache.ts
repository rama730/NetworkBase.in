import type { QueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query-keys";
import {
  compareTaskSurfaceRecords,
  mergeTaskSurfaceRecords,
  normalizeTaskSurfaceRecord,
  taskSurfaceVersionMs,
  type TaskSurfaceRecord,
} from "@/lib/workspaces/task-presentation";

type TaskInfinitePage = {
  success?: boolean;
  tasks: TaskSurfaceRecord[];
  nextCursor?: string | null;
  hasMore?: boolean;
};

type TaskInfiniteData = {
  pages: TaskInfinitePage[];
  pageParams: unknown[];
};

type TaskScope = "all" | "backlog" | "sprint" | "review" | "assignments" | "mine";

function isInfiniteTaskData(value: unknown): value is TaskInfiniteData {
  return (
    !!value &&
    typeof value === "object" &&
    Array.isArray((value as TaskInfiniteData).pages)
  );
}

function matchesScope(task: TaskSurfaceRecord, scope: TaskScope) {
  if (scope === "backlog") return !task.sprintId;
  if (scope === "review") return task.reviewStatus === "pending";
  if (scope === "sprint") return !!task.sprintId;
  if (scope === "assignments") return task.kind === "assignment" || !!task.assignmentId;
  return true;
}

function patchTaskList(
  list: TaskSurfaceRecord[],
  incoming: TaskSurfaceRecord,
  scope: TaskScope,
): TaskSurfaceRecord[] {
  const normalizedIncoming = normalizeTaskSurfaceRecord(incoming);
  const current = list.find((t) => t.id === incoming.id);
  const normalizedCurrent = current
    ? normalizeTaskSurfaceRecord(current)
    : null;

  const merged =
    normalizedCurrent &&
    taskSurfaceVersionMs(normalizedCurrent) >
      taskSurfaceVersionMs(normalizedIncoming)
      ? normalizedCurrent
      : normalizedCurrent
        ? mergeTaskSurfaceRecords(normalizedCurrent, normalizedIncoming)
        : normalizedIncoming;

  const nextList = list
    .filter((t) => t.id !== incoming.id)
    .map(normalizeTaskSurfaceRecord);
  // Mine: the cache doesn't know who you are, so it only keeps what the server already listed; the refetch adds new ones.
  // An assignment copy is the same: an admin's board leaves copies out (orgTaskReadFilter), so opening one never adds it
  // (board/review report §1); a list that already holds it — the student's own board — still gets the change.
  const listedOnlyByServer = scope === "mine" || Boolean(normalizedIncoming.assignmentId);
  if (matchesScope(merged, scope) && (!listedOnlyByServer || current)) nextList.push(merged);

  return nextList.sort(compareTaskSurfaceRecords);
}

function removeTaskFromList(list: TaskSurfaceRecord[], taskId: string) {
  return list
    .filter((task) => task.id !== taskId)
    .map(normalizeTaskSurfaceRecord);
}

export function patchTaskQueryData(
  existing: unknown,
  incoming: TaskSurfaceRecord,
  scope: TaskScope,
): unknown {
  if (Array.isArray(existing)) {
    return patchTaskList(
      existing.map(normalizeTaskSurfaceRecord),
      incoming,
      scope,
    );
  }

  if (isInfiniteTaskData(existing)) {
    const existingPageIndex = existing.pages.findIndex((page) =>
      (page.tasks ?? []).some((task) => task.id === incoming.id),
    );
    const targetPageIndex = existingPageIndex >= 0 ? existingPageIndex : 0;
    const pages = existing.pages.map((page, pageIndex) => ({
      ...page,
      tasks:
        pageIndex === targetPageIndex
          ? patchTaskList(
              (page.tasks ?? []).map(normalizeTaskSurfaceRecord),
              incoming,
              scope,
            )
          : removeTaskFromList(
              (page.tasks ?? []).map(normalizeTaskSurfaceRecord),
              incoming.id,
            ),
    }));

    return {
      ...existing,
      pages,
    } satisfies TaskInfiniteData;
  }

  return existing;
}

export function removeTaskFromQueryData(
  existing: unknown,
  taskId: string,
): unknown {
  if (Array.isArray(existing)) {
    return removeTaskFromList(existing.map(normalizeTaskSurfaceRecord), taskId);
  }

  if (isInfiniteTaskData(existing)) {
    return {
      ...existing,
      pages: existing.pages.map((page) => ({
        ...page,
        tasks: removeTaskFromList(
          (page.tasks ?? []).map(normalizeTaskSurfaceRecord),
          taskId,
        ),
      })),
    } satisfies TaskInfiniteData;
  }

  return existing;
}

function taskQueries(queryClient: QueryClient, projectId: string) {
  return queryClient
    .getQueryCache()
    .findAll({ queryKey: queryKeys.project.detail.tasksRoot(projectId) })
    .map((query) => ({
      queryKey: query.queryKey,
      scope: (query.queryKey[4] ?? "all") as TaskScope,
      search: typeof query.queryKey[5] === "string" ? query.queryKey[5] : "",
    }));
}

function reconcileProjectTasks(queryClient: QueryClient, projectId: string) {
  // Every task list, the unsearched board included, refetches if it is on screen.
  void queryClient.invalidateQueries({
    queryKey: queryKeys.project.detail.tasksRoot(projectId),
    refetchType: "active",
  });
  void queryClient.invalidateQueries({
    queryKey: queryKeys.globalSearch.projectRoot(),
    refetchType: "active",
  });
}

export function patchWorkspaceTaskCaches(
  queryClient: QueryClient,
  projectId: string,
  incoming: TaskSurfaceRecord,
  options: { reconcile?: boolean } = {},
) {
  // Every cached list (each scope, and each search) gets the edit. A searched list only updates a
  // task it already shows: whether the edited task still matches is the server's call on reconcile.
  for (const { queryKey, scope, search } of taskQueries(queryClient, projectId)) {
    queryClient.setQueryData(queryKey, (existing: unknown) => {
      if (search && !containsTask(existing, incoming.id)) return existing;
      return patchTaskQueryData(existing, incoming, scope);
    });
  }
  if (options.reconcile !== false) reconcileProjectTasks(queryClient, projectId);
}

function containsTask(existing: unknown, taskId: string) {
  if (Array.isArray(existing)) return existing.some((task: TaskSurfaceRecord) => task.id === taskId);
  if (isInfiniteTaskData(existing)) return existing.pages.some((page) => (page.tasks ?? []).some((task) => task.id === taskId));
  return false;
}

export function removeTaskFromWorkspaceTaskCaches(
  queryClient: QueryClient,
  projectId: string,
  taskId: string,
  options: { reconcile?: boolean } = {},
) {
  for (const { queryKey } of taskQueries(queryClient, projectId)) {
    queryClient.setQueryData(queryKey, (existing: unknown) => removeTaskFromQueryData(existing, taskId));
  }
  if (options.reconcile !== false) reconcileProjectTasks(queryClient, projectId);
}

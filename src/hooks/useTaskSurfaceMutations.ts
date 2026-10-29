"use client";

import { toast } from "@/lib/feedback";
import { completionOutcomeLabel } from "@/lib/projects/task-completion-policy";
import { taskCompletionPolicyKey, syncTaskCompletionPolicy } from "@/hooks/useTaskCompletionPolicy";
import { useCallback, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import {
  assignTaskAction,
  moveTaskToWorkflowColumnAction,
  updateTaskFieldAction,
  updateTaskStatusAction,
  type TaskStatus,
} from "@/app/actions/task";
import { queryKeys } from "@/lib/query-keys";
import { patchProjectTaskCaches } from "@/lib/projects/task-cache";
import type { TaskFileReadinessWarning } from "@/lib/projects/task-file-intelligence";
import { recordSprintMetric } from "@/lib/projects/sprint-observability";
import {
  normalizeSprintOptions,
  normalizeAssignableMembers,
  normalizeTaskSurfaceRecord,
  type TaskSurfaceRecord,
} from "@/lib/projects/task-presentation";
import type { ProjectNode } from "@/lib/db/schema";

type MutableTaskField =
  | "title"
  | "description"
  | "priority"
  | "sprintId"
  | "dueDate"
  | "storyPoints";

type SnapshotBundle = {
  taskSlices: Array<[readonly unknown[], unknown]>;
  sprintSlices: Array<[readonly unknown[], unknown]>;
};

function isTaskStatus(value: string): value is TaskStatus {
  return (
    value === "todo" ||
    value === "in_progress" ||
    value === "blocked" ||
    value === "done"
  );
}

export function useTaskSurfaceMutations(params: {
  task: TaskSurfaceRecord;
  projectId: string;
  attachments: ProjectNode[];
  sprints?: any[];
  members?: any[];
  onTaskChange: (task: TaskSurfaceRecord) => void;
}) {
  const {
    task,
    projectId,
    attachments,
    sprints = [],
    members = [],
    onTaskChange,
  } = params;
  const queryClient = useQueryClient();
  const [isMutating, setIsMutating] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [statusWarnings, setStatusWarnings] = useState<
    TaskFileReadinessWarning[]
  >([]);

  const availableSprints = useMemo(
    () => normalizeSprintOptions(sprints),
    [sprints],
  );
  const availableMembers = useMemo(
    () => normalizeAssignableMembers(members),
    [members],
  );

  const takeSnapshots = useCallback((): SnapshotBundle => {
    return {
      taskSlices: queryClient.getQueriesData({
        queryKey: queryKeys.project.detail.tasksRoot(projectId),
      }),
      sprintSlices: queryClient.getQueriesData({
        queryKey: queryKeys.project.detail.sprintDetailRoot(projectId),
      }),
    };
  }, [projectId, queryClient]);

  const restoreSnapshots = useCallback(
    (snapshots: SnapshotBundle) => {
      for (const [queryKey, snapshot] of snapshots.taskSlices) {
        queryClient.setQueryData(queryKey, snapshot);
      }
      for (const [queryKey, snapshot] of snapshots.sprintSlices) {
        queryClient.setQueryData(queryKey, snapshot);
      }
    },
    [queryClient],
  );

  const applyOptimisticTask = useCallback(
    (nextTask: TaskSurfaceRecord, field: string) => {
      patchProjectTaskCaches(queryClient, projectId, nextTask);
      onTaskChange(nextTask);
      recordSprintMetric("project.sprint.optimistic_patch", {
        projectId,
        taskId: task.id,
        field,
        result: "applied",
      });
    },
    [onTaskChange, projectId, queryClient, task],
  );

  const rollbackOptimisticTask = useCallback(
    (
      snapshots: SnapshotBundle,
      previousTask: TaskSurfaceRecord,
      field: string,
    ) => {
      restoreSnapshots(snapshots);
      onTaskChange(previousTask);
      recordSprintMetric("project.sprint.optimistic_patch", {
        projectId,
        taskId: task.id,
        field,
        result: "rolled_back",
      });
    },
    [onTaskChange, projectId, restoreSnapshots, task.id],
  );

  const buildFieldTask = useCallback(
    (field: MutableTaskField, value: unknown) => {
      const nextTask = normalizeTaskSurfaceRecord(task);

      if (field === "title") {
        nextTask.title = typeof value === "string" ? value.trim() : "";
      } else if (field === "description") {
        nextTask.description =
          typeof value === "string" && value.trim() ? value : null;
      } else if (field === "priority") {
        nextTask.priority = String(
          value || "medium",
        ) as TaskSurfaceRecord["priority"];
      } else if (field === "sprintId") {
        const sprintId = typeof value === "string" && value ? value : null;
        const sprint =
          availableSprints.find((entry) => entry.id === sprintId) ?? null;
        nextTask.sprintId = sprintId;
        nextTask.sprint = sprint
          ? { id: sprint.id, name: sprint.name, status: sprint.status }
          : null;
      } else if (field === "dueDate") {
        nextTask.dueDate = typeof value === "string" && value ? value : null;
      } else if (field === "storyPoints") {
        nextTask.storyPoints =
          typeof value === "number" && !Number.isNaN(value) ? value : null;
      }

      nextTask.updatedAt = new Date().toISOString();
      return nextTask;
    },
    [availableSprints, task],
  );

  const updateField = useCallback(
    async (field: MutableTaskField, value: unknown) => {
      setMutationError(null);
      if (field !== "title") {
        setStatusWarnings([]);
      }
      setIsMutating(true);
      const previousTask = normalizeTaskSurfaceRecord(task);
      const nextTask = buildFieldTask(field, value);
      const snapshots = takeSnapshots();

      applyOptimisticTask(nextTask, field);

      try {
        const result = await updateTaskFieldAction(
          task.id,
          field,
          value,
          projectId,
        );
        if (!result.success) {
          throw new Error(result.error || "Couldn’t update task");
        }
        // The server's version replaces the optimistic clock, so the next drag's version check matches.
        if (result.updatedAt) applyOptimisticTask({ ...nextTask, updatedAt: result.updatedAt }, field);
        return { success: true as const };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Couldn’t update task";
        rollbackOptimisticTask(snapshots, previousTask, field);
        setMutationError(message);
        return { success: false as const, error: message };
      } finally {
        setIsMutating(false);
      }
    },
    [
      applyOptimisticTask,
      buildFieldTask,
      projectId,
      rollbackOptimisticTask,
      takeSnapshots,
      task,
    ],
  );

  const updateStatus = useCallback(
    async (status: string) => {
      if (!isTaskStatus(status)) {
        const error = "Invalid task status";
        setMutationError(error);
        return { success: false as const, error };
      }

      setMutationError(null);
      setStatusWarnings([]);
      setIsMutating(true);

      const previousTask = normalizeTaskSurfaceRecord(task);
      // The card moves with its status: to that status's default section.
      const workflow = queryClient.getQueryData<Array<{ id: string; status: string; isDefault: boolean }>>(
        queryKeys.project.detail.workflow(projectId),
      );
      const defaultColumnId = workflow?.find((column) => column.isDefault && column.status === status)?.id;
      const nextTask = normalizeTaskSurfaceRecord({
        ...task,
        status,
        reviewStatus: status === "done" && queryClient.getQueryData<{ reviewRequired: boolean }>(taskCompletionPolicyKey(projectId))?.reviewRequired ? "pending" : "none",
        ...(defaultColumnId ? { workflowColumnId: defaultColumnId } : {}),
        updatedAt: new Date().toISOString(),
      });
      const snapshots = takeSnapshots();

      applyOptimisticTask(nextTask, "status");

      try {
        const result = await updateTaskStatusAction(task.id, status, projectId, undefined, previousTask.updatedAt);
        if (!result.success) {
          throw new Error(result.error || "Couldn’t update task status");
        }
        syncTaskCompletionPolicy(queryClient, projectId, result);
        setStatusWarnings(
          Array.isArray(result.warnings) ? result.warnings : [],
        );
        if (result.updatedAt) {
          applyOptimisticTask(
            normalizeTaskSurfaceRecord({
              ...nextTask,
              status: result.status ?? nextTask.status,
              updatedAt: result.updatedAt,
              reviewStatus: result.reviewStatus ?? nextTask.reviewStatus,
              completedAt: result.outcome === "completed"
                ? result.updatedAt
                : status !== "done" || result.reviewStatus === "pending" ? null : nextTask.completedAt,
              ...(result.outcome === "submitted" ? { reviewSubmittedAt: result.updatedAt } : {}),
            }),
            "status",
          );
        }
        if (status === "done") toast.success(completionOutcomeLabel(result.reviewStatus));
        return { success: true as const };
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Couldn’t update task status";
        rollbackOptimisticTask(snapshots, previousTask, "status");
        setMutationError(message);
        return { success: false as const, error: message };
      } finally {
        setIsMutating(false);
      }
    },
    [
      applyOptimisticTask,
      projectId,
      queryClient,
      rollbackOptimisticTask,
      takeSnapshots,
      task,
    ],
  );

  const updateAssignee = useCallback(
    async (assigneeId: string | null) => {
      setMutationError(null);
      setStatusWarnings([]);
      setIsMutating(true);

      const previousTask = normalizeTaskSurfaceRecord(task);
      const nextMember =
        availableMembers.find((member) => member.id === assigneeId) ?? null;
      const nextTask = normalizeTaskSurfaceRecord({
        ...task,
        assigneeId: assigneeId || null,
        assignee: assigneeId
          ? {
              id: assigneeId,
              fullName: nextMember?.identity?.fullName ?? "Assigned user",
              avatarUrl: nextMember?.identity?.avatarUrl ?? null,
            }
          : null,
        updatedAt: new Date().toISOString(),
      });
      const snapshots = takeSnapshots();

      applyOptimisticTask(nextTask, "assigneeId");

      try {
        const result = await assignTaskAction(task.id, assigneeId, projectId);
        if (!result.success) {
          throw new Error(result.error || "Couldn’t assign task");
        }
        if (result.updatedAt) applyOptimisticTask({ ...nextTask, updatedAt: result.updatedAt }, "assigneeId");
        return { success: true as const };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Couldn’t assign task";
        rollbackOptimisticTask(snapshots, previousTask, "assigneeId");
        setMutationError(message);
        return { success: false as const, error: message };
      } finally {
        setIsMutating(false);
      }
    },
    [
      applyOptimisticTask,
      availableMembers,
      projectId,
      rollbackOptimisticTask,
      takeSnapshots,
      task,
    ],
  );

  const moveToColumn = useCallback(
    async (workflowColumnId: string) => {
      setMutationError(null);
      setIsMutating(true);
      const previousTask = normalizeTaskSurfaceRecord(task);
      const nextTask = normalizeTaskSurfaceRecord({
        ...task,
        workflowColumnId,
        updatedAt: new Date().toISOString(),
      });
      const snapshots = takeSnapshots();
      applyOptimisticTask(nextTask, "workflowColumnId");
      try {
        const result = await moveTaskToWorkflowColumnAction(
          task.id,
          projectId,
          workflowColumnId,
          undefined,
          previousTask.updatedAt,
        );
        if (!result.success) throw new Error(result.error || "Couldn’t move task");
        syncTaskCompletionPolicy(queryClient, projectId, result);
        if (result.updatedAt) {
          applyOptimisticTask(
            normalizeTaskSurfaceRecord({
              ...nextTask,
              status: result.status ?? nextTask.status,
              updatedAt: result.updatedAt,
              reviewStatus: result.reviewStatus ?? nextTask.reviewStatus,
              completedAt: result.outcome === "completed" ? result.updatedAt : result.status !== "done" || result.reviewStatus === "pending" ? null : nextTask.completedAt,
              ...(result.outcome === "submitted" ? { reviewSubmittedAt: result.updatedAt } : {}),
            }),
            "workflowColumnId",
          );
        }
        return { success: true as const };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Couldn’t move task";
        rollbackOptimisticTask(snapshots, previousTask, "workflowColumnId");
        setMutationError(message);
        return { success: false as const, error: message };
      } finally {
        setIsMutating(false);
      }
    },
    [applyOptimisticTask, projectId, rollbackOptimisticTask, takeSnapshots, task],
  );

  return useMemo(
    () => ({
      isMutating,
      mutationError,
      statusWarnings,
      updateField,
      updateStatus,
      updateAssignee,
      moveToColumn,
    }),
    [
      isMutating,
      mutationError,
      statusWarnings,
      updateField,
      updateStatus,
      updateAssignee,
      moveToColumn,
    ],
  );
}

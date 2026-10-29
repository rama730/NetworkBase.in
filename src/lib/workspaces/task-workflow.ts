export const TASK_WORKFLOW_STATUSES = ["todo", "in_progress", "blocked", "done"] as const;
export const TASK_PRIORITY_VALUES = ["low", "medium", "high", "urgent"] as const;

export type TaskWorkflowStatus = (typeof TASK_WORKFLOW_STATUSES)[number];
export type TaskPriority = (typeof TASK_PRIORITY_VALUES)[number];

export type TaskWorkflowStatusPresentation = {
  id: TaskWorkflowStatus;
  label: string;
  description: string;
  columnTitle: string;
  emptyTitle: string;
  emptyDescription: string;
  badgeClassName: string;
  accentClassName: string;
};

export type TaskPriorityPresentation = {
  id: TaskPriority;
  label: string;
  badgeClassName: string;
};

export const TASK_STATUS_PRESENTATION: Record<TaskWorkflowStatus, TaskWorkflowStatusPresentation> = {
  todo: {
    id: "todo",
    label: "To do",
    description: "Work that is ready to start.",
    columnTitle: "To do",
    emptyTitle: "Tasks will appear here…",
    emptyDescription: "Tasks that are ready to start will appear here. Drag and drop your tasks here.",
    badgeClassName:
      "border border-border bg-muted/60 text-muted-foreground",
    accentClassName: "zinc",
  },
  in_progress: {
    id: "in_progress",
    label: "In progress",
    description: "Work that is actively moving.",
    columnTitle: "In progress",
    emptyTitle: "Tasks will appear here…",
    emptyDescription: "Items will appear here as soon as they start. Drag and drop your tasks here.",
    badgeClassName:
      "border border-primary/20 bg-primary/10 text-primary",
    accentClassName: "blue",
  },
  blocked: {
    id: "blocked",
    label: "Blocked",
    description: "Work waiting on an external dependency or decision.",
    columnTitle: "Blocked",
    emptyTitle: "Tasks will appear here…",
    emptyDescription: "Tasks waiting on blockers will appear here. Drag and drop your tasks here.",
    badgeClassName:
      "border border-destructive/20 bg-destructive/10 text-destructive",
    accentClassName: "rose",
  },
  done: {
    id: "done",
    label: "Completed",
    description: "Work that has been completed.",
    columnTitle: "Completed",
    emptyTitle: "Tasks will appear here…",
    emptyDescription: "Finished work will appear here. Drag and drop your tasks here.",
    badgeClassName:
      "border border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    accentClassName: "emerald",
  },
};

export const TASK_PRIORITY_PRESENTATION: Record<TaskPriority, TaskPriorityPresentation> = {
  low: {
    id: "low",
    label: "Low",
    badgeClassName:
      "border border-rose-500/20 bg-rose-500/10 text-rose-600 dark:text-rose-400",
  },
  medium: {
    id: "medium",
    label: "Medium",
    badgeClassName:
      "border border-rose-500/30 bg-rose-500/15 text-rose-700 dark:text-rose-300",
  },
  high: {
    id: "high",
    label: "High",
    badgeClassName:
      "border border-red-500/30 bg-red-500/20 text-red-700 dark:text-red-300",
  },
  urgent: {
    id: "urgent",
    label: "Urgent",
    badgeClassName:
      "border border-red-600 bg-red-600 text-white font-semibold",
  },
};

export function isTaskWorkflowStatus(value: string | null | undefined): value is TaskWorkflowStatus {
  return !!value && TASK_WORKFLOW_STATUSES.includes(value as TaskWorkflowStatus);
}

export function isTaskPriority(value: string | null | undefined): value is TaskPriority {
  return !!value && TASK_PRIORITY_VALUES.includes(value as TaskPriority);
}

export function getTaskStatusPresentation(status: string | null | undefined): TaskWorkflowStatusPresentation {
  return TASK_STATUS_PRESENTATION[isTaskWorkflowStatus(status) ? status : "todo"];
}

export function getTaskPriorityPresentation(priority: string | null | undefined): TaskPriorityPresentation {
  return TASK_PRIORITY_PRESENTATION[isTaskPriority(priority) ? priority : "medium"];
}

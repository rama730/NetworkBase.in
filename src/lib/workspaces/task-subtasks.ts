export type TaskSubtask = {
  id: string;
  taskId: string;
  title: string;
  completed: boolean;
  /** Who ticked it, when known (0259). */
  completedBy?: string | null;
  /** Added from the CLI or by an agent (0073, report A9.7). */
  via?: string | null;
  agentName?: string | null;
  position: number;
  createdAt: string;
  updatedAt: string;
};

export function sortTaskSubtasks(items: TaskSubtask[]) {
  return [...items].sort(
    (left, right) =>
      left.position - right.position ||
      left.createdAt.localeCompare(right.createdAt) ||
      left.id.localeCompare(right.id),
  );
}

export function upsertTaskSubtask(
  current: TaskSubtask[],
  nextSubtask: TaskSubtask,
) {
  const found = current.some((subtask) => subtask.id === nextSubtask.id);
  return sortTaskSubtasks(
    found
      ? current.map((subtask) =>
          subtask.id === nextSubtask.id ? nextSubtask : subtask,
        )
      : [...current, nextSubtask],
  );
}

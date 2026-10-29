/** The persisted workflow status stays compatible with existing boards and clients. */
export function isTaskCompleted(task: {
  status?: string | null;
  reviewStatus?: string | null;
}) {
  return task.status === "done" && task.reviewStatus !== "pending";
}

export function completionActionLabel(reviewRequired: boolean) {
  return reviewRequired ? "Submit for review" : "Mark as completed";
}

export function completionOutcomeLabel(reviewStatus?: string | null) {
  return reviewStatus === "pending"
    ? "Task submitted for review"
    : "Task completed";
}

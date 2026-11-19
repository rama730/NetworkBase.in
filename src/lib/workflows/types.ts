/**
 * Workflow item types and their stages (report 38.2 F1, the stage table from 28.3). A stage belongs to one of the
 * four statuses and says whether the item sits on the board. Stage names are fixed per type in this release
 * (call 2); later rounds add their types (project, roadmap item, objective, key result, idea, lesson, …) here.
 */
export type TaskStatus = "todo" | "in_progress" | "done" | "blocked";
export type Stage = { key: string; label: string; status: TaskStatus; onBoard: boolean; closing?: true };
export type WorkflowType = {
  id: string;
  label: string;
  /** Lucide icon name. */
  icon: string;
  stages: Stage[];
  /** Where an item lands when it joins the board, and where it returns when it leaves Completed. */
  joinStage: string | null;
  /** Completed on the board takes this stage. */
  doneStage: string | null;
};

const s = (key: string, label: string, status: TaskStatus, onBoard: boolean, closing?: true): Stage => ({ key, label, status, onBoard, ...(closing && { closing }) });

export const WORKFLOW_TYPES: Record<string, WorkflowType> = {
  task: { id: "task", label: "Task", icon: "SquareCheck", stages: [], joinStage: null, doneStage: null },
  bug: {
    id: "bug", label: "Bug", icon: "Bug", joinStage: "fixing", doneStage: "fixed",
    stages: [
      s("new", "New", "todo", false), s("confirmed", "Confirmed", "todo", false), s("fixing", "Fixing", "in_progress", true),
      s("fixed", "Fixed", "done", true), s("verified", "Verified", "done", true),
      s("wont_fix", "Won’t fix", "done", false, true), s("duplicate", "Duplicate", "done", false, true), s("cant_reproduce", "Can’t reproduce", "done", false, true),
    ],
  },
  request: {
    id: "request", label: "Request", icon: "Inbox", joinStage: "accepted", doneStage: "delivered",
    stages: [
      s("new", "New", "todo", false), s("accepted", "Accepted", "todo", true), s("in_progress", "In progress", "in_progress", true),
      s("in_review", "In review", "in_progress", true), s("delivered", "Delivered", "done", true), s("declined", "Declined", "done", false, true),
    ],
  },
  content: {
    id: "content", label: "Content", icon: "PenLine", joinStage: "drafting", doneStage: "scheduled",
    stages: [
      s("idea", "Idea", "todo", false), s("drafting", "Drafting", "in_progress", true), s("editing", "Editing", "in_progress", true),
      s("scheduled", "Scheduled", "done", true), s("published", "Published", "done", true),
    ],
  },
};

export function workflowType(id: string): WorkflowType {
  const type = WORKFLOW_TYPES[id];
  if (!type) throw new Error(`Unknown type "${id}". Use one of: ${Object.keys(WORKFLOW_TYPES).join(", ")}`);
  return type;
}

export const stagesOf = (type: string) => workflowType(type).stages;

export function stageOf(type: string, key: string): Stage {
  const stage = stagesOf(type).find((x) => x.key === key);
  if (!stage) throw new Error(`Unknown stage "${key}" for ${workflowType(type).label}. Use one of: ${stagesOf(type).map((x) => x.key).join(", ")}`);
  return stage;
}

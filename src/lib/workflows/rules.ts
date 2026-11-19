/** Report 38.2 F1 part 7: the stage rules as pure functions. */
import { WORKFLOW_CATALOG } from "./catalog";
import { stageOf, workflowType, type TaskStatus } from "./types";

export const statusForStage = (type: string, stage: string): TaskStatus => stageOf(type, stage).status;

/** Plain tasks are always on the board; a typed item only at its on-board stages. */
export function isOnBoard(type: string, stage: string | null): boolean {
  if (!workflowType(type).stages.length) return true;
  return stage ? stageOf(type, stage).onBoard : false;
}

export function stageMove(type: string, from: string | null, to: string) {
  const was = isOnBoard(type, from);
  const is = isOnBoard(type, to);
  return { joins: !was && is, leaves: was && !is, needsSprintChoice: !was && is };
}

/** Where an item waits for review: its own stage when that's on the board, else the join stage (reviewers see the board). */
export function reviewStage(type: string, stage: string | null): string | null {
  return isOnBoard(type, stage) ? stage : workflowType(type).joinStage;
}

/**
 * A status change from the board, the panel, bulk, undo or GitHub (call 5, B2, B3): status moves freely; Completed takes
 * the done stage, or waits on the board where review is on; leaving Completed returns to the join stage; anything else
 * keeps an on-board stage. An off-board item (New, Confirmed, Won't fix…) lands on the join stage or the first on-board
 * stage with that status, and stays where it is when its type has none (a bug set to To do stays at New).
 */
export function boardMove(type: string, stage: string | null, toStatus: TaskStatus, reviewRequired: boolean) {
  const t = workflowType(type);
  const review = toStatus === "done" && reviewRequired;
  if (!t.stages.length || !stage) return { stage: null, status: toStatus, review };
  const current = stageOf(type, stage);
  const to = (next: string | null) => ({ stage: next, status: toStatus, review });
  if (toStatus === "done") return to(review ? reviewStage(type, stage) : current.status === "done" ? stage : t.doneStage);
  if (current.status === "done") return to(t.joinStage);
  if (current.onBoard) return to(stage);
  if (toStatus === "blocked") return to(t.joinStage);
  const join = stageOf(type, t.joinStage!);
  return to(join.status === toStatus ? join.key : t.stages.find((x) => x.onBoard && x.status === toStatus)?.key ?? stage);
}

/** New items: from Tasks they start at the join stage (on the board), from their own tab at the first stage. */
export function defaultStageFor(type: string, openedFrom: "tasks" | "own"): string | null {
  const t = workflowType(type);
  if (!t.stages.length) return null;
  return openedFrom === "tasks" ? t.joinStage : t.stages[0]!.key;
}

type WorkflowRow = { workflow: string; hiddenAt: Date | null; pushToChildren: boolean };

/**
 * A workspace's workflows (F1 call 3): its own rows that aren't hidden, plus what its organization pushes, which the
 * workspace can't remove (locked). A child's own row stays underneath a push, so it comes back if the push ends.
 */
export function effectiveWorkflows(own: WorkflowRow[], parent: WorkflowRow[], parentName: string | null) {
  const pushed = new Set(parent.filter((r) => r.pushToChildren && !r.hiddenAt).map((r) => r.workflow));
  const mine = own.filter((r) => !r.hiddenAt).map((r) => r.workflow);
  return WORKFLOW_CATALOG.filter((entry) => pushed.has(entry.id) || mine.includes(entry.id)).map((entry) =>
    pushed.has(entry.id) ? { workflow: entry.id, locked: true, by: parentName } : { workflow: entry.id, locked: false, by: null });
}

/** Owners, admins and an organization's admins acting in a child workspace (decision 3). */
export const canChangeWorkflows = (viewer: { isOwner: boolean; memberRole: string | null; isInheritedAdmin: boolean }) =>
  viewer.isOwner || viewer.memberRole === "admin" || viewer.isInheritedAdmin;

/** What the Remove dialog says a workflow holds (S3). */
export function removalSummary(items: Array<{ status: string; onBoard: boolean }>) {
  return { total: items.length, open: items.filter((i) => i.status !== "done").length, onBoard: items.filter((i) => i.onBoard).length };
}

/** What a viewer gets about a workspace's workflows (the page, the dialog, Settings). */
export type AddedWorkflow = { workflow: string; locked: boolean; by: string | null; addedAt: string | null; addedBy: string | null };
export type WorkspaceWorkflows = { enabled: boolean; canManage: boolean; added: AddedWorkflow[] };

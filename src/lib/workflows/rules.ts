/** Report 38.2 F1 part 7: the stage rules as pure functions. */
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

/**
 * A drag or status change on the board (call 5, B2, B3): status moves freely; Completed takes the done stage, or keeps
 * the stage and asks for review where review is on; leaving Completed returns to the join stage; anything else keeps it.
 */
export function boardMove(type: string, stage: string | null, toStatus: TaskStatus, reviewRequired: boolean) {
  const t = workflowType(type);
  const review = toStatus === "done" && reviewRequired;
  if (!t.stages.length || !stage) return { stage: null, status: toStatus, review };
  if (toStatus === "done") return { stage: review || stageOf(type, stage).status === "done" ? stage : t.doneStage!, status: toStatus, review };
  if (toStatus !== "blocked" && stageOf(type, stage).status === "done") return { stage: t.joinStage!, status: toStatus, review };
  return { stage, status: toStatus, review };
}

/** New items: from Tasks they start at the join stage (on the board), from their own tab at the first stage. */
export function defaultStageFor(type: string, openedFrom: "tasks" | "own"): string | null {
  const t = workflowType(type);
  if (!t.stages.length) return null;
  return openedFrom === "tasks" ? t.joinStage : t.stages[0]!.key;
}

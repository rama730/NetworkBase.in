import "server-only";

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { afterTaskTransition, lockTaskForWrite, transitionTaskTx } from "@/lib/workspaces/task-transition-service";

type Actor = Parameters<typeof afterTaskTransition>[0];

export type PushTransition =
  | { to: "in_progress" | "done"; ok: true; status: string; reviewStatus: string; reviewRequired: boolean; outcome: string | null }
  | { to: "in_progress" | "done"; ok: false; message: string };

/**
 * The status a push asks for: an explicit `transitionStatus`, or In progress when a draft lands on a
 * task still To do. Null when nothing should move.
 */
export function pushTransitionTarget(input: {
  current: string;
  requested?: "in_progress" | "done" | null;
  role: string;
}): "in_progress" | "done" | null {
  if (input.requested) return input.requested === input.current ? null : input.requested;
  return input.role === "working" && input.current === "todo" ? "in_progress" : null;
}

/**
 * Moves a task after a push through the same rules as the task drawer: permissions, review
 * (done on a review-required task becomes "sent for review"), activity and notifications
 * (report finding 31). Runs after the files are saved, so a refused move never undoes a push;
 * the caller reports `ok: false` with the reason.
 */
export async function transitionAfterPush(actor: Actor, taskId: string, to: "in_progress" | "done"): Promise<PushTransition> {
  try {
    const { locked, result } = await db.transaction(async (tx) => {
      const locked = await lockTaskForWrite(tx, taskId, actor.id);
      const result = await transitionTaskTx(tx, locked, { taskId, userId: actor.id, status: to });
      return { locked, result };
    });
    await afterTaskTransition(actor, locked, taskId, result);
    return {
      to,
      ok: true,
      status: result.status,
      reviewStatus: result.reviewStatus,
      reviewRequired: Boolean(result.reviewRequired),
      outcome: result.outcome ?? null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "The task's status didn't change";
    logger.warn("domain.task_transition_after_push_failed", { taskId, to, error: message });
    return { to, ok: false, message };
  }
}

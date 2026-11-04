import "server-only";

import { readWorkspaceUnitsAction } from "@/app/actions/child-units";
import { getTaskCompletionPolicyAction } from "@/app/actions/workspace/task-completion";
import { getWorkspaceWorkflowColumnsAction } from "@/app/actions/workspace/workflow";
import { fetchWorkspaceTasksAction, readBoardCountsAction } from "@/lib/workspaces/server/tasks";

/**
 * The Tasks tab's first reads, started on the server while the page renders (live-fix phase 1, problem 1). A browser
 * runs server actions one at a time, so these used to queue behind each other; each hook takes its own once.
 */
export function startTasksBoot(projectId: string) {
  const quiet = <T,>(read: Promise<T>) => { read.catch(() => undefined); return read; };
  return {
    tasks: quiet(fetchWorkspaceTasksAction(projectId, 50, undefined, "all", "")),
    workflow: quiet(getWorkspaceWorkflowColumnsAction(projectId)),
    policy: quiet(getTaskCompletionPolicyAction(projectId)),
    units: quiet(readWorkspaceUnitsAction(projectId)),
    // Board view dropdown §5: the View menu's numbers start with the rest.
    counts: quiet(readBoardCountsAction(projectId)),
  };
}

export type TasksBoot = ReturnType<typeof startTasksBoot>;

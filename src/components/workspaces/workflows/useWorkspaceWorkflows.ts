"use client";

import { useCallback, useEffect, useState } from "react";

import { readWorkflowsAction } from "@/app/actions/workflows";
import { subscribeBroadcast } from "@/lib/realtime/private-broadcast";
import { liveTopics } from "@/lib/realtime/subscriptions";
import type { WorkspaceWorkflows } from "@/lib/workflows/rules";

const OFF: WorkspaceWorkflows = { enabled: false, canManage: false, added: [] };

/**
 * The workspace's added workflows (report 38.2 F1): first from the read started with the page, then live, since
 * another admin adding or hiding one announces `workflows.changed` on the workspace's topic (W3).
 */
export function useWorkspaceWorkflows(workspaceId: string, started?: Promise<WorkspaceWorkflows> | null) {
  const [state, setState] = useState<WorkspaceWorkflows & { loaded?: boolean }>(OFF);
  const refresh = useCallback(async () => {
    const result = await readWorkflowsAction(workspaceId);
    if (result.success) setState({ enabled: result.enabled, canManage: result.canManage, added: result.added, waiting: result.waiting, loaded: true });
  }, [workspaceId]);

  useEffect(() => {
    let current = true;
    // A promise sent from the server is only promise-like: its then() returns nothing, so wrap it before chaining.
    if (started) void Promise.resolve(started).then((value) => { if (current) setState({ ...value, loaded: true }); }, () => undefined);
    return () => { current = false; };
  }, [started]);

  useEffect(() => {
    if (!state.enabled) return;
    const live = subscribeBroadcast(liveTopics.workspace(workspaceId), (event) => {
      if (event === "workflows.changed") void refresh();
    });
    return () => live.unsubscribe();
  }, [refresh, state.enabled, workspaceId]);

  return { ...state, refresh };
}

export { AddedWorkflowsContext, useAddedWorkflows, useKnownWorkflows } from "@/components/workspaces/workflows/added-workflows";

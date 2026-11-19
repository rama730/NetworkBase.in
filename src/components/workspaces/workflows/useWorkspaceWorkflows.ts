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
  const [state, setState] = useState<WorkspaceWorkflows>(OFF);
  const refresh = useCallback(async () => {
    const result = await readWorkflowsAction(workspaceId);
    if (result.success) setState({ enabled: result.enabled, canManage: result.canManage, added: result.added });
  }, [workspaceId]);

  useEffect(() => {
    let current = true;
    started?.then((value) => { if (current) setState(value); }).catch(() => undefined);
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

"use client";

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/hooks/use-auth";
import { subscribeBroadcast } from "@/lib/realtime/private-broadcast";
import { liveTopics } from "@/lib/realtime/subscriptions";
import { queryKeys } from "@/lib/query-keys";

export function useRealtimeTasks(projectId: string, deferredTaskId: string | null = null) {
  const { user } = useAuth();
  const userId = user?.id;
  const queryClient = useQueryClient();
  const reconcileTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deferredTaskRef = useRef<string | null>(deferredTaskId);
  const deferredTaskChangedRef = useRef(false);

  useEffect(() => {
    const previouslyDeferred = deferredTaskRef.current;
    deferredTaskRef.current = deferredTaskId;
    if (previouslyDeferred && !deferredTaskId && deferredTaskChangedRef.current) {
      deferredTaskChangedRef.current = false;
      void queryClient.invalidateQueries({
        queryKey: queryKeys.project.detail.tasksRoot(projectId),
        refetchType: "active",
      });
    }
  }, [deferredTaskId, projectId, queryClient]);

  useEffect(() => {
    if (!projectId || !userId) return;

    const scheduleReconcile = () => {
      if (reconcileTimerRef.current) return;
      reconcileTimerRef.current = setTimeout(() => {
        reconcileTimerRef.current = null;
        void queryClient.invalidateQueries({
          queryKey: queryKeys.project.detail.tasksRoot(projectId),
          refetchType: "active",
        });
      }, 250);
    };

    const live = subscribeBroadcast(liveTopics.tasks(projectId), (event, payload) => {
      if (event !== "task.changed") return;
      // While a drag or its move is in flight, any refetch would replace the board under the
      // pointer with pre-move data; hold every reconcile until the move settles.
      if (deferredTaskRef.current) {
        deferredTaskChangedRef.current = true;
        return;
      }

      if (payload.op === "DELETE") {
        queryClient.setQueriesData(
          { queryKey: queryKeys.project.detail.tasksRoot(projectId) },
          (oldData: any) => {
            if (!oldData || !oldData.pages) return oldData;
            return {
              ...oldData,
              pages: oldData.pages.map((page: any) => ({
                ...page,
                tasks: page.tasks?.filter((t: any) => t.id !== payload.id),
              })),
            };
          }
        );
        return;
      }

      // Events carry ids only: the board re-reads what this viewer may see.
      scheduleReconcile();
    });

    return () => {
      if (reconcileTimerRef.current) clearTimeout(reconcileTimerRef.current);
      reconcileTimerRef.current = null;
      live.unsubscribe();
    };
  }, [projectId, queryClient, userId]);
}

"use client";

import { useEffect, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { subscribeActiveResource } from "@/lib/realtime/subscriptions";
import { createClient } from "@/lib/supabase/client";
import { queryKeys } from "@/lib/query-keys";

export function useRealtimeTasks(projectId: string, deferredTaskId: string | null = null) {
  const supabase = useMemo(() => createClient(), []);
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
    if (!projectId) return;

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

    const channel = subscribeActiveResource({
      supabase,
      resourceType: "workspace",
      resourceId: `project-tasks:${projectId}`,
      bindings: [
        {
          event: "*",
          table: "tasks",
          filter: `project_id=eq.${projectId}`,
          handler: (payload) => {
            // While a drag or its move is in flight, any refetch would replace the board under the
            // pointer with pre-move data; hold every reconcile until the move settles.
            if (deferredTaskRef.current) {
              deferredTaskChangedRef.current = true;
              return;
            }

            // ponytail: Dumb invalidation. If 30 changes happen, this absorbs it into 1 fetch. Zero stutter. ceiling: coalesced single fetch on settled drag. upgrade: granular task delta patch if payload contains all fields.
            scheduleReconcile();
          },
        },
      ],
    });

    return () => {
      if (reconcileTimerRef.current) clearTimeout(reconcileTimerRef.current);
      reconcileTimerRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [projectId, queryClient, supabase]);
}

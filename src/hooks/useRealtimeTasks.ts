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

            if (payload.eventType === "UPDATE" && payload.new) {
              const updated = payload.new as any;
              queryClient.setQueriesData(
                { queryKey: queryKeys.project.detail.tasksRoot(projectId) },
                (oldData: any) => {
                  if (!oldData || !oldData.pages) return oldData;
                  return {
                    ...oldData,
                    pages: oldData.pages.map((page: any) => ({
                      ...page,
                      tasks: page.tasks?.map((t: any) =>
                        t.id === updated.id
                          ? {
                              ...t,
                              ...updated,
                              taskNumber: typeof updated.task_number === "number" ? updated.task_number : t.taskNumber,
                              columnId: updated.column_id ?? t.columnId,
                              assigneeId: updated.assignee_id ?? t.assigneeId,
                              dueDate: updated.due_date ?? t.dueDate,
                              storyPoints: updated.story_points ?? t.storyPoints,
                            }
                          : t
                      ),
                    })),
                  };
                }
              );
              return;
            }

            if (payload.eventType === "DELETE" && payload.old) {
              const deletedId = (payload.old as any).id;
              queryClient.setQueriesData(
                { queryKey: queryKeys.project.detail.tasksRoot(projectId) },
                (oldData: any) => {
                  if (!oldData || !oldData.pages) return oldData;
                  return {
                    ...oldData,
                    pages: oldData.pages.map((page: any) => ({
                      ...page,
                      tasks: page.tasks?.filter((t: any) => t.id !== deletedId),
                    })),
                  };
                }
              );
              return;
            }

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

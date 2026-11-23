"use client";

import { useQuery } from "@tanstack/react-query";

import { readWorkflowsAction } from "@/app/actions/workflows";
import { queryKeys } from "@/lib/query-keys";

/** Report 38.6 W10 (A2.3): Report as bug shows in a workspace channel only once Bugs is added there. */
export function useBugsAdded(projectId: string | null | undefined) {
  const query = useQuery({
    queryKey: queryKeys.project.detail.addedWorkflows(projectId ?? ""),
    queryFn: async () => {
      const result = await readWorkflowsAction(projectId!);
      return result.success && result.enabled ? result.added.map((w) => w.workflow) : [];
    },
    enabled: Boolean(projectId),
    staleTime: 60_000,
  });
  return Boolean(query.data?.includes("bugs"));
}

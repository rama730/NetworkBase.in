"use client";

import { useQuery, type QueryClient } from "@tanstack/react-query";
import { getTaskCompletionPolicyAction } from "@/app/actions/workspace/task-completion";

export const taskCompletionPolicyKey = (projectId: string) =>
  ["project", projectId, "task-completion-policy"] as const;

export function useTaskCompletionPolicy(projectId: string) {
  return useQuery({
    queryKey: taskCompletionPolicyKey(projectId),
    enabled: Boolean(projectId),
    staleTime: 30_000,
    queryFn: async () => {
      const result = await getTaskCompletionPolicyAction(projectId);
      if (!result.success) throw new Error(result.error);
      return result;
    },
  });
}

/** A completion can race a lead’s policy change; reflect the policy actually used. */
export function syncTaskCompletionPolicy(
  client: QueryClient,
  projectId: string,
  result: { reviewRequired?: boolean; policyVersion?: number },
) {
  if (result.reviewRequired === undefined) return;
  client.setQueryData<
    Extract<
      Awaited<ReturnType<typeof getTaskCompletionPolicyAction>>,
      { success: true }
    >
  >(taskCompletionPolicyKey(projectId), (current) =>
    current
      ? {
          ...current,
          reviewRequired: result.reviewRequired!,
          version: result.policyVersion ?? current.version,
        }
      : current,
  );
}

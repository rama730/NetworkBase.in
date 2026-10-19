"use client";

import { useQuery } from "@tanstack/react-query";

import { getRoleApplicationCountsAction } from "@/app/actions/applications";

/** Pending and accepted applications per role, for the roles editor. Empty for anyone who can't review them. */
export function useRoleApplicationCounts(projectId: string, enabled = true) {
    const query = useQuery({
        queryKey: ["project", projectId, "role-application-counts"],
        enabled,
        staleTime: 60_000,
        queryFn: async () => {
            const result = await getRoleApplicationCountsAction(projectId);
            if (!result.success) throw new Error("Could not read the applications");
            return result.counts;
        },
    });
    return query.data ?? {};
}

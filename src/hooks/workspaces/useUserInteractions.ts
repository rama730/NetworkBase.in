'use client';

import { useQueries } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { queryKeys } from '@/lib/query-keys';

const EMPTY = new Set<string>();

/**
 * Which of the loaded projects you follow: one small query per feed page (at most a page of ids each).
 * A new page adds a query; the pages already shown keep their answer, so icons never flicker.
 */
export function useUserFollowedProjects(
    userId: string | null | undefined,
    pages: readonly (readonly string[])[],
) {
    return useQueries({
        queries: pages.map((ids) => {
            const pageIds = Array.from(new Set(ids)).sort();
            return {
                queryKey: [...queryKeys.discover.userFollowedProjects(userId), pageIds.join(',')],
                queryFn: async (): Promise<Set<string>> => {
                    const { data, error } = await createClient()
                        .from('project_follows')
                        .select('project_id')
                        .eq('user_id', userId!)
                        .in('project_id', pageIds);
                    if (error) throw error;
                    return new Set((data || []).map((row: { project_id: string }) => row.project_id));
                },
                enabled: Boolean(userId) && pageIds.length > 0,
                staleTime: 60_000,
                gcTime: 5 * 60_000,
            };
        }),
        combine: (results) => {
            if (!results.some((result) => result.data?.size)) return EMPTY;
            const all = new Set<string>();
            for (const result of results) for (const id of result.data ?? []) all.add(id);
            return all;
        },
    });
}

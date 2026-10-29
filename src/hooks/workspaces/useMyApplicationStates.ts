'use client';

import { useQueries } from '@tanstack/react-query';

import { getMyApplicationStatesAction, type ApplicationCardChip } from '@/app/actions/applications';
import { queryKeys } from '@/lib/query-keys';

const NONE = new Map<string, ApplicationCardChip>();

/**
 * Where your own application (or an invitation) stands on the project cards shown, for the chip on each card.
 * One small query per page of cards, like the follow state; signed out, nothing is asked.
 */
export function useMyApplicationStates(
    userId: string | null | undefined,
    pages: readonly (readonly string[])[],
) {
    return useQueries({
        queries: pages.map((ids) => {
            const pageIds = Array.from(new Set(ids)).sort();
            return {
                queryKey: [...queryKeys.discover.myApplications(userId), pageIds.join(',')],
                queryFn: () => getMyApplicationStatesAction(pageIds),
                enabled: Boolean(userId) && pageIds.length > 0,
                staleTime: 60_000,
                gcTime: 5 * 60_000,
            };
        }),
        combine: (results) => {
            if (!results.some((result) => result.data && Object.keys(result.data).length)) return NONE;
            const all = new Map<string, ApplicationCardChip>();
            for (const result of results) for (const [id, chip] of Object.entries(result.data ?? {})) all.set(id, chip);
            return all;
        },
    });
}

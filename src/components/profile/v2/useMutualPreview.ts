'use client'

import { useQuery } from '@tanstack/react-query'

/** People you both know with this profile (first few + total). One request, shared by the band's Mutual stat and the right card. */
export function useMutualPreview(profileId: string | undefined, enabled: boolean) {
    return useQuery({
        queryKey: ['profile', 'mutual-preview', profileId],
        queryFn: async () => {
            const { readPersonSharedConnectionsAction } = await import('@/app/actions/connections')
            const result = await readPersonSharedConnectionsAction({ targetId: profileId! })
            if (!result.success) throw new Error(result.error)
            return result.summary
        },
        enabled: Boolean(enabled && profileId),
        staleTime: 60_000,
    })
}

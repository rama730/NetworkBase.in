'use client'

import { usePathname } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import PendingDeletionBanner from '@/components/settings/PendingDeletionBanner'
import { useAccountDeletionStatus } from '@/hooks/useSettingsQueries'
import { queryKeys } from '@/lib/query-keys'

/** A thin strip under the top bar while the account is scheduled for deletion, so it is never a surprise. Settings already shows the same banner in place. */
export function PendingDeletionNotice() {
    const pathname = usePathname()
    const queryClient = useQueryClient()
    const { data } = useAccountDeletionStatus()
    if (!data?.pending || !data.hardDeleteAt || pathname === '/settings') return null
    return (
        <div className="border-b border-border bg-background px-4">
            <PendingDeletionBanner
                hardDeleteAt={data.hardDeleteAt}
                onCancelled={() => queryClient.setQueryData(queryKeys.settings.accountDeletion(), { pending: false })}
            />
        </div>
    )
}

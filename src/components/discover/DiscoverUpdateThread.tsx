'use client';

import { useMemo } from 'react';
import { UpdateDetailPanel } from '@/components/workspaces/updates/UpdateDetailPanel';
import { toWorkspaceUpdateView } from '@/lib/discover/update-view';
import { queryKeys } from '@/lib/query-keys';
import { useUpdatePostLive } from '@/hooks/useUpdateLive';
import type { DiscoverUpdateView } from '@/types/discover';

/**
 * One update's thread in the Discover rail or drawer: the shared thread panel, fed from the Discover feed's own
 * cache, so a comment posted here changes the count on the card behind it. Comments from other people arrive
 * live while it is open (and only then).
 */
export function DiscoverUpdateThread({
    update,
    viewerId,
    currentUserName,
    currentUserAvatarUrl,
    updatesQueryKey,
    onClose,
}: {
    update: DiscoverUpdateView;
    viewerId: string | null;
    currentUserName?: string | null;
    currentUserAvatarUrl?: string | null;
    /** The feed cache the panel's optimistic edits write to (pages of updates). */
    updatesQueryKey: readonly unknown[];
    onClose: () => void;
}) {
    const view = useMemo(() => toWorkspaceUpdateView(update), [update]);
    const { id: updateId, projectId } = update;

    useUpdatePostLive(projectId, updateId, Boolean(viewerId));

    return (
        <UpdateDetailPanel
            autoFocus
            projectId={projectId}
            projectSlug={update.projectSlug}
            update={view}
            updatesQueryKey={updatesQueryKey}
            onClose={onClose}
            currentUserId={viewerId}
            currentUserName={currentUserName}
            currentUserAvatarUrl={currentUserAvatarUrl}
        />
    );
}

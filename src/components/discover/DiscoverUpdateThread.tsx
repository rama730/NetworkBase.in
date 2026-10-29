'use client';

import { useEffect, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { UpdateDetailPanel } from '@/components/workspaces/updates/UpdateDetailPanel';
import { updatePages } from '@/components/workspaces/updates/update-helpers';
import { toWorkspaceUpdateView } from '@/lib/discover/update-view';
import { createClient } from '@/lib/supabase/client';
import { queryKeys } from '@/lib/query-keys';
import { subscribeActiveResource } from '@/lib/realtime/subscriptions';
import type { DiscoverUpdateView } from '@/types/discover';

const stringField = (record: unknown, key: string) => {
    const value = record && typeof record === 'object' ? (record as Record<string, unknown>)[key] : null;
    return typeof value === 'string' ? value : null;
};

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
    const queryClient = useQueryClient();
    const view = useMemo(() => toWorkspaceUpdateView(update), [update]);
    const { id: updateId, projectId } = update;

    useEffect(() => {
        const supabase = createClient();
        const channel = subscribeActiveResource({
            supabase,
            resourceType: 'project_hydration',
            resourceId: `discover:update:${updateId}`,
            bindings: [{
                event: '*',
                table: 'project_update_comments',
                filter: `update_id=eq.${updateId}`,
                handler: (payload: { eventType?: string; new?: unknown; old?: unknown }) => {
                    // A comment this person just wrote is already on screen.
                    const author = stringField(payload.new, 'user_id') ?? stringField(payload.old, 'user_id');
                    if (author && author === viewerId) return;
                    void queryClient.invalidateQueries({ queryKey: queryKeys.project.detail.updateComments(projectId, updateId) });
                    if (payload.eventType !== 'INSERT' && payload.eventType !== 'DELETE') return;
                    const delta = payload.eventType === 'INSERT' ? 1 : -1;
                    const bump = <T extends { id: string; commentCount: number }>(item: T) =>
                        item.id === updateId ? { ...item, commentCount: Math.max(0, item.commentCount + delta) } : item;
                    queryClient.setQueriesData<never>({ queryKey: queryKeys.discover.pulseRoot() }, ((old: never) => updatePages(old, bump)) as never);
                    queryClient.setQueriesData<DiscoverUpdateView>({ queryKey: ['discover', 'update'] }, (old) => (old ? bump(old) : old));
                },
            }],
        });
        return () => {
            supabase.removeChannel(channel);
        };
    }, [projectId, queryClient, updateId, viewerId]);

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

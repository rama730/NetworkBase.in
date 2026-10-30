'use client';

import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { toggleWorkspaceUpdateLikeAction } from '@/app/actions/workspace/updates';
import { updatePages } from '@/components/workspaces/updates/update-helpers';
import { feedbackError, toast } from '@/lib/feedback';
import { queryKeys } from '@/lib/query-keys';

type LikeFields = { id: string; likedByViewer: boolean; likeCount: number };

/**
 * Likes an update from anywhere it is shown (a Discover card, its thread, the project's Updates tab).
 *
 * The like lives in the query caches, not in a component: a card that scrolls out of view and back, the open
 * thread and the project tab all read the same number. A tap is applied at once, replaced by the server's own
 * answer when it arrives, and put back exactly as it was if the server refuses. A second tap while one is in
 * flight is ignored.
 */
export function useToggleUpdateLike(projectId: string, updateId: string) {
    const queryClient = useQueryClient();
    const roots: QueryKey[] = [queryKeys.discover.pulseRoot(), queryKeys.project.detail.updates(projectId)];
    const singleRoot: QueryKey = ['discover', 'update'];

    const patch = (change: (item: LikeFields) => LikeFields) => {
        for (const root of roots) {
            queryClient.setQueriesData<never>({ queryKey: root }, ((old: never) =>
                updatePages(old, (item) => (item.id === updateId ? (change(item) as typeof item) : item))) as never);
        }
        queryClient.setQueriesData<LikeFields>({ queryKey: singleRoot }, (old) => (old && old.id === updateId ? change(old) : old));
    };

    const mutation = useMutation({
        mutationFn: async () => {
            const result = await toggleWorkspaceUpdateLikeAction(projectId, updateId);
            if (!result.success) throw new Error(result.error || 'Failed to update like');
            return result;
        },
        onMutate: async () => {
            await Promise.all([...roots, singleRoot].map((queryKey) => queryClient.cancelQueries({ queryKey })));
            const snapshots = [...roots, singleRoot].flatMap((queryKey) => queryClient.getQueriesData({ queryKey }));
            patch((item) => ({
                ...item,
                likedByViewer: !item.likedByViewer,
                likeCount: Math.max(0, item.likeCount + (item.likedByViewer ? -1 : 1)),
            }));
            return { snapshots };
        },
        onError: (error, _vars, context) => {
            // Back to exactly what was there before the tap, not to what the page first loaded with.
            for (const [key, data] of context?.snapshots ?? []) queryClient.setQueryData(key, data);
            toast.error(feedbackError(error instanceof Error ? error.message : 'Failed to update like', 'Failed to update like'));
        },
        onSuccess: (result) => {
            patch((item) => ({ ...item, likedByViewer: result.liked, likeCount: result.likeCount }));
            void queryClient.invalidateQueries({ queryKey: queryKeys.project.detail.updateLikes(projectId, updateId) });
        },
    });

    return {
        toggle: () => {
            if (!mutation.isPending) mutation.mutate();
        },
        isPending: mutation.isPending,
    };
}

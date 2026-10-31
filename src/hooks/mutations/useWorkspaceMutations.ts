'use client';

import { useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import type { Workspace } from '@/types/discover';
import { toggleWorkspaceFollowAction } from '@/app/actions/workspace';
import { queryKeys } from '@/lib/query-keys';
import { updatePages } from '@/components/workspaces/updates/update-helpers';

interface ToggleFollowParams {
    projectId: string;
    currentStatus: boolean;
    userId: string;
}



export function useToggleWorkspaceFollow() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (params: ToggleFollowParams) => {
            const result = await toggleWorkspaceFollowAction(params.projectId, !params.currentStatus);
            if (!result.success) throw new Error(result.error);
            return result;
        },
        // Patch what's on screen instead of refetching every loaded page: the follow set and the count.
        onSuccess: (result, { projectId, currentStatus, userId }) => {
            queryClient.setQueriesData<Set<string>>({ queryKey: queryKeys.discover.userFollowedProjects(userId) }, (old) => {
                if (!old) return old;
                const next = new Set(old);
                if (currentStatus) next.delete(projectId);
                else next.add(projectId);
                return next;
            });
            // Post cards for this workspace say Follow or Following too.
            queryClient.setQueriesData<never>({ queryKey: queryKeys.discover.pulseRoot() }, ((old: never) => updatePages(old, (item) => (
                item.projectId === projectId ? { ...item, viewerFollowsProject: !currentStatus } as typeof item : item
            ))) as never);
            if (typeof result.followersCount === 'number') {
                const followersCount = result.followersCount;
                queryClient.setQueriesData<InfiniteData<{ projects: Workspace[] }>>({ queryKey: queryKeys.discover.projectsSimpleRoot() }, (old) => old && ({
                    ...old,
                    pages: old.pages.map((page) => ({
                        ...page,
                        projects: page.projects.map((project) => (project.id === projectId ? { ...project, followersCount } : project)),
                    })),
                }));
            }
            queryClient.invalidateQueries({ queryKey: queryKeys.globalSearch.discoverRoot() });
            // The Following view's list itself changed: refresh only that view (key: discover, projects-simple, viewer, view).
            void queryClient.invalidateQueries({
                queryKey: queryKeys.discover.projectsSimpleRoot(),
                predicate: (query) => query.queryKey[3] === 'following',
            });
        },
    });
}

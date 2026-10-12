'use client';

import { useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import type { Project } from '@/types/discover';
import { toggleProjectFollowAction } from '@/app/actions/project';
import { queryKeys } from '@/lib/query-keys';

interface ToggleFollowParams {
    projectId: string;
    currentStatus: boolean;
    userId: string;
}



export function useToggleProjectFollow() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (params: ToggleFollowParams) => {
            const result = await toggleProjectFollowAction(params.projectId, !params.currentStatus);
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
            if (typeof result.followersCount === 'number') {
                const followersCount = result.followersCount;
                queryClient.setQueriesData<InfiniteData<{ projects: Project[] }>>({ queryKey: queryKeys.discover.projectsSimpleRoot() }, (old) => old && ({
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

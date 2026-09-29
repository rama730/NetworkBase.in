'use client';

import { useState, useMemo, memo, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Search, Plus, CheckSquare, X } from 'lucide-react';
import { Virtuoso } from 'react-virtuoso';
import { useQueryClient } from '@tanstack/react-query';

// Hooks
import { useDiscoverProjects } from '@/hooks/discover/useDiscoverProjects';
import { useAuth } from '@/hooks/useAuth';
import { useDiscoverSessionSeen } from '@/hooks/discover/useDiscoverSessionSeen';
import { useUserFollowedProjects } from '@/hooks/projects/useUserInteractions';
import { useDiscoverUrlFilters } from '@/hooks/discover/useDiscoverUrlFilters';

// Components
import ProjectCard from '@/components/projects/ProjectCard';
import ProjectCardSkeleton from '@/components/projects/ProjectCardSkeleton';
import DiscoverHeader from '@/components/discover/DiscoverHeader';
import { DiscoverErrorBoundary } from '@/components/discover/DiscoverErrorBoundary';
import { DiscoverPeopleRail } from '@/components/discover/DiscoverPeopleRail';
import { AppScrollArea } from '@/components/ui/AppScrollArea';
// Constants & Types
import {
    FILTER_VIEWS,
    PROJECT_STATUS,
    PROJECT_TYPE,
    SORT_OPTIONS,
    VIEW_MODES,
    FilterView,
} from '@/constants/discover';
import { ROUTES } from '@/constants/routes';
import { User, Project } from '@/types/discover';

// Dynamic Modals

import { toProjectCardViewModel, ProjectCardViewModel } from '@/lib/view-models/project-card';
import { queryKeys } from '@/lib/query-keys';
import type { ConnectionFeedPage, DiscoverConnectionItem } from '@/hooks/useConnections';
import { toDiscoverUser } from '@/lib/view-models/discover-user';


interface DiscoverClientProps {
    returnUserData: User | null;
    initialProjectsPage?: {
        projects?: Project[];
        nextCursor?: string;
        hasMore?: boolean;
    } | null;
    initialPeopleSuggestions?: ConnectionFeedPage<DiscoverConnectionItem>;
}

const VIRTUOSO_CONTAINER_STYLE = { width: "100%" } as const;
const VIRTUOSO_INCREASE_VIEWPORT_BY = { top: 1200, bottom: 800 } as const;
const computeProjectItemKey = (_: number, project: Project) => project.id;

const DiscoverClient = memo(function DiscoverClient({ returnUserData, initialProjectsPage, initialPeopleSuggestions }: DiscoverClientProps) {
    const queryClient = useQueryClient();
    const { user } = useAuth();

    // --- State ---
    // Essential UI State
    const viewMode = VIEW_MODES.GRID;

    // Selection & Modal State

    const [profileChecklistItems, setProfileChecklistItems] = useState<string[]>([]);
    const [showProfileChecklist, setShowProfileChecklist] = useState(false);

    // --- Derived Data ---
    const { urlFilters, updateUrlFilters } = useDiscoverUrlFilters();
    const filterView = urlFilters.view;
    const statusFilter = urlFilters.status;
    const typeFilter = urlFilters.type;
    const sortBy = urlFilters.sort;
    const selectedTech = urlFilters.tech;
    const search = urlFilters.q || undefined;
    const hideOpened = urlFilters.hideOpened;

    const currentUser = useMemo(
        () => toDiscoverUser(user, returnUserData),
        [user, returnUserData],
    );

    const { seenIds, setHideSeen, markSeen } = useDiscoverSessionSeen();

    useEffect(() => {
        setHideSeen(hideOpened);
    }, [hideOpened, setHideSeen]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        try {
            const raw = window.localStorage.getItem('onboarding:profile-strength:v1');
            if (!raw) return;
            const parsed = JSON.parse(raw) as { createdAt?: number; items?: string[] };
            if (!Array.isArray(parsed.items) || parsed.items.length === 0) return;
            setProfileChecklistItems(parsed.items.slice(0, 5));
            setShowProfileChecklist(true);
        } catch {
            // ignore invalid local data
        }
    }, []);


    // Construct Filters
    const currentFilters = useMemo(() => {
        const effectiveSort =
            filterView === FILTER_VIEWS.TRENDING
                ? SORT_OPTIONS.TRENDING
                : sortBy;

        return {
            status: statusFilter,
            type: typeFilter,
            tech: selectedTech,
            sort: effectiveSort,
            search, // Connected Global Search
            hideOpened,
        };
    }, [filterView, hideOpened, search, selectedTech, sortBy, statusFilter, typeFilter]);

    // --- Data Fetching ---
    const {
        data,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage,
        isLoading,
        error: projectsError,
    } = useDiscoverProjects(currentFilters, filterView, initialProjectsPage);
    const allProjects = useMemo(() => {
        return data?.pages?.flatMap((p) => p.projects) || [];
    }, [data]);

    const visibleProjects = useMemo(() => {
        if (!hideOpened) return allProjects;
        return allProjects.filter((project) => !seenIds.has(project.id));
    }, [allProjects, hideOpened, seenIds]);

    const visibleProjectIds = useMemo(
        () => visibleProjects.map((project) => project.id),
        [visibleProjects],
    );
    const { data: myFollowedProjects } = useUserFollowedProjects(currentUser?.id, visibleProjectIds);

    useEffect(() => {
        if (!hideOpened) return;
        if (visibleProjects.length > 0) return;
        if (!hasNextPage || isFetchingNextPage) return;
        if (allProjects.length === 0) return;
        fetchNextPage();
    }, [hideOpened, visibleProjects.length, hasNextPage, isFetchingNextPage, allProjects.length, fetchNextPage]);

    // Synchronize fresh SSR initialProjectsPage into React Query cache on client navigation
    useEffect(() => {
        if (!initialProjectsPage?.projects?.length) return;
        queryClient.setQueriesData<any>(
            { queryKey: queryKeys.discover.projectsSimpleRoot() },
            (oldData: any) => {
                if (!oldData?.pages?.length) return oldData;
                const freshMap = new Map(initialProjectsPage.projects!.map((p) => [p.id, p]));
                return {
                    ...oldData,
                    pages: oldData.pages.map((page: any, idx: number) => {
                        if (idx !== 0) return page;
                        return {
                            ...page,
                            projects: (page.projects || []).map((cachedProject: any) => {
                                const fresh = freshMap.get(cachedProject.id);
                                if (!fresh) return cachedProject;
                                return {
                                    ...cachedProject,
                                    coverImage: fresh.coverImage ?? cachedProject.coverImage,
                                    title: fresh.title ?? cachedProject.title,
                                    shortDescription: fresh.shortDescription ?? cachedProject.shortDescription,
                                    description: fresh.description ?? cachedProject.description,
                                    updatedAt: fresh.updatedAt ?? cachedProject.updatedAt,
                                };
                            }),
                        };
                    }),
                };
            }
        );
    }, [initialProjectsPage, queryClient]);

    // Real-time synchronization across tabs & project settings updates (1M scale)
    useEffect(() => {
        if (typeof window === "undefined") return;

        const handleProjectUpdate = (event: Event) => {
            const customEvent = event as CustomEvent<{
                projectId?: string;
                update?: { coverImage?: string | null };
            }>;
            const targetId = customEvent.detail?.projectId;
            const patch = customEvent.detail?.update;
            if (!targetId) return;

            if (patch && patch.coverImage !== undefined) {
                queryClient.setQueriesData<any>(
                    { queryKey: queryKeys.discover.projectsSimpleRoot() },
                    (oldData: any) => {
                        if (!oldData?.pages) return oldData;
                        return {
                            ...oldData,
                            pages: oldData.pages.map((page: any) => ({
                                ...page,
                                projects: (page.projects || []).map((p: any) =>
                                    p.id === targetId || p.slug === targetId
                                        ? { ...p, coverImage: patch.coverImage }
                                        : p
                                ),
                            })),
                        };
                    }
                );
            }

            void queryClient.invalidateQueries({
                queryKey: queryKeys.discover.projectsSimpleRoot(),
            });
        };

        window.addEventListener("nb-project-updated", handleProjectUpdate as EventListener);

        let channel: BroadcastChannel | null = null;
        if (typeof BroadcastChannel !== "undefined") {
            try {
                channel = new BroadcastChannel("nb-project-updated-v1");
                channel.onmessage = (msgEvent) => {
                    const data = msgEvent.data;
                    if (data?.projectId) {
                        handleProjectUpdate(
                            new CustomEvent("nb-project-updated", { detail: data })
                        );
                    }
                };
            } catch {
                // Ignore restricted environments
            }
        }

        return () => {
            window.removeEventListener("nb-project-updated", handleProjectUpdate as EventListener);
            if (channel) {
                channel.close();
            }
        };
    }, [queryClient]);

    const projectViewModels = useMemo(() => {
        return visibleProjects.reduce((acc, p) => {
            acc[p.id] = toProjectCardViewModel(p);
            return acc;
        }, {} as Record<string, ProjectCardViewModel>);
    }, [visibleProjects]);

    const virtuosoComponents = useMemo(() => ({
        Footer: () => {
            if (!isFetchingNextPage) return null;
            return (
                <div className="pb-8 pt-4 text-center text-zinc-500 text-sm">
                    Loading more projects...
                </div>
            );
        },
    }), [isFetchingNextPage]);

    const handleEndReached = useCallback(() => {
        if (hasNextPage && !isFetchingNextPage) {
            fetchNextPage();
        }
    }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

    const renderProjectItem = useCallback((_: number, project: Project) => {
        const vm = projectViewModels[project.id] || toProjectCardViewModel(project);
        return (
            <div className="pb-4">
                <ProjectCard
                    project={project}
                    viewModel={vm}
                    viewMode={viewMode}
                    isFollowing={myFollowedProjects?.has(project.id)}
                    followersCount={project.followersCount ?? 0}
                    onOpenProject={markSeen}
                />
            </div>
        );
    }, [markSeen, myFollowedProjects, projectViewModels, viewMode]);

    // --- Handlers ---

    // Scroll Handling
    const [scrollContainer, setScrollContainer] = useState<HTMLDivElement | null>(null);
    const scrollContainerRef = useCallback((node: HTMLDivElement | null) => {
        setScrollContainer((prev) => (prev === node ? prev : node));
    }, []);


    // Clear Filters
    const handleClearFilters = useCallback(() => {
        updateUrlFilters({
            status: PROJECT_STATUS.ALL,
            type: PROJECT_TYPE.ALL,
            sort: SORT_OPTIONS.NEWEST,
            tech: [],
            hideOpened: false,
        });
    }, [updateUrlFilters]);

    // Clear Filters
    const handleSelectView = (view: FilterView) => {
        updateUrlFilters({ view });
    };

    // --- Render ---

    return (
        <DiscoverErrorBoundary>
            <div className="h-full min-h-0 overflow-hidden bg-zinc-50 dark:bg-zinc-950">
                {projectsError && (
                    <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-50 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200 px-4 py-2 rounded-lg shadow-none">
                        Error loading projects: {projectsError.message}
                    </div>
                )}

                <div className="w-full mx-auto flex h-full min-h-0">
                    {/* Main Content */}
                    <div className="flex-1 min-w-0 h-full min-h-0 flex flex-col overflow-hidden">
                        <AppScrollArea
                            axis="y"
                            ref={scrollContainerRef}
                            id="discover-scroll-container"
                            data-testid="discover-feed-scroll"
                            data-scroll-root="route"
                            className="flex-1 min-h-0 px-4 sm:px-6 pb-8 relative"
                        >
                            <div className="mx-auto flex w-full max-w-[1240px] flex-col">
                                <div className="h-6 shrink-0" aria-hidden="true" />

                                <div className={currentUser?.id ? "nb-discover-columns" : "nb-discover-columns nb-discover-columns--single"}>
                                <div className="min-w-0">
                                    <div
                                        data-testid="discover-header-shell"
                                        className="mb-[18px] py-2"
                                    >
                                        <div className="pb-4">
                                            <DiscoverHeader
                                                filterView={filterView}
                                                onSelectView={handleSelectView}
                                                people={currentUser?.id ? <DiscoverPeopleRail initialPage={initialPeopleSuggestions} variant="compact" /> : null}
                                            />
                                        </div>
                                    </div>

                                    <div className="flex min-w-0 flex-col gap-4">

                            {showProfileChecklist && profileChecklistItems.length > 0 && (
                                <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 dark:border-emerald-800 dark:bg-emerald-950/30 p-4">
                                    <div className="flex items-start justify-between gap-4">
                                        <div className="space-y-2">
                                            <p className="text-sm font-semibold flex items-center gap-2 text-emerald-800 dark:text-emerald-300">
                                                <CheckSquare className="w-4 h-4" />
                                                Profile strength checklist
                                            </p>
                                            <ul className="text-sm text-emerald-900/90 dark:text-emerald-200/90 space-y-1">
                                                {profileChecklistItems.map((item) => (
                                                    <li key={item}>- {item}</li>
                                                ))}
                                            </ul>
                                            <Link
                                                href={ROUTES.MY_PROFILE}
                                                className="inline-flex items-center rounded-md border border-emerald-300 bg-white px-3 py-1.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-200"
                                            >
                                                Complete profile details
                                            </Link>
                                        </div>
                                        <button
                                            type="button"
                                            className="rounded-md p-1 text-emerald-700 hover:bg-emerald-100 dark:text-emerald-300 dark:hover:bg-emerald-900"
                                            aria-label="Dismiss profile checklist"
                                            onClick={() => {
                                                setShowProfileChecklist(false);
                                                if (typeof window !== 'undefined') {
                                                    window.localStorage.removeItem('onboarding:profile-strength:v1');
                                                }
                                            }}
                                        >
                                            <X className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>
                            )}



                            {/* Projects Grid */}
                            {isLoading && visibleProjects.length === 0 ? (
                                <div className="grid grid-cols-1 gap-4">
                                    {[1, 2, 3, 4, 5, 6].map((i) => (
                                        <ProjectCardSkeleton key={i} />
                                    ))}
                                </div>
                            ) : visibleProjects.length === 0 ? (
                                <div
                                    className="nb-empty-state nb-grid-ground py-16 animate-in fade-in zoom-in-95"
                                >
                                    <div className="w-12 h-12 mx-auto mb-4 rounded-[8px] border border-border bg-card flex items-center justify-center text-muted-foreground shadow-2xs">
                                        <Search className="w-6 h-6 text-muted-foreground" />
                                    </div>
                                    <h3 className="nb-card-title text-foreground mb-2">No Projects Found</h3>
                                    <p className="nb-compact text-muted-foreground mb-6 max-w-md mx-auto">
                                        Adjust your filters or create a new project.
                                    </p>
                                    <div className="flex items-center justify-center gap-3">
                                        <button onClick={handleClearFilters} className="inline-flex items-center gap-2 px-4 py-2 bg-muted hover:bg-muted/80 text-foreground rounded-[6px] text-sm font-medium transition-[color,background-color,border-color,box-shadow,opacity,transform]">
                                            Clear Filters
                                        </button>
                                        {/* Same destination and label as the top bar: the full-page create route. */}
                                        <Link href="/projects/new" className="inline-flex items-center gap-2 px-5 py-2.5 app-accent-solid hover:bg-primary/90 rounded-[6px] text-sm font-semibold transition-[color,background-color,border-color,box-shadow,opacity,transform]">
                                            <Plus className="w-4 h-4" aria-hidden="true" />
                                            New project
                                        </Link>
                                    </div>
                                </div>
                            ) : (
                                <div className="flex-1 w-full min-h-0">
                                    {scrollContainer && (
                                        <Virtuoso
                                            customScrollParent={scrollContainer}
                                            style={VIRTUOSO_CONTAINER_STYLE}
                                            data={visibleProjects}
                                            computeItemKey={computeProjectItemKey}
                                            overscan={400}
                                            increaseViewportBy={VIRTUOSO_INCREASE_VIEWPORT_BY}
                                            endReached={handleEndReached}
                                            components={virtuosoComponents}
                                            itemContent={renderProjectItem}
                                        />
                                    )}
                                </div>
                            )}
                            </div>
                            </div>
                            {currentUser?.id ? (
                                <aside className="nb-discover-rail pt-2" aria-label="People you should meet">
                                    <DiscoverPeopleRail initialPage={initialPeopleSuggestions} variant="desktop" />
                                </aside>
                            ) : null}
                            </div>
                            </div>
                        </AppScrollArea>


                    </div>
                </div>

            </div>
        </DiscoverErrorBoundary>
    );
});

export default DiscoverClient;

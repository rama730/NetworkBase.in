'use client';

import { useState, useMemo, memo, useEffect, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouteWarmPrefetch } from '@/hooks/useRouteWarmPrefetch';
import { motion } from 'framer-motion';
import { Search, Sparkles, CheckSquare, X } from 'lucide-react';
import { Virtuoso } from 'react-virtuoso';
import { useQueryClient } from '@tanstack/react-query';

// Hooks
import { useSearchParams } from 'next/navigation';
import { useHubProjectsSimple } from '@/hooks/hub/useHubProjectsSimple';
import { useAuth } from '@/hooks/useAuth';
import { useHubSessionSeen } from '@/hooks/hub/useHubSessionSeen';
import { useUserFollowedProjects } from '@/hooks/hub/useUserInteractions';
import { useHubUrlFilters } from '@/hooks/hub/useHubUrlFilters';

// Components
import ProjectCard from '@/components/projects/ProjectCard';
import ProjectCardSkeleton from '@/components/projects/ProjectCardSkeleton';
import HubHeader from '@/components/hub/HubHeader';
import { HubErrorBoundary } from '@/components/hub/HubErrorBoundary';
import { DiscoverPeopleRail } from '@/components/hub/DiscoverPeopleRail';
import { AppScrollArea } from '@/components/ui/AppScrollArea';
import { useReducedMotionPreference } from '@/components/providers/theme-provider';
// Constants & Types
import {
    FILTER_VIEWS,
    PROJECT_STATUS,
    PROJECT_TYPE,
    SORT_OPTIONS,
    VIEW_MODES,
    FilterView,
} from '@/constants/hub';
import { ROUTES } from '@/constants/routes';
import { User, Project } from '@/types/hub';

// Dynamic Modals
const CreateProjectWizard = dynamic(() => import('@/components/projects/create-wizard/CreateProjectWizard'), { ssr: false });

import { toProjectCardViewModel, ProjectCardViewModel } from '@/lib/view-models/project-card';
import { queryKeys } from '@/lib/query-keys';
import type { ConnectionFeedPage, DiscoverConnectionItem } from '@/hooks/useConnections';
import { toHubUser } from '@/lib/view-models/hub-user';
import {
    clearGithubOAuthResume,
    getCreateProjectReturnPath,
    readGithubOAuthResume,
    type CreateProjectGithubOAuthResume,
} from '@/components/projects/create-wizard/github-oauth-resume';

const CREATE_PROJECT_MODAL_STORAGE_KEY = 'hub:create-project-modal-state';

type PersistedCreateProjectSource = 'scratch' | 'github' | 'upload' | null;

type PersistedCreateProjectModalState = {
    open: boolean;
    source: PersistedCreateProjectSource;
};

function parsePersistedCreateProjectSource(raw: string | null | undefined): PersistedCreateProjectSource {
    return raw === 'github' || raw === 'upload' || raw === 'scratch' ? raw : null;
}

function readPersistedCreateProjectModalState(): PersistedCreateProjectModalState | null {
    if (typeof window === 'undefined') return null;
    const raw = window.sessionStorage.getItem(CREATE_PROJECT_MODAL_STORAGE_KEY)?.trim();
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw) as Partial<PersistedCreateProjectModalState>;
        return {
            open: parsed.open === true,
            source: parsePersistedCreateProjectSource(parsed.source as string | null | undefined),
        };
    } catch {
        return null;
    }
}

function persistCreateProjectModalState(state: PersistedCreateProjectModalState | null): void {
    if (typeof window === 'undefined') return;
    if (!state) {
        window.sessionStorage.removeItem(CREATE_PROJECT_MODAL_STORAGE_KEY);
        return;
    }
    window.sessionStorage.setItem(CREATE_PROJECT_MODAL_STORAGE_KEY, JSON.stringify(state));
}

interface SimpleHubClientProps {
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

const SimpleHubClient = memo(function SimpleHubClient({ returnUserData, initialProjectsPage, initialPeopleSuggestions }: SimpleHubClientProps) {
    const queryClient = useQueryClient();
    const { user } = useAuth();
    const prefetch = useRouteWarmPrefetch();
    const searchParams = useSearchParams();
    const reduceMotion = useReducedMotionPreference();
    const handledCreateProjectRequestRef = useRef<string | null>(null);

    // --- State ---
    // Essential UI State
    const viewMode = VIEW_MODES.GRID;

    // Selection & Modal State

    // Dialog Visibility
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [createModalInitialSource, setCreateModalInitialSource] = useState<'scratch' | 'github' | 'upload' | null>(null);
    const [githubOAuthResume, setGithubOAuthResume] = useState<CreateProjectGithubOAuthResume | null>(null);
    const [profileChecklistItems, setProfileChecklistItems] = useState<string[]>([]);
    const [showProfileChecklist, setShowProfileChecklist] = useState(false);

    // --- Derived Data ---
    const { urlFilters, updateUrlFilters } = useHubUrlFilters();
    const filterView = urlFilters.view;
    const statusFilter = urlFilters.status;
    const typeFilter = urlFilters.type;
    const sortBy = urlFilters.sort;
    const selectedTech = urlFilters.tech;
    const search = urlFilters.q || undefined;
    const hideOpened = urlFilters.hideOpened;

    const currentUser = useMemo(
        () => toHubUser(user, returnUserData),
        [user, returnUserData],
    );

    const { seenIds, setHideSeen, markSeen } = useHubSessionSeen();

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

    useEffect(() => {
        const liveParams =
            typeof window !== 'undefined'
                ? new URLSearchParams(window.location.search)
                : new URLSearchParams(searchParams.toString());
        const requestedSource = parsePersistedCreateProjectSource(liveParams.get('createProjectSource'));
        const returnPath = typeof window !== 'undefined'
            ? getCreateProjectReturnPath(window.location)
            : '/hub';
        const githubResume = readGithubOAuthResume(returnPath);
        const persistedModalState = readPersistedCreateProjectModalState();
        const source = requestedSource ?? githubResume?.values.import_source?.type ?? persistedModalState?.source ?? null;
        const shouldOpenCreateModal =
            liveParams.get('createProject') === '1'
            || persistedModalState?.open === true;
        if (!shouldOpenCreateModal) {
            handledCreateProjectRequestRef.current = null;
            return;
        }

        const requestKey = `${liveParams.get('createProject') === '1' ? 'url' : 'storage'}:${source ?? 'none'}`;

        if (handledCreateProjectRequestRef.current === requestKey && showCreateModal) {
            return;
        }
        handledCreateProjectRequestRef.current = requestKey;

        persistCreateProjectModalState({ open: true, source });
        setCreateModalInitialSource(source);
        setGithubOAuthResume(githubResume);
        setShowCreateModal(true);

        if (typeof window !== 'undefined') {
            const nextUrl = new URL(window.location.href);
            nextUrl.searchParams.delete('createProject');
            nextUrl.searchParams.delete('createProjectSource');
            const nextHref = `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;
            window.history.replaceState(window.history.state, '', nextHref);
        }
    }, [searchParams, showCreateModal]);

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
    } = useHubProjectsSimple(currentFilters, filterView, initialProjectsPage);
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
            { queryKey: queryKeys.hub.projectsSimpleRoot() },
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
                    { queryKey: queryKeys.hub.projectsSimpleRoot() },
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
                queryKey: queryKeys.hub.projectsSimpleRoot(),
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

    // Creating Project
    const handleProjectCreated = useCallback(() => {
        persistCreateProjectModalState(null);
        setShowCreateModal(false);
        setCreateModalInitialSource(null);
        setGithubOAuthResume(null);
        queryClient.invalidateQueries({ queryKey: queryKeys.hub.projectsSimpleRoot() });
        queryClient.invalidateQueries({ queryKey: queryKeys.globalSearch.hubRoot() });
    }, [queryClient]);

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
        <HubErrorBoundary>
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
                            id="hub-scroll-container"
                            data-testid="hub-feed-scroll"
                            data-scroll-root="route"
                            className="flex-1 min-h-0 px-4 sm:px-6 pb-8 relative"
                        >
                            <div className="mx-auto flex w-full max-w-[1240px] flex-col">
                                <div className="h-6 shrink-0" aria-hidden="true" />

                                <div className={currentUser?.id ? "nb-discover-columns" : "nb-discover-columns nb-discover-columns--single"}>
                                <div className="min-w-0">
                                    <div
                                        data-testid="hub-header-shell"
                                        className="mb-[18px] py-2"
                                    >
                                        <div className="pb-4">
                                            <HubHeader
                                                filterView={filterView}
                                                onSelectView={handleSelectView}
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
                                                onMouseEnter={() => prefetch(ROUTES.MY_PROFILE)}
                                                onFocus={() => prefetch(ROUTES.MY_PROFILE)}
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
                                <motion.div
                                    initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.95 }}
                                    animate={reduceMotion ? { opacity: 1 } : { opacity: 1, scale: 1 }}
                                    transition={reduceMotion ? { duration: 0 } : undefined}
                                    className="nb-empty-state nb-grid-ground py-16"
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
                                        <button onClick={() => {
                                            persistCreateProjectModalState({ open: true, source: null });
                                            setCreateModalInitialSource(null);
                                            setShowCreateModal(true);
                                        }} className="inline-flex items-center gap-2 px-5 py-2.5 app-accent-solid hover:bg-primary/90 rounded-[6px] text-sm font-semibold transition-[color,background-color,border-color,box-shadow,opacity,transform]">
                                            <Sparkles className="w-4 h-4" />
                                            Start New Project
                                        </button>
                                    </div>
                                </motion.div>
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

                        {/* Modals & Drawers */}
                        {showCreateModal && (
                            <CreateProjectWizard
                                onClose={() => {
                                    handledCreateProjectRequestRef.current = null;
                                    persistCreateProjectModalState(null);
                                    setShowCreateModal(false);
                                    setCreateModalInitialSource(null);
                                    setGithubOAuthResume(null);
                                }}
                                onSuccess={handleProjectCreated}
                                initialSource={createModalInitialSource}
                                githubOAuthResume={githubOAuthResume}
                                onGithubOAuthResumeRestored={(resumeId) => {
                                    clearGithubOAuthResume(resumeId);
                                    setGithubOAuthResume(null);
                                }}
                                onSourceChange={(source) => {
                                    setCreateModalInitialSource(source);
                                    persistCreateProjectModalState({ open: true, source });
                                }}
                            />
                        )}

                    </div>
                </div>

            </div>
        </HubErrorBoundary>
    );
});

export default SimpleHubClient;

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Bell, Compass, Plus, Search, Sparkles } from 'lucide-react';
import { Virtuoso, type Components } from 'react-virtuoso';
import { useQueryClient, type InfiniteData } from '@tanstack/react-query';

import { DiscoverFeedError, useDiscoverProjects } from '@/hooks/discover/useDiscoverProjects';
import { useAuth } from '@/hooks/useAuth';
import { useDiscoverSessionSeen } from '@/hooks/discover/useDiscoverSessionSeen';
import { useUserFollowedProjects } from '@/hooks/projects/useUserInteractions';
import { useDiscoverUrlFilters } from '@/hooks/discover/useDiscoverUrlFilters';

import ProjectCard from '@/components/projects/ProjectCard';
import ProjectCardSkeleton from '@/components/projects/ProjectCardSkeleton';
import DiscoverHeader from '@/components/discover/DiscoverHeader';
import { DiscoverFiltersPanel } from '@/components/discover/DiscoverFiltersPanel';
import { DiscoverPeopleRail } from '@/components/discover/DiscoverPeopleRail';
import { ProfileChecklist } from '@/components/discover/ProfileChecklist';
import { LegalLinks } from '@/components/legal/LegalLinks';
import { AppScrollArea } from '@/components/ui/AppScrollArea';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { FILTER_VIEWS, SORT_OPTIONS } from '@/constants/discover';
import { ROUTES } from '@/constants/routes';
import type { User, Project } from '@/types/discover';
import { toProjectCardViewModel } from '@/lib/view-models/project-card';
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

type FeedPage = { projects: Project[]; nextCursor?: string; hasMore: boolean };
type FeedContext = { loadingMore: boolean; hasMore: boolean; failed: boolean; retry: () => void; count: number };

const VIRTUOSO_CONTAINER_STYLE = { width: "100%" } as const;
const VIRTUOSO_INCREASE_VIEWPORT_BY = { top: 1200, bottom: 800 } as const;
// Rendered before the scroll container exists (server HTML, first paint), then handed to Virtuoso.
const FIRST_PAINT_ITEMS = 6;
const SCROLL_KEY = 'discover-scroll:';
const computeProjectItemKey = (_: number, project: Project) => project.id;

/** The end of the feed: loading, the end, or a retry for a page that failed. Read out as a status. */
const FeedFooter: Components<Project, FeedContext>['Footer'] = ({ context }) => {
    if (!context || context.count === 0) return null;
    return (
        <div role="status" className="flex min-h-12 items-center justify-center gap-3 pb-8 pt-2">
            {context.failed ? (
                <>
                    <span className="nb-meta">More projects didn&apos;t load.</span>
                    <Button type="button" variant="outline" size="sm" onClick={context.retry} className="pointer-coarse:h-11">Retry</Button>
                </>
            ) : context.loadingMore ? (
                <span className="nb-meta">Loading more…</span>
            ) : !context.hasMore ? (
                <span className="nb-meta">You&apos;ve seen every project here.</span>
            ) : null}
        </div>
    );
};
const virtuosoComponents = { Footer: FeedFooter };

function FeedSkeleton() {
    return (
        <div role="status" className="flex flex-col gap-4">
            <span className="sr-only">Loading projects…</span>
            {[1, 2, 3, 4].map((item) => <ProjectCardSkeleton key={item} />)}
        </div>
    );
}

export default function DiscoverClient({ returnUserData, initialProjectsPage, initialPeopleSuggestions }: DiscoverClientProps) {
    const queryClient = useQueryClient();
    const { user } = useAuth();
    const currentUser = useMemo(() => toDiscoverUser(user, returnUserData), [user, returnUserData]);
    const viewerId = currentUser?.id ?? null;

    const { urlFilters, updateUrlFilters, clearFilters, activeFilters, isDefault } = useDiscoverUrlFilters();
    const { view, q, status, type, sort, tech, hideOpened } = urlFilters;
    const { seenIds, markSeen } = useDiscoverSessionSeen();
    const [filtersOpen, setFiltersOpen] = useState(false);
    const filtersButton = useRef<HTMLButtonElement>(null);
    const feedHeading = useRef<HTMLHeadingElement>(null);

    const filters = useMemo(() => ({
        status,
        type,
        tech,
        sort: view === FILTER_VIEWS.TRENDING ? SORT_OPTIONS.TRENDING : sort,
        search: q || undefined,
    }), [q, sort, status, tech, type, view]);

    const {
        data,
        error,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage,
        isFetchNextPageError,
        isLoading,
        isPlaceholderData,
        refetch,
    } = useDiscoverProjects(viewerId, filters, view, isDefault, initialProjectsPage);

    // Pages can overlap when projects arrive between requests: each project once.
    const allProjects = useMemo(() => {
        const seen = new Set<string>();
        return (data?.pages ?? []).flatMap((page) => page.projects).filter((project) => !seen.has(project.id) && Boolean(seen.add(project.id)));
    }, [data]);
    const visibleProjects = useMemo(
        () => (hideOpened ? allProjects.filter((project) => !seenIds.has(project.id)) : allProjects),
        [allProjects, hideOpened, seenIds],
    );
    const pageIds = useMemo(() => (data?.pages ?? []).map((page) => page.projects.map((project) => project.id)), [data]);
    const followed = useUserFollowedProjects(viewerId, pageIds);

    // Everything loaded is already opened: keep loading until there's something to show.
    useEffect(() => {
        if (!hideOpened || visibleProjects.length > 0 || !hasNextPage || isFetchingNextPage || allProjects.length === 0) return;
        void fetchNextPage();
    }, [hideOpened, visibleProjects.length, hasNextPage, isFetchingNextPage, allProjects.length, fetchNextPage]);

    // Another tab or the project settings changed a project: patch what's on screen; refetch only when next shown.
    useEffect(() => {
        const patchCover = (detail: { projectId?: string; update?: { coverImage?: string | null } } | undefined) => {
            const targetId = detail?.projectId;
            if (!targetId) return;
            const coverImage = detail.update?.coverImage;
            if (coverImage !== undefined) {
                queryClient.setQueriesData<any>({ queryKey: queryKeys.discover.projectsSimpleRoot() }, (old: InfiniteData<FeedPage> | undefined) => old && ({
                    ...old,
                    pages: old.pages.map((page) => ({
                        ...page,
                        projects: page.projects.map((project) => (project.id === targetId || project.slug === targetId ? { ...project, coverImage } : project)),
                    })),
                }));
            }
            void queryClient.invalidateQueries({ queryKey: queryKeys.discover.projectsSimpleRoot(), refetchType: 'none' });
        };
        const onEvent = (event: Event) => patchCover((event as CustomEvent<{ projectId?: string; update?: { coverImage?: string | null } }>).detail);
        window.addEventListener("nb-project-updated", onEvent);
        let channel: BroadcastChannel | null = null;
        try {
            channel = new BroadcastChannel("nb-project-updated-v1");
            channel.onmessage = (message) => patchCover(message.data);
        } catch {
            // No BroadcastChannel (restricted environments): this tab's own events still apply.
        }
        return () => {
            window.removeEventListener('nb-project-updated', onEvent);
            channel?.close();
        };
    }, [queryClient]);

    // ---- Scroll: back from a project returns to the same place; a new scope or filter starts at the top.
    const [scrollContainer, setScrollContainer] = useState<HTMLDivElement | null>(null);
    const scrollContainerRef = useCallback((node: HTMLDivElement | null) => setScrollContainer((prev) => (prev === node ? prev : node)), []);
    const feedKey = JSON.stringify([view, filters, hideOpened]);
    const lastFeedKey = useRef<string | null>(null);
    useEffect(() => {
        if (!scrollContainer) return;
        const storageKey = `${SCROLL_KEY}${window.location.search}`;
        if (lastFeedKey.current === null) {
            try {
                const saved = Number(sessionStorage.getItem(storageKey));
                if (saved > 0) requestAnimationFrame(() => scrollContainer.scrollTo({ top: saved }));
            } catch {
                // Storage blocked: start at the top.
            }
        } else if (lastFeedKey.current !== feedKey) {
            scrollContainer.scrollTo({ top: 0 });
        }
        lastFeedKey.current = feedKey;
        let frame = 0;
        const save = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => {
                try {
                    sessionStorage.setItem(storageKey, String(Math.round(scrollContainer.scrollTop)));
                } catch {
                    // Storage blocked: nothing to restore later.
                }
            });
        };
        scrollContainer.addEventListener('scroll', save, { passive: true });
        return () => {
            cancelAnimationFrame(frame);
            scrollContainer.removeEventListener('scroll', save);
        };
    }, [feedKey, scrollContainer]);

    const handleEndReached = useCallback(() => {
        if (hasNextPage && !isFetchingNextPage && !isFetchNextPageError) void fetchNextPage();
    }, [hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage]);

    const feedContext = useMemo<FeedContext>(() => ({
        loadingMore: isFetchingNextPage,
        hasMore: Boolean(hasNextPage),
        failed: isFetchNextPageError,
        retry: () => void fetchNextPage(),
        count: visibleProjects.length,
    }), [fetchNextPage, hasNextPage, isFetchNextPageError, isFetchingNextPage, visibleProjects.length]);

    const renderProjectItem = useCallback((_: number, project: Project) => (
        <div className="pb-4">
            <ProjectCard
                project={project}
                viewModel={toProjectCardViewModel(project)}
                isFollowing={followed.has(project.id)}
                followersCount={project.followersCount}
                onOpenProject={markSeen}
            />
        </div>
    ), [followed, markSeen]);

    // Clearing moves focus to the feed's heading, so it never drops to the page body.
    const clearAll = useCallback(() => {
        clearFilters();
        feedHeading.current?.focus();
    }, [clearFilters]);

    const emptyState = (() => {
        if (q || activeFilters) {
            return <EmptyState icon={Search} title="No projects match" description="Try other words or fewer filters." action={<Button type="button" variant="outline" onClick={clearAll}>Clear filters</Button>} />;
        }
        if (view === FILTER_VIEWS.FOLLOWING) {
            return <EmptyState icon={Bell} title="Projects you follow show up here" description="Follow a project to get its updates in this view." action={<Button type="button" variant="outline" onClick={() => updateUrlFilters({ view: FILTER_VIEWS.ALL })}>Browse all projects</Button>} />;
        }
        if (view === FILTER_VIEWS.RECOMMENDATIONS) {
            return <EmptyState icon={Sparkles} title="No matches yet" description="Add skills and interests to your profile to get projects that fit you." action={<Button asChild variant="outline"><Link href={ROUTES.MY_PROFILE}>Edit your profile</Link></Button>} />;
        }
        return <EmptyState icon={Compass} title={isDefault ? 'No projects yet' : 'No projects here yet'} description="Start one and invite people to build it with you." action={<Button asChild><Link href="/projects/new"><Plus className="size-4" aria-hidden="true" /> New project</Link></Button>} />;
    })();

    const feed = isLoading && !data ? (
        <FeedSkeleton />
    ) : error && visibleProjects.length === 0 ? (
        <ErrorNotice
            message={error instanceof DiscoverFeedError ? error.message : "Projects didn't load. Check your connection and try again."}
            onRetry={() => void refetch()}
        />
    ) : visibleProjects.length === 0 ? (
        emptyState
    ) : (
        // While a new scope or filter loads, the last results stay, dimmed.
        <div aria-busy={isPlaceholderData || undefined} className={isPlaceholderData ? 'opacity-60 transition-opacity duration-[130ms]' : undefined}>
            {scrollContainer ? (
                <Virtuoso
                    customScrollParent={scrollContainer}
                    style={VIRTUOSO_CONTAINER_STYLE}
                    data={visibleProjects}
                    context={feedContext}
                    computeItemKey={computeProjectItemKey}
                    initialItemCount={Math.min(FIRST_PAINT_ITEMS, visibleProjects.length)}
                    increaseViewportBy={VIRTUOSO_INCREASE_VIEWPORT_BY}
                    endReached={handleEndReached}
                    components={virtuosoComponents}
                    itemContent={renderProjectItem}
                />
            ) : (
                visibleProjects.slice(0, FIRST_PAINT_ITEMS).map((project, index) => <div key={project.id}>{renderProjectItem(index, project)}</div>)
            )}
        </div>
    );

    const people = viewerId ? <DiscoverPeopleRail initialPage={initialPeopleSuggestions} variant="compact" /> : null;

    return (
        <AppScrollArea
            axis="y"
            ref={scrollContainerRef}
            data-testid="discover-feed-scroll"
            data-scroll-root="route"
            className="h-full min-h-0 flex-1 px-4 sm:px-6"
        >
            <div className="mx-auto w-full max-w-[1240px] pb-8 pt-6">
                <div className={viewerId ? 'nb-discover-columns' : 'nb-discover-columns nb-discover-columns--single'}>
                    <div className="min-w-0">
                        <div data-testid="discover-header-shell" className="mb-[18px]">
                            <DiscoverHeader
                                query={urlFilters}
                                activeFilters={activeFilters}
                                onChange={updateUrlFilters}
                                onClearFilters={() => clearFilters({ keepSearch: true })}
                                onOpenFilters={() => setFiltersOpen(true)}
                                filtersButtonRef={filtersButton}
                                people={people}
                            />
                        </div>
                        {viewerId ? <ProfileChecklist userId={viewerId} className="mb-4 min-[1200px]:hidden" /> : null}
                        <h2 ref={feedHeading} id="discover-feed" tabIndex={-1} className="sr-only">Projects</h2>
                        {feed}
                    </div>
                    {viewerId ? (
                        <aside className="nb-discover-rail space-y-4">
                            <ProfileChecklist userId={viewerId} />
                            <DiscoverPeopleRail initialPage={initialPeopleSuggestions} variant="desktop" />
                            <div className="pt-2">
                                <LegalLinks
                                    align="start"
                                    showCopyright
                                    className="text-[11px]"
                                />
                            </div>
                        </aside>
                    ) : null}
                </div>
            </div>
            <DiscoverFiltersPanel
                open={filtersOpen}
                onOpenChange={(open) => {
                    setFiltersOpen(open);
                    if (!open) requestAnimationFrame(() => filtersButton.current?.focus());
                }}
                query={urlFilters}
                onChange={updateUrlFilters}
                onClear={() => clearFilters({ keepSearch: true })}
            />
        </AppScrollArea>
    );
}

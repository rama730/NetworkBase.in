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
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useSuggestedPeople } from '@/hooks/useConnections';

import ProjectCard from '@/components/projects/ProjectCard';
import ProjectCardSkeleton from '@/components/projects/ProjectCardSkeleton';
import DiscoverHeader from '@/components/discover/DiscoverHeader';
import { DiscoverFiltersPanel } from '@/components/discover/DiscoverFiltersPanel';
import { DiscoverPeopleRail } from '@/components/discover/DiscoverPeopleRail';
import { ProfileChecklist, useProfileChecklistItems } from '@/components/discover/ProfileChecklist';
import { LegalLinks } from '@/components/legal/LegalLinks';
import { AppScrollArea } from '@/components/ui/AppScrollArea';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { FILTER_VIEWS, SORT_OPTIONS } from '@/constants/discover';
import { ROUTES } from '@/constants/routes';
import { DISCOVER_RAIL_FILTERS, type DiscoverQuery } from '@/lib/discover/query';
import type { User, Project } from '@/types/discover';
import { queryKeys } from '@/lib/query-keys';
import type { ConnectionFeedPage, DiscoverConnectionItem } from '@/hooks/useConnections';
import { toDiscoverUser } from '@/lib/view-models/discover-user';

interface DiscoverClientProps {
    returnUserData: User | null;
    initialProjectsPage?: {
        projects?: Project[];
        nextCursor?: string;
        hasMore?: boolean;
        renderedAt?: number;
    } | null;
    initialPeopleSuggestions?: ConnectionFeedPage<DiscoverConnectionItem>;
}

type FeedPage = { projects: Project[]; nextCursor?: string; hasMore: boolean };
type FeedContext = { loadingMore: boolean; hasMore: boolean; failed: boolean; stale: boolean; ranked: boolean; retry: () => void; restart: () => void; count: number };

const VIRTUOSO_CONTAINER_STYLE = { width: "100%" } as const;
const VIRTUOSO_INCREASE_VIEWPORT_BY = { top: 1200, bottom: 800 } as const;
// Rendered before the scroll container exists (server HTML, first paint), then handed to Virtuoso.
// ponytail: the 6 first-paint cards remount once when Virtuoso takes over; mount Virtuoso at first render if that ever shows.
const FIRST_PAINT_ITEMS = 6;
const SCROLL_KEY = 'discover-scroll:';
const computeProjectItemKey = (_: number, project: Project) => project.id;

// Back/Forward (a history traverse) restores where you were; any other arrival starts at the top.
let lastTraverseAt = 0;
if (typeof window !== 'undefined') window.addEventListener('popstate', () => { lastTraverseAt = Date.now(); });
const cameBackByHistory = () => {
    if (Date.now() - lastTraverseAt < 1500) return true;
    const entry = performance.getEntriesByType?.('navigation')[0] as PerformanceNavigationTiming | undefined;
    return entry?.type === 'back_forward' && performance.now() < 5000;
};

/** The end of the feed: loading, the end, or a way on when a page failed. */
const FeedFooter: Components<Project, FeedContext>['Footer'] = ({ context }) => {
    if (!context || context.count === 0) return null;
    return (
        <div className="flex min-h-12 items-center justify-center gap-3 pb-8 pt-2">
            {context.stale ? (
                <>
                    <span role="status" className="nb-meta">This list changed since you opened it.</span>
                    <Button type="button" variant="outline" size="sm" onClick={context.restart} className="pointer-coarse:h-11">Refresh feed</Button>
                </>
            ) : context.failed ? (
                <>
                    <span role="status" className="nb-meta">More projects didn&apos;t load.</span>
                    <Button type="button" variant="outline" size="sm" onClick={context.retry} className="pointer-coarse:h-11">Retry</Button>
                </>
            ) : context.loadingMore ? (
                <span role="status" className="nb-meta">Loading more…</span>
            ) : !context.hasMore ? (
                // Trending and For you are a ranked top list, not every project.
                <span role="status" className="nb-meta">{context.ranked ? "That's the top of this list for now." : "You've seen every project here."}</span>
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
    const { hiddenIds, markSeen } = useDiscoverSessionSeen();
    const [filtersOpen, setFiltersOpen] = useState(false);
    const filtersButton = useRef<HTMLButtonElement>(null);
    const feedHeading = useRef<HTMLHeadingElement>(null);
    // One history entry per visit to the Filters drawer: its first change pushes, the rest replace.
    const drawerPushed = useRef(false);

    // ---- The rail: shown only at 1200px+ and only with something in it (people or the checklist).
    const wide = useMediaQuery('(min-width: 1200px)');
    const suggestions = useSuggestedPeople(3, undefined, DISCOVER_RAIL_FILTERS, initialPeopleSuggestions, false);
    const hasPeople = Boolean(viewerId) && (suggestions.isLoading || (suggestions.data?.pages[0]?.items.length ?? 0) > 0 || suggestions.isError);
    const checklist = useProfileChecklistItems(viewerId);
    // Before hydration knows the width, CSS decides (the rail column is hidden below 1200px).
    const showRail = wide !== false && (hasPeople || checklist.length > 0);

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
        isFetching,
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
        () => (hideOpened ? allProjects.filter((project) => !hiddenIds.has(project.id)) : allProjects),
        [allProjects, hideOpened, hiddenIds],
    );
    const pageIds = useMemo(() => (data?.pages ?? []).map((page) => page.projects.map((project) => project.id)), [data]);
    const followed = useUserFollowedProjects(viewerId, pageIds);

    // Everything loaded is already opened: keep loading until there's something to show (never on a failing page).
    useEffect(() => {
        if (!hideOpened || visibleProjects.length > 0 || !hasNextPage || isFetchingNextPage || isFetchNextPageError || allProjects.length === 0) return;
        void fetchNextPage();
    }, [hideOpened, visibleProjects.length, hasNextPage, isFetchingNextPage, isFetchNextPageError, allProjects.length, fetchNextPage]);

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

    // ---- Scroll: Back/Forward returns to the same place; a new scope or filter starts at the top.
    const [scrollContainer, setScrollContainer] = useState<HTMLDivElement | null>(null);
    const scrollContainerRef = useCallback((node: HTMLDivElement | null) => setScrollContainer((prev) => (prev === node ? prev : node)), []);
    const feedKey = JSON.stringify([view, filters, hideOpened]);
    const lastFeedKey = useRef<string | null>(null);
    useEffect(() => {
        if (!scrollContainer) return;
        const storageKey = `${SCROLL_KEY}${window.location.search}`;
        if (lastFeedKey.current !== feedKey) {
            let saved = 0;
            if (cameBackByHistory()) {
                try {
                    saved = Number(sessionStorage.getItem(storageKey)) || 0;
                } catch {
                    // Storage blocked: start at the top.
                }
            }
            if (saved > 0) requestAnimationFrame(() => scrollContainer.scrollTo({ top: saved }));
            else if (lastFeedKey.current !== null) scrollContainer.scrollTo({ top: 0 });
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

    // A ranked list that moved on (its snapshot expired): start it again rather than retry the same page.
    const staleFeed = isFetchNextPageError && error instanceof DiscoverFeedError && error.code === 'STALE_FEED';
    const restartFeed = useCallback(() => {
        scrollContainer?.scrollTo({ top: 0 });
        void queryClient.resetQueries({ queryKey: queryKeys.discover.projectsSimple(viewerId, view, filters) });
    }, [filters, queryClient, scrollContainer, view, viewerId]);

    const feedContext = useMemo<FeedContext>(() => ({
        loadingMore: isFetchingNextPage,
        hasMore: Boolean(hasNextPage),
        failed: isFetchNextPageError,
        stale: staleFeed,
        ranked: view === FILTER_VIEWS.TRENDING || view === FILTER_VIEWS.RECOMMENDATIONS,
        retry: () => void fetchNextPage(),
        restart: restartFeed,
        count: visibleProjects.length,
    }), [fetchNextPage, hasNextPage, isFetchNextPageError, isFetchingNextPage, restartFeed, staleFeed, view, visibleProjects.length]);

    const following = view === FILTER_VIEWS.FOLLOWING;
    const renderProjectItem = useCallback((_: number, project: Project) => (
        <div className="pb-4">
            <ProjectCard
                project={project}
                // In Following every card is followed; no flash of "not following" while that loads.
                isFollowing={following || followed.has(project.id)}
                followersCount={project.followersCount}
                onOpenProject={markSeen}
            />
        </div>
    ), [followed, following, markSeen]);

    // Clearing moves focus to the feed's heading, so it never drops to the page body.
    const focusFeed = useCallback(() => requestAnimationFrame(() => feedHeading.current?.focus()), []);
    const clearAll = useCallback(() => {
        clearFilters();
        focusFeed();
    }, [clearFilters, focusFeed]);

    // Said once results settle after a search, scope or filter change: "12 projects", "No projects match".
    const settled = !isFetching && !isPlaceholderData && !error;
    const announcement = settled && (!isDefault || hideOpened)
        ? visibleProjects.length
            ? `${visibleProjects.length}${hasNextPage ? '+' : ''} ${visibleProjects.length === 1 && !hasNextPage ? 'project' : 'projects'}`
            : 'No projects match'
        : '';

    const emptyState = (() => {
        if (q || activeFilters) {
            return <EmptyState icon={Search} title="No projects match" description="Try other words or fewer filters." action={<Button type="button" variant="outline" onClick={clearAll}>{q ? 'Clear search and filters' : 'Clear filters'}</Button>} />;
        }
        if (view === FILTER_VIEWS.FOLLOWING) {
            return <EmptyState icon={Bell} title="Projects you follow show up here" description="Follow a project to get its updates in this view." action={<Button type="button" variant="outline" onClick={() => { updateUrlFilters({ view: FILTER_VIEWS.ALL }); focusFeed(); }}>Browse all projects</Button>} />;
        }
        if (view === FILTER_VIEWS.RECOMMENDATIONS) {
            return <EmptyState icon={Sparkles} title="No matches yet" description="Add skills and interests to your profile to get projects that fit you." action={<Button asChild variant="outline"><Link href={ROUTES.MY_PROFILE}>Edit your profile</Link></Button>} />;
        }
        return <EmptyState icon={Compass} title={isDefault ? 'No projects yet' : 'No projects here yet'} description="Start one and invite people to build it with you." action={<Button asChild><Link href="/projects/new"><Plus className="size-4" aria-hidden="true" /> New project</Link></Button>} />;
    })();

    const firstPageError = error && visibleProjects.length === 0;
    const feed = isLoading && !data ? (
        <FeedSkeleton />
    ) : firstPageError ? (
        error instanceof DiscoverFeedError && error.code === 'VALIDATION' ? (
            // A link whose filters can't work: retrying won't help, clearing will.
            <ErrorNotice message={error.message} onRetry={clearAll} actionLabel="Clear filters" />
        ) : (
            <ErrorNotice
                message={error instanceof DiscoverFeedError ? error.message : "Projects didn't load. Check your connection and try again."}
                onRetry={() => void refetch()}
            />
        )
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

    // Below 1200px people open from a button, and only when there are some to show.
    const legal = <LegalLinks align="start" showCopyright className="text-[11px]" />;
    // The drawer's footer carries the legal links too (phones have no rail to put them in).
    const people = hasPeople && wide === false
        ? <><DiscoverPeopleRail initialPage={initialPeopleSuggestions} variant="compact" /><div className="pt-4">{legal}</div></>
        : null;

    return (
        <AppScrollArea
            axis="y"
            ref={scrollContainerRef}
            data-testid="discover-feed-scroll"
            data-scroll-root="route"
            className="h-full min-h-0 flex-1 px-4 sm:px-6"
        >
            <div className="mx-auto w-full max-w-[1240px] pb-8 pt-6">
                <div className={showRail ? 'nb-discover-columns' : 'nb-discover-columns nb-discover-columns--single'}>
                    <div className="min-w-0">
                        <div data-testid="discover-header-shell" className="mb-[18px]">
                            <DiscoverHeader
                                query={urlFilters}
                                activeFilters={activeFilters}
                                announcement={announcement}
                                onChange={updateUrlFilters}
                                onClearFilters={() => clearFilters({ keepSearch: true })}
                                onOpenFilters={() => {
                                    drawerPushed.current = false;
                                    setFiltersOpen(true);
                                }}
                                filtersButtonRef={filtersButton}
                                people={people}
                            />
                        </div>
                        {wide === false ? <ProfileChecklist items={checklist} className="mb-4" /> : null}
                        <h2 ref={feedHeading} id="discover-feed" tabIndex={-1} className="sr-only">Projects</h2>
                        {feed}
                        {/* With no rail beside the feed, the legal links close the page instead. */}
                        {showRail ? null : <div className="pt-6">{legal}</div>}
                    </div>
                    {showRail ? (
                        <aside aria-label="People and profile" className="nb-discover-rail sticky top-6 space-y-4 self-start">
                            <ProfileChecklist items={checklist} />
                            {hasPeople ? <DiscoverPeopleRail initialPage={initialPeopleSuggestions} variant="desktop" /> : null}
                            <div className="pt-2">{legal}</div>
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
                activeFilters={activeFilters}
                onChange={(patch: Partial<DiscoverQuery>) => {
                    updateUrlFilters(patch, { replace: drawerPushed.current });
                    drawerPushed.current = true;
                }}
                onClear={() => {
                    clearFilters({ keepSearch: true });
                    drawerPushed.current = true;
                }}
            />
        </AppScrollArea>
    );
}

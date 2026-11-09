'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { Bell, Compass, Plus, Search, Sparkles } from 'lucide-react';
import { Virtuoso, type Components } from 'react-virtuoso';
import { useQueryClient, type InfiniteData } from '@tanstack/react-query';

import { DiscoverFeedError, useDiscoverWorkspaces } from '@/hooks/discover/useDiscoverWorkspaces';
import { useAuth } from '@/hooks/useAuth';
import { useDiscoverSessionSeen } from '@/hooks/discover/useDiscoverSessionSeen';
import { useUserFollowedWorkspaces } from '@/hooks/workspaces/useUserInteractions';
import { useMyApplicationStates } from '@/hooks/workspaces/useMyApplicationStates';
import { useDiscoverUrlFilters } from '@/hooks/discover/useDiscoverUrlFilters';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useSuggestedPeople } from '@/hooks/useConnections';

import ProjectCard from '@/components/workspaces/WorkspaceCard';
import WorkspaceCardSkeleton from '@/components/workspaces/WorkspaceCardSkeleton';
import DiscoverUpdateCard from '@/components/discover/DiscoverUpdateCard';
import DiscoverUpdateCardSkeleton from '@/components/discover/DiscoverUpdateCardSkeleton';
import DiscoverHeader from '@/components/discover/DiscoverHeader';
import { DiscoverFiltersPanel } from '@/components/discover/DiscoverFiltersPanel';
import { DiscoverPeopleRail } from '@/components/discover/DiscoverPeopleRail';
import { DiscoverRail } from '@/components/discover/DiscoverRail';
import { LegalLinks } from '@/components/legal/LegalLinks';
import { AppScrollArea } from '@/components/ui/AppScrollArea';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { ComponentErrorBoundary } from '@/components/ui/ComponentErrorBoundary';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { FILTER_VIEWS, SORT_OPTIONS } from '@/constants/discover';
import { ROUTES } from '@/constants/routes';
import { DISCOVER_RAIL_FILTERS, DISCOVER_RAIL_PEOPLE_LIMIT, type DiscoverQuery } from '@/lib/discover/query';
import type { User, Workspace, DiscoverFeedItem, DiscoverUpdatesPage, DiscoverUpdateView } from '@/types/discover';
import { queryKeys } from '@/lib/query-keys';
import type { ConnectionFeedPage, DiscoverConnectionItem } from '@/hooks/useConnections';
import { toDiscoverUser } from '@/lib/view-models/discover-user';
import { feedItemKey, interleaveWorkspacesAndUpdates, limitPostRuns } from '@/lib/discover/feed-interleaving';
import { showKeeps } from '@/lib/organizations/profile-rules';
import { useDiscoverUpdates } from '@/hooks/discover/useDiscoverUpdates';
import { useDiscoverUpdateThread } from '@/hooks/discover/useDiscoverUpdateThread';
import { useHiddenUpdates } from '@/hooks/discover/useHiddenUpdates';
import { useDocumentTitlePrefix } from '@/hooks/useDocumentTitlePrefix';

// The thread (comments, composer) loads only when someone opens one.
const DiscoverUpdateThread = dynamic(
    () => import('@/components/discover/DiscoverUpdateThread').then((mod) => mod.DiscoverUpdateThread),
    { ssr: false, loading: () => <p role="status" className="nb-meta">Loading thread…</p> },
);

interface DiscoverClientProps {
    returnUserData: User | null;
    initialProjectsPage?: {
        projects?: Workspace[];
        nextCursor?: string;
        hasMore?: boolean;
        renderedAt?: number;
    } | null;
    initialUpdates?: DiscoverUpdatesPage | null;
    /** The update a `?updateId=` link points at, read on the server with the feed's own visibility rules. */
    initialUpdate?: DiscoverUpdateView | null;
    initialUpdateId?: string | null;
    initialPeopleSuggestions?: ConnectionFeedPage<DiscoverConnectionItem>;
}

type FeedPage = { projects: Workspace[]; nextCursor?: string; hasMore: boolean };
type FeedContext = {
    loadingMore: boolean;
    hasMore: boolean;
    failed: boolean;
    stale: boolean;
    ranked: boolean;
    retry: () => void;
    restart: () => void;
    count: number;
};

const VIRTUOSO_CONTAINER_STYLE = { width: "100%" } as const;
const VIRTUOSO_INCREASE_VIEWPORT_BY = { top: 1200, bottom: 800 } as const;
// Rendered before the scroll container exists (server HTML, first paint), then handed to Virtuoso.
// ponytail: the 6 first-paint cards remount once when Virtuoso takes over; mount Virtuoso at first render if that ever shows.
const FIRST_PAINT_ITEMS = 6;

const computeFeedItemKey = (_: number, item: DiscoverFeedItem) => feedItemKey(item);

/** The end of the feed: loading, the end, or a way on when a page failed. */
const FeedFooter: Components<DiscoverFeedItem, FeedContext>['Footer'] = ({ context }) => {
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
                    <span role="status" className="nb-meta">More didn’t load.</span>
                    <Button type="button" variant="outline" size="sm" onClick={context.retry} className="pointer-coarse:h-11">Retry</Button>
                </>
            ) : context.loadingMore ? (
                <span role="status" className="nb-meta">Loading more…</span>
            ) : !context.hasMore ? (
                // Trending and For you are a ranked top list, not every project.
                <span role="status" className="nb-meta">{context.ranked ? "That’s the top of this list for now." : "You’ve seen everything here."}</span>
            ) : null}
        </div>
    );
};
const virtuosoComponents = { Footer: FeedFooter };

function FeedSkeleton() {
    return (
        <div role="status" className="flex flex-col gap-4">
            <span className="sr-only">Loading the feed…</span>
            {[1, 2, 3].map((item) => <WorkspaceCardSkeleton key={item} />)}
            <DiscoverUpdateCardSkeleton />
            <WorkspaceCardSkeleton />
        </div>
    );
}

export default function DiscoverClient({
    returnUserData,
    initialProjectsPage,
    initialUpdates,
    initialUpdate,
    initialUpdateId,
    initialPeopleSuggestions,
}: DiscoverClientProps) {
    const queryClient = useQueryClient();
    const { user } = useAuth();
    const currentUser = useMemo(() => toDiscoverUser(user, returnUserData), [user, returnUserData]);
    const viewerId = currentUser?.id ?? null;

    const { urlFilters, updateUrlFilters, clearFilters, activeFilters, isDefault } = useDiscoverUrlFilters();
    const { view, q, status, type, sort, tech, hideOpened, show, org, orgType, verified } = urlFilters;
    const { hiddenIds, markSeen } = useDiscoverSessionSeen();
    const [filtersOpen, setFiltersOpen] = useState(false);
    const filtersButton = useRef<HTMLButtonElement>(null);
    const feedHeading = useRef<HTMLHeadingElement>(null);

    const wide = useMediaQuery('(min-width: 1200px)');
    const suggestions = useSuggestedPeople(DISCOVER_RAIL_PEOPLE_LIMIT, undefined, DISCOVER_RAIL_FILTERS, initialPeopleSuggestions, false, true);
    const hasPeople = Boolean(viewerId) && (suggestions.isLoading || (suggestions.data?.pages[0]?.items.length ?? 0) > 0 || suggestions.isError);

    const filters = useMemo(() => ({
        status,
        type,
        tech,
        sort: view === FILTER_VIEWS.TRENDING ? SORT_OPTIONS.TRENDING : sort,
        search: q || undefined,
        ...(show !== 'all' ? { show } : {}),
        ...(org ? { org } : {}),
        ...(show === 'organizations' && orgType ? { orgType } : {}),
        ...(show === 'organizations' && verified ? { verified } : {}),
    }), [org, orgType, q, show, sort, status, tech, type, verified, view]);
    // Show filter (report §24.3): cards by kind on the server; update cards only for Everything and Updates.
    const keeps = showKeeps(show);

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
    } = useDiscoverWorkspaces(viewerId, filters, view, isDefault, initialProjectsPage);

    // Option C (Smart Perceptual Threshold): 0-150ms keeps cards at 100% brightness; >150ms renders skeleton
    const isQueryTransition = (isFetching || isPlaceholderData) && !isFetchingNextPage;
    const [showThresholdSkeleton, setShowThresholdSkeleton] = useState(false);

    useEffect(() => {
        if (!isQueryTransition) {
            setShowThresholdSkeleton(false);
            return;
        }
        const timer = setTimeout(() => {
            setShowThresholdSkeleton(true);
        }, 150);
        return () => clearTimeout(timer);
    }, [isQueryTransition]);

    // Pages can overlap when projects arrive between requests: each project once.
    const allProjects = useMemo(() => {
        const seen = new Set<string>();
        return (data?.pages ?? []).flatMap((page) => page.projects).filter((project) => !seen.has(project.id) && Boolean(seen.add(project.id)));
    }, [data]);

    const visibleProjects = useMemo(
        () => (!keeps.cards ? [] : hideOpened ? allProjects.filter((project) => !hiddenIds.has(project.id)) : allProjects),
        [allProjects, hideOpened, hiddenIds, keeps.cards],
    );

    // Update cards: paged next to the projects, kept a little ahead of how far they have loaded.
    const postsOnly = show === 'updates';
    const postFeed = useDiscoverUpdates({
        viewerId,
        filters,
        view,
        isDefault,
        loadedProjects: allProjects.length,
        initialPage: initialUpdates,
        postsOnly,
    });
    const { updates } = postFeed;
    const { hidden: hiddenUpdates, hide: hideUpdate } = useHiddenUpdates();
    // "Hide opened" hides an update along with the project it belongs to.
    const shownUpdates = useMemo(
        () => (keeps.updates ? updates : []).filter((update) => !hiddenUpdates.has(update.id) && !(hideOpened && hiddenIds.has(update.projectId))),
        [hiddenIds, hiddenUpdates, hideOpened, keeps.updates, updates],
    );
    const feedItems = useMemo<DiscoverFeedItem[]>(
        () => postsOnly
            ? limitPostRuns(shownUpdates, !postFeed.hasMore).map((data) => ({ kind: 'update' as const, data }))
            : interleaveWorkspacesAndUpdates(visibleProjects, shownUpdates),
        [postFeed.hasMore, postsOnly, visibleProjects, shownUpdates],
    );

    const updatesQueryKey = queryKeys.discover.pulse(viewerId, view, filters);
    const thread = useDiscoverUpdateThread({ viewerId, loaded: updates, initialUpdateId, initialUpdate });
    useDocumentTitlePrefix(thread.selected?.projectName ? `Update · ${thread.selected.projectName}` : null); // R8
    // Signed-out viewers have no people to suggest, but keep the rail column anyway when updates are showing, so
    // opening a thread doesn't squeeze the feed from under the cursor.
    const showRail = wide !== false && (hasPeople || Boolean(thread.selectedId) || shownUpdates.length > 0);

    const pageIds = useMemo(() => (data?.pages ?? []).map((page) => page.projects.map((project) => project.id)), [data]);
    const followed = useUserFollowedWorkspaces(viewerId, pageIds);
    const myApplications = useMyApplicationStates(viewerId, pageIds);

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
            if (coverImage !== undefined) {
                // Update cards carry the project's cover too.
                queryClient.setQueriesData<any>({ queryKey: queryKeys.discover.pulseRoot() }, (old: InfiniteData<DiscoverUpdatesPage> | undefined) => old && Array.isArray(old.pages) && ({
                    ...old,
                    pages: old.pages.map((page) => ({
                        ...page,
                        updates: page.updates.map((update) => (update.projectId === targetId || update.projectSlug === targetId ? { ...update, projectCoverImage: coverImage } : update)),
                    })),
                }));
            }
            void queryClient.invalidateQueries({ queryKey: queryKeys.discover.projectsSimpleRoot(), refetchType: 'none' });
            void queryClient.invalidateQueries({ queryKey: queryKeys.discover.pulseRoot(), refetchType: 'none' });
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

    // ---- Scroll: back returns to the same card (shared scroll memory, unified back §3.1); a new scope or filter starts at the top.
    const [scrollContainer, setScrollContainer] = useState<HTMLDivElement | null>(null);
    const scrollContainerRef = useCallback((node: HTMLDivElement | null) => setScrollContainer((prev) => (prev === node ? prev : node)), []);
    const feedKey = JSON.stringify([view, filters, hideOpened]);
    const lastFeedKey = useRef<string | null>(null);

    useEffect(() => {
        if (!scrollContainer) return;
        if (lastFeedKey.current !== null && lastFeedKey.current !== feedKey) scrollContainer.scrollTo({ top: 0 });
        lastFeedKey.current = feedKey;
    }, [feedKey, scrollContainer]);

    // A new scope or filter starts a different list: the open thread belongs to the old one.
    const resetThread = thread.reset;
    const threadFeedKey = useRef(feedKey);
    useEffect(() => {
        if (threadFeedKey.current === feedKey) return;
        threadFeedKey.current = feedKey;
        resetThread();
    }, [feedKey, resetThread]);

    const { hasMore: postsHaveMore, isFetchingMore: postsFetching, fetchMoreFailed: postsFailed, fetchMore: fetchMorePosts } = postFeed;
    const handleEndReached = useCallback(() => {
        if (postsOnly) {
            if (postsHaveMore && !postsFetching && !postsFailed) void fetchMorePosts();
            return;
        }
        if (hasNextPage && !isFetchingNextPage && !isFetchNextPageError) void fetchNextPage();
    }, [fetchMorePosts, hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage, postsFailed, postsFetching, postsHaveMore, postsOnly]);

    // Posts waiting behind the two-in-a-row rule need a post from elsewhere, and the list may not have grown enough to
    // reach its end again, so keep reading until they're placed or the feed runs out.
    // ponytail: reads ahead through a long run from one workspace. Upgrade: a per-workspace cap in the query.
    useEffect(() => {
        if (postsOnly && feedItems.length < shownUpdates.length && postsHaveMore && !postsFetching && !postsFailed) void fetchMorePosts();
    }, [feedItems.length, fetchMorePosts, postsFailed, postsFetching, postsHaveMore, postsOnly, shownUpdates.length]);

    // A ranked list that moved on (its snapshot expired): start it again rather than retry the same page.
    const staleFeed = isFetchNextPageError && error instanceof DiscoverFeedError && error.code === 'STALE_FEED';
    const restartFeed = useCallback(() => {
        scrollContainer?.scrollTo({ top: 0 });
        void queryClient.resetQueries({ queryKey: queryKeys.discover.projectsSimple(viewerId, view, filters) });
    }, [filters, queryClient, scrollContainer, view, viewerId]);

    const feedContext = useMemo<FeedContext>(() => ({
        loadingMore: postsOnly ? postsFetching : isFetchingNextPage,
        hasMore: postsOnly ? postsHaveMore : Boolean(hasNextPage),
        failed: postsOnly ? postsFailed : isFetchNextPageError,
        stale: !postsOnly && staleFeed,
        ranked: view === FILTER_VIEWS.TRENDING || view === FILTER_VIEWS.RECOMMENDATIONS,
        retry: () => void (postsOnly ? fetchMorePosts() : fetchNextPage()),
        restart: restartFeed,
        count: feedItems.length,
    }), [fetchMorePosts, fetchNextPage, hasNextPage, isFetchNextPageError, isFetchingNextPage, postsFailed, postsFetching, postsHaveMore, postsOnly, restartFeed, staleFeed, view, feedItems.length]);

    const following = view === FILTER_VIEWS.FOLLOWING;

    // A project card or an update card.
    const renderFeedItem = useCallback((_: number, item: DiscoverFeedItem) => {
        if (item.kind === 'update') {
            return (
                <div className="pb-4" data-restore-id={feedItemKey(item)}>
                    {/* One card that throws must not take the whole list down with it. */}
                    <ComponentErrorBoundary fallbackMessage="This update couldn’t be shown.">
                        <DiscoverUpdateCard
                            update={item.data}
                            viewerId={viewerId}
                            onOpen={thread.open}
                            onHide={hideUpdate}
                            onVisitProject={markSeen}
                        />
                    </ComponentErrorBoundary>
                </div>
            );
        }

        const project = item.data;
        return (
            <div className="pb-4" data-restore-id={feedItemKey(item)}>
                <ProjectCard
                    project={project}
                    // In Following every card is followed; no flash of "not following" while that loads.
                    isFollowing={following || followed.has(project.id)}
                    followersCount={project.followersCount}
                    applicationChip={myApplications.get(project.id)}
                    onOpenProject={markSeen}
                    live
                />
            </div>
        );
    }, [followed, following, hideUpdate, markSeen, myApplications, thread.open, viewerId]);

    // Clearing moves focus to the feed's heading, so it never drops to the page body.
    const focusFeed = useCallback(() => requestAnimationFrame(() => feedHeading.current?.focus()), []);
    const clearAll = useCallback(() => {
        clearFilters();
        focusFeed();
    }, [clearFilters, focusFeed]);

    // Said once results settle after a search, scope or filter change: "12 projects", "No projects match".
    const settled = !isFetching && !isPlaceholderData && !error;
    const plus = hasNextPage ? '+' : '';
    const announcement = settled && (!isDefault || hideOpened)
        ? postsOnly
            ? feedItems.length ? `${feedItems.length}${postFeed.hasMore ? '+' : ''} ${feedItems.length === 1 && !postFeed.hasMore ? 'post' : 'posts'}` : 'No posts match'
        : feedItems.length
            ? `${visibleProjects.length}${plus} ${visibleProjects.length === 1 && !hasNextPage ? 'project' : 'projects'}${shownUpdates.length ? ` and ${shownUpdates.length}${plus} ${shownUpdates.length === 1 && !hasNextPage ? 'update' : 'updates'}` : ''}`
            : 'No workspaces match'
        : '';

    const emptyState = (() => {
        if (show === 'organizations' && (q || activeFilters)) {
            return <EmptyState icon={Search} title="No organizations match" description="Try another type, or turn off Verified only." action={<Button type="button" variant="outline" onClick={clearAll}>Clear filters</Button>} />;
        }
        if (q || activeFilters) {
            return <EmptyState icon={Search} title="Nothing matches" description="Try other words or fewer filters." action={<Button type="button" variant="outline" onClick={clearAll}>{q ? 'Clear search and filters' : 'Clear filters'}</Button>} />;
        }
        if (postsOnly) {
            return <EmptyState icon={Compass} title={view === FILTER_VIEWS.FOLLOWING ? 'No posts from workspaces you follow yet' : view === FILTER_VIEWS.TRENDING ? 'Nothing is trending yet' : 'No posts yet'} description="When a workspace posts an update for everyone, it shows up here." action={<Button type="button" variant="outline" onClick={() => { updateUrlFilters({ show: 'all', view: FILTER_VIEWS.ALL }); focusFeed(); }}>Browse workspaces</Button>} />;
        }
        if (view === FILTER_VIEWS.FOLLOWING) {
            return <EmptyState icon={Bell} title="Workspaces you follow show up here" description="Follow a workspace to get its updates in this view." action={<Button type="button" variant="outline" onClick={() => { updateUrlFilters({ view: FILTER_VIEWS.ALL }); focusFeed(); }}>Browse all workspaces</Button>} />;
        }
        if (view === FILTER_VIEWS.RECOMMENDATIONS) {
            return <EmptyState icon={Sparkles} title="No matches yet" description="Add skills and interests to your profile to get workspaces that fit you." action={<Button asChild variant="outline"><Link href={ROUTES.MY_PROFILE}>Edit your profile</Link></Button>} />;
        }
        return <EmptyState icon={Compass} title={isDefault ? 'No workspaces yet' : 'No workspaces here yet'} description="Start one and invite people to build it with you." action={<Button asChild><Link href="/workspaces/new"><Plus className="size-4" aria-hidden="true" /> New workspace</Link></Button>} />;
    })();

    const firstPageError = error && visibleProjects.length === 0 && !postsOnly;
    const showSkeleton = (isLoading && !data) || showThresholdSkeleton || (visibleProjects.length === 0 && isQueryTransition && !postsOnly) || (postsOnly && postFeed.isLoading);

    const feed = showSkeleton ? (
        <FeedSkeleton />
    ) : firstPageError ? (
        error instanceof DiscoverFeedError && error.code === 'VALIDATION' ? (
            // A link whose filters can't work: retrying won't help, clearing will.
            <ErrorNotice message={error.message} onRetry={clearAll} actionLabel="Clear filters" />
        ) : (
            <ErrorNotice
                message={error instanceof DiscoverFeedError ? error.message : "Workspaces didn’t load. Check your connection and try again."}
                onRetry={() => void refetch()}
            />
        )
    ) : feedItems.length === 0 ? (
        emptyState
    ) : (
        <div aria-busy={isQueryTransition || undefined}>
            {postsOnly && postFeed.newCount > 0 ? (
                <div className="flex justify-center pb-3">
                    <Button type="button" size="sm" variant="outline" onClick={postFeed.showNew} className="pointer-coarse:h-11">
                        Show {postFeed.newCount} new {postFeed.newCount === 1 ? 'post' : 'posts'}
                    </Button>
                </div>
            ) : null}
            {scrollContainer ? (
                <Virtuoso
                    customScrollParent={scrollContainer}
                    style={VIRTUOSO_CONTAINER_STYLE}
                    data={feedItems}
                    context={feedContext}
                    computeItemKey={computeFeedItemKey}
                    initialItemCount={Math.min(FIRST_PAINT_ITEMS, feedItems.length)}
                    increaseViewportBy={VIRTUOSO_INCREASE_VIEWPORT_BY}
                    endReached={handleEndReached}
                    components={virtuosoComponents}
                    itemContent={renderFeedItem}
                />
            ) : (
                feedItems.slice(0, FIRST_PAINT_ITEMS).map((item, index) => (
                    <div key={computeFeedItemKey(index, item)}>{renderFeedItem(index, item)}</div>
                ))
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
                                loading={isQueryTransition}
                                onChange={updateUrlFilters}
                                onClearFilters={() => clearFilters({ keepSearch: true })}
                                onOpenFilters={() => setFiltersOpen(true)}
                                filtersButtonRef={filtersButton}
                                people={people}
                            />
                        </div>
                        <h2 ref={feedHeading} id="discover-feed" tabIndex={-1} className="sr-only">Workspaces and updates</h2>
                        {feed}
                        {/* With no rail beside the feed, the legal links close the page instead. */}
                        {showRail ? null : <div className="pt-6">{legal}</div>}
                    </div>

                    {showRail ? (
                        <DiscoverRail scrollContainer={scrollContainer} label={thread.selectedId ? 'Update thread' : undefined}>
                            {thread.selected ? (
                                <div className="animate-in fade-in slide-in-from-right-2 duration-180">
                                    <DiscoverUpdateThread
                                        key={thread.selected.id}
                                        update={thread.selected}
                                        viewerId={viewerId}
                                        currentUserName={currentUser?.fullName}
                                        currentUserAvatarUrl={currentUser?.avatarUrl}
                                        updatesQueryKey={updatesQueryKey}
                                        onClose={thread.close}
                                    />
                                </div>
                            ) : thread.loading ? (
                                <p role="status" className="nb-meta">Loading update…</p>
                            ) : (
                                <>
                                    {hasPeople ? <DiscoverPeopleRail initialPage={initialPeopleSuggestions} variant="desktop" /> : null}
                                    <div className="pt-2">{legal}</div>
                                </>
                            )}
                        </DiscoverRail>
                    ) : null}
                </div>
            </div>

            {/* Below 1200px the thread opens in a drawer. */}
            <Dialog
                open={Boolean(thread.selected && wide === false)}
                onOpenChange={(open) => {
                    if (!open) thread.close();
                }}
            >
                <DialogContent presentation="right-drawer" showCloseButton={false} className="w-full max-w-lg overflow-y-auto p-4">
                    <DialogTitle className="sr-only">Update thread</DialogTitle>
                    <DialogDescription className="sr-only">An update and its comments.</DialogDescription>
                    {thread.selected ? (
                        <DiscoverUpdateThread
                            key={thread.selected.id}
                            update={thread.selected}
                            viewerId={viewerId}
                            currentUserName={currentUser?.fullName}
                            currentUserAvatarUrl={currentUser?.avatarUrl}
                            updatesQueryKey={updatesQueryKey}
                            onClose={thread.close}
                        />
                    ) : null}
                </DialogContent>
            </Dialog>

            <DiscoverFiltersPanel
                open={filtersOpen}
                onOpenChange={(open) => {
                    setFiltersOpen(open);
                    if (!open) requestAnimationFrame(() => filtersButton.current?.focus());
                }}
                query={urlFilters}
                activeFilters={activeFilters}
                onChange={(patch: Partial<DiscoverQuery>) => updateUrlFilters(patch)}
                onClear={() => clearFilters({ keepSearch: true })}
            />
        </AppScrollArea>
    );
}

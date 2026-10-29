import DiscoverClient from "@/components/discover/DiscoverClient";
import { getViewerAuthContext, toClientViewer } from "@/lib/server/viewer-context";
import { getPublicWorkspacesFeedPage, forViewer } from "@/lib/workspaces/public-feed-service";
import { mapPublicWorkspaceToDiscoverWorkspace } from "@/lib/workspaces/public-feed";
import { getConnectionsFeed } from "@/app/actions/connections";
import type { ConnectionFeedPage, DiscoverConnectionItem } from "@/hooks/useConnections";
import { DISCOVER_RAIL_FILTERS, DISCOVER_RAIL_PEOPLE_LIMIT, isDefaultDiscoverQuery, parseDiscoverQuery } from "@/lib/discover/query";
import { logger } from "@/lib/logger";
import { getDiscoverUpdate, getDiscoverUpdatesPage } from "@/lib/data/discover-updates";
import { FILTER_VIEWS } from "@/constants/discover";
import type { DiscoverUpdatesPage } from "@/types/discover";

import { buildRouteMetadata } from "@/lib/metadata/route-metadata";

export function generateMetadata() {
    return buildRouteMetadata({
        title: 'Discover · NetworkBase',
        description: 'Find workspaces and people to work with.',
        path: '/discover',
        image: '/og/hub-card.png',
    });
}

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

const INITIAL_PAGE_SIZE = 18;
/** Matches the client's update page size, so the feed doesn't change composition after hydration. */
const INITIAL_UPDATES_PAGE_SIZE = 8;

/** The route's loading.tsx shows the skeleton while this resolves. */
export default async function DiscoverPage({ searchParams }: { searchParams?: SearchParams }) {
    const viewer = await getViewerAuthContext();
    const { user } = viewer;
    // Use the exact suggestion feed that powers /people. A separate “rail-only”
    // filter made the Discovery sidebar empty even when the Network page had
    // eligible people to recommend.
    const peopleSuggestionsPromise = user
        ? getConnectionsFeed({ tab: 'discover', limit: DISCOVER_RAIL_PEOPLE_LIMIT, includeMeta: false, includeSharedConnections: true, filters: DISCOVER_RAIL_FILTERS }).catch((error) => {
            // The rail is extra: without it the page still renders (the rail fetches on its own).
            logger.warn('discover.people_rail_ssr_failed', { error: error instanceof Error ? error.message : String(error) });
            return null;
        })
        : Promise.resolve(null);

    const params = (await searchParams) ?? {};
    const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? null;
    const query = parseDiscoverQuery((key) => first(params[key]));
    const initialUpdateId = first(params.updateId);

    let initialData = null;
    let initialUpdates: DiscoverUpdatesPage | null = null;
    const viewerId = user?.id ?? null;
    // A link to one update is read with the feed's own rules, so its thread opens with the page.
    const initialUpdatePromise = initialUpdateId
        ? getDiscoverUpdate(initialUpdateId, viewerId).catch((error) => {
            logger.warn('discover.update_ssr_failed', { error: error instanceof Error ? error.message : String(error) });
            return null;
        })
        : Promise.resolve(null);
    // ponytail: SSR initial feed page gives 0 CSR waterfall for canonical /discover. ceiling: default unfiltered feed. upgrade: SSR top filter combinations if SEO/traffic demands.
    if (isDefaultDiscoverQuery(query)) {
        try {
            const [initialFeedPage, updatesPage] = await Promise.all([
                getPublicWorkspacesFeedPage(INITIAL_PAGE_SIZE, null),
                getDiscoverUpdatesPage({ limit: INITIAL_UPDATES_PAGE_SIZE, view: FILTER_VIEWS.ALL, viewerId }),
            ]);
            const visible = await forViewer(initialFeedPage.projects, viewerId);
            initialData = {
                projects: visible.map(mapPublicWorkspaceToDiscoverWorkspace),
                nextCursor: initialFeedPage.nextCursor || undefined,
                hasMore: Boolean(initialFeedPage.nextCursor),
                // When this page was read: a later visit can't treat it as fresh.
                renderedAt: initialFeedPage.readTimestamp ?? 0,
            };
            initialUpdates = updatesPage;
        } catch (error) {
            // The feed loads in the browser instead (with its own error and Retry).
            logger.warn('discover.feed_ssr_failed', { error: error instanceof Error ? error.message : String(error) });
        }
    }
    const initialUpdate = await initialUpdatePromise;

    const peopleSuggestionsResult = await peopleSuggestionsPromise;
    const initialPeopleSuggestions: ConnectionFeedPage<DiscoverConnectionItem> | undefined = peopleSuggestionsResult?.success
        ? {
            success: true,
            items: peopleSuggestionsResult.items as DiscoverConnectionItem[],
            nextCursor: null,
            hasMore: false,
            stats: peopleSuggestionsResult.stats,
            viewerSkills: peopleSuggestionsResult.viewerSkills,
            sharedConnections: peopleSuggestionsResult.sharedConnections,
        }
        : undefined;

    const clientViewer = user ? toClientViewer(viewer) : null;
    const hubUser = clientViewer && clientViewer.userId ? {
        id: clientViewer.userId,
        username: clientViewer.username || undefined,
        fullName: clientViewer.displayName || undefined,
        avatarUrl: clientViewer.avatarUrl || undefined,
    } : null;

    return (
        <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
            <DiscoverClient
                returnUserData={hubUser}
                initialProjectsPage={initialData || undefined}
                initialUpdates={initialUpdates}
                initialUpdate={initialUpdate}
                initialUpdateId={initialUpdateId}
                initialPeopleSuggestions={initialPeopleSuggestions}
            />
        </div>
    );
}

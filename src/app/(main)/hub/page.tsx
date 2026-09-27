import { Suspense } from "react";
import { HubRouteSkeleton } from "@/components/hub/HubRouteSkeleton";
import SimpleHubClient from "@/components/hub/SimpleHubClient";
import { PROJECT_STATUS, PROJECT_TYPE, SORT_OPTIONS } from "@/constants/hub";
import { isHardeningDomainEnabled } from "@/lib/features/hardening";
import { getViewerAuthContext, toClientViewer } from "@/lib/server/viewer-context";
import { getPublicProjectsFeedPage } from "@/lib/projects/public-feed-service";
import { mapPublicProjectToHubProject } from "@/lib/projects/public-feed";
import { getConnectionsFeed } from "@/app/actions/connections";
import type { ConnectionFeedPage, DiscoverConnectionItem } from "@/hooks/useConnections";

import { buildRouteMetadata } from "@/lib/metadata/route-metadata";

export function generateMetadata() {
    return buildRouteMetadata({
        title: 'Discover | NetworkBase',
        description: 'Discover and collaborate on the best side-projects and indie apps.',
        path: '/discover',
        image: '/og/hub-card.png',
    });
}

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

async function ResolvedHub({ searchParams }: { searchParams?: SearchParams }) {
    const viewer = await getViewerAuthContext();
    const { user } = viewer;
    const dataHardeningEnabled = isHardeningDomainEnabled("dataV1", user?.id ?? null);
    const initialPageSize = dataHardeningEnabled ? 18 : 24;
    // Use the exact suggestion feed that powers /people. A separate “rail-only”
    // filter made the Discovery sidebar empty even when the Network page had
    // eligible people to recommend.
    const peopleSuggestionsPromise = user
        ? getConnectionsFeed({ tab: 'discover', limit: 3, includeMeta: false })
        : Promise.resolve(null);
    
    let resolvedSearchParams: Record<string, any> = {};
    if (searchParams) {
        resolvedSearchParams = await searchParams;
    }
    
    const first = (value: unknown) => Array.isArray(value) ? value[0] : value;
    const hasFilters =
        (first(resolvedSearchParams.view) && first(resolvedSearchParams.view) !== "all") ||
        (first(resolvedSearchParams.status) && first(resolvedSearchParams.status) !== PROJECT_STATUS.ALL) ||
        (first(resolvedSearchParams.type) && first(resolvedSearchParams.type) !== PROJECT_TYPE.ALL) ||
        (first(resolvedSearchParams.sort) && first(resolvedSearchParams.sort) !== SORT_OPTIONS.NEWEST) ||
        Boolean(first(resolvedSearchParams.tech) || first(resolvedSearchParams.q));
    
    let initialData = null;
    // ponytail: SSR initial feed page gives 0 CSR waterfall for canonical /hub. ceiling: default unfiltered feed. upgrade: SSR top filter combinations if SEO/traffic demands.
    if (!hasFilters) {
        const initialFeedPage = await getPublicProjectsFeedPage(initialPageSize, null);
        initialData = {
            projects: initialFeedPage.projects.map(mapPublicProjectToHubProject),
            nextCursor: initialFeedPage.nextCursor || undefined,
            hasMore: Boolean(initialFeedPage.nextCursor),
        };
    }

    const peopleSuggestionsResult = await peopleSuggestionsPromise;
    const initialPeopleSuggestions: ConnectionFeedPage<DiscoverConnectionItem> | undefined = peopleSuggestionsResult?.success
        ? {
            success: true,
            items: peopleSuggestionsResult.items as DiscoverConnectionItem[],
            nextCursor: null,
            hasMore: false,
            stats: peopleSuggestionsResult.stats,
            viewerSkills: peopleSuggestionsResult.viewerSkills,
        }
        : undefined;

    const clientViewer = user ? toClientViewer(viewer) : null;
    const hubUser = clientViewer && clientViewer.userId ? {
        id: clientViewer.userId,
        username: clientViewer.username || undefined,
        fullName: clientViewer.displayName || undefined,
        avatarUrl: clientViewer.avatarUrl || undefined,
    } : null;

    return <SimpleHubClient
        returnUserData={hubUser}
        initialProjectsPage={initialData || undefined}
        initialPeopleSuggestions={initialPeopleSuggestions}
    />;
}

export default function HubPage({ searchParams }: { searchParams?: SearchParams }) {
    return (
        <div className="h-full min-h-0 overflow-hidden bg-zinc-50 dark:bg-zinc-950 flex flex-col flex-1">
            <Suspense fallback={<HubRouteSkeleton />}>
                <ResolvedHub searchParams={searchParams} />
            </Suspense>
        </div>
    );
}

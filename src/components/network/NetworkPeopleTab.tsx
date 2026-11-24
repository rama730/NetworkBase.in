"use client";

import { CONNECTION_COPY } from "@/lib/connections/copy";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Users } from "lucide-react";
import { toast } from "@/lib/feedback";
import { cn } from "@/lib/utils";

import PersonCard, { PersonCardGrid } from "@/components/network/PersonCard";
import { PersonCardSkeleton } from "@/components/network/PersonCardSkeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import {
    getConnectionRequestSuccessMessage,
    useConnectionMutations,
    useSuggestedPeople,
} from "@/hooks/useConnections";
import {
    activeNetworkFilters,
    networkPersonFilters,
    normalizeNetworkQuery,
    type NetworkBrowseQuery,
} from "@/lib/network/browse-query";
import { ROUTES } from "@/constants/routes";
import { loadedCount, searchMatchLine } from "@/lib/network/mix";
import { NetworkLoadError } from "./NetworkMix";

interface PeopleClientProps {
    initialUser: { id?: string | null } | null;
    searchQuery: string;
    query?: NetworkBrowseQuery;
    onReset?: () => void;
    onReady?: () => void;
    onLoadingChange?: (loading: boolean) => void;
    /** The unfiltered count for the Suggested tab ("06", "20+"). */
    onCount?: (count: string) => void;
}

export default function NetworkPeopleTab({
    initialUser,
    searchQuery,
    query: inputQuery,
    onReset,
    onReady,
    onLoadingChange,
    onCount,
}: PeopleClientProps) {
    const query =
        inputQuery ?? normalizeNetworkQuery("suggested", { q: searchQuery });
    const filtered = Boolean(query.q || activeNetworkFilters(query));
    const {
        data,
        isLoading,
        isFetching,
        isPlaceholderData,
        isError,
        refetch,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage,
        isFetchNextPageError,
    } = useSuggestedPeople(
        20,
        query.q || undefined,
        networkPersonFilters(query),
    );
    const { sendRequest } = useConnectionMutations();
    const profiles = useMemo(
        () => data?.pages.flatMap((page) => page.items) ?? [],
        [data],
    );
    const viewerSkills = data?.pages[0]?.viewerSkills;
    const more = Boolean(hasNextPage);
    useEffect(() => {
        if (data && !filtered && !isPlaceholderData) onCount?.(loadedCount(profiles.length, more));
    }, [data, filtered, isPlaceholderData, profiles.length, more, onCount]);

    // Option C (Smart Perceptual Threshold): 0-150ms keeps cards at 100% brightness; >150ms renders skeleton
    const isQueryTransition = (isFetching || isPlaceholderData) && !isFetchingNextPage;
    const [showThresholdSkeleton, setShowThresholdSkeleton] = useState(false);

    useEffect(() => {
        onLoadingChange?.(isQueryTransition);
    }, [isQueryTransition, onLoadingChange]);

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

    const isInitialLoading = isLoading && !data;
    useEffect(() => {
        if (!isInitialLoading) onReady?.();
    }, [isInitialLoading, onReady]);

    const router = useRouter();
    const handleConnect = useCallback(
        async (userId: string) => {
            if (!initialUser?.id) {
                toast.error("Sign in to connect");
                router.push(
                    `/login?redirect=${encodeURIComponent(ROUTES.NETWORK)}`,
                );
                throw new Error("Sign in to connect");
            }
            // A new request says "Request sent · Undo" on its card (Network mix); other outcomes and failures still toast.
            try {
                const result = await sendRequest.mutateAsync({ userId });
                if (result.status !== "created") toast.success(getConnectionRequestSuccessMessage(result.status));
                return result;
            } catch (error) {
                toast.error(error instanceof Error ? error.message : CONNECTION_COPY.sendFailed);
                throw error;
            }
        },
        [initialUser?.id, router, sendRequest],
    );

    const showSkeleton = isInitialLoading || (profiles.length === 0 && (showThresholdSkeleton || isQueryTransition));

    if (showSkeleton) {
        return (
            <div
                className="nb-person-card-grid grid grid-cols-1 gap-[14px] sm:grid-cols-2"
                aria-label="Loading suggested people"
            >
                <span className="sr-only" role="status">
                    Loading suggested people…
                </span>
                <div className="nb-network-status col-span-full" aria-hidden="true"><span className="h-3 w-48 max-w-full rounded-sm bg-muted" /></div>
                {[1, 2, 3, 4, 5, 6].map((item) => (
                    <PersonCardSkeleton key={item} />
                ))}
            </div>
        );
    }

    if (isError && !data)
        return <NetworkLoadError what="People" onRetry={() => void refetch()} />;
    if (profiles.length === 0 && !hasNextPage) {
        return (
            <EmptyState
                icon={Users}
                figure={filtered ? undefined : "person"}
                title={
                    filtered
                        ? "No people match your search or filters"
                        : "No suggestions yet"
                }
                description={
                    filtered
                        ? "Try a different name, skill, location, or filter."
                        : "New collaboration suggestions will appear here."
                }
                action={
                    filtered && onReset ? (
                        <button
                            className="text-primary hover:underline"
                            onClick={onReset}
                        >
                            Reset search and filters
                        </button>
                    ) : undefined
                }
            />
        );
    }

    return (
        <div className={cn("transition-opacity duration-150", isQueryTransition && profiles.length > 0 && "opacity-80")}>
            <p className="nb-meta nb-network-status mb-3 text-muted-foreground" role="status">
                <span>{query.q ? searchMatchLine(profiles.length, more, query.q) : `${loadedCount(profiles.length, more)} people · best match first`}</span>
                {viewerSkills?.length ? <span className="nb-network-key">also your skill</span> : null}
            </p>
            <PersonCardGrid
                items={profiles}
                getKey={(profile) => profile.id}
                hasNextPage={Boolean(hasNextPage)}
                isFetchingNextPage={isFetchingNextPage}
                isFetchNextPageError={isFetchNextPageError}
                fetchNextPage={fetchNextPage}
                loadingLabel="Loading more suggestions"
                renderItem={(profile, index) => (
                    <PersonCard
                        profile={profile}
                        onConnect={handleConnect}
                        priority={index < 6}
                        viewerSkills={viewerSkills}
                    />
                )}
            />
        </div>
    );
}

"use client";

import { useCallback, useMemo } from "react";
import Link from "next/link";
import { Users } from "lucide-react";
import { toast } from "sonner";

import PersonCard from "@/components/network/PersonCard";
import { PersonCardSkeleton } from "@/components/network/PersonCardSkeleton";
import { CONNECTION_COPY } from "@/lib/connections/copy";
import { Button } from "@/components/ui/button";
import { ErrorNotice } from "@/components/ui/ErrorNotice";
import { Skeleton } from "@/components/ui/skeleton";
import { DISCOVER_RAIL_FILTERS } from "@/lib/discover/query";
import {
    getConnectionRequestSuccessMessage,
    type ConnectionFeedPage,
    type DiscoverConnectionItem,
    useConnectionMutations,
    useSuggestedPeople,
} from "@/hooks/useConnections";

type DiscoverPeopleRailProps = {
    initialPage?: ConnectionFeedPage<DiscoverConnectionItem>;
    variant: "desktop" | "compact";
};

/**
 * Rail suggestion card: follows the exact Network page person card design and layout,
 * including high-contrast matched skill badges, overflow tooltips, and action menus.
 * Uses CONNECTION_COPY.review and CONNECTION_COPY.notAccepting through PersonCard.
 */
function SuggestedPersonCard({
    profile,
    viewerSkills,
}: {
    profile: DiscoverConnectionItem;
    viewerSkills: string[];
}) {
    const { sendRequest } = useConnectionMutations();

    const connect = useCallback(async (userId: string) => {
        if (profile.canConnect === false || sendRequest.isPending) return;
        try {
            await toast.promise(sendRequest.mutateAsync({ userId }), {
                loading: CONNECTION_COPY.sending,
                success: (result) => getConnectionRequestSuccessMessage(result.status),
                error: (error) => error instanceof Error ? error.message : CONNECTION_COPY.sendFailed,
            }).unwrap();
        } catch {
            // onError in mutation handles rollback; the toast displays the error.
        }
    }, [profile.canConnect, sendRequest]);

    return (
        <PersonCard
            profile={profile}
            onConnect={connect}
            viewerSkills={viewerSkills}
        />
    );
}

/** The rail's shape while it loads: mirrors PersonCard geometry so loading and loaded cards share alignment. */
function RailSkeleton({ variant }: { variant: "desktop" | "compact" }) {
    return (
        <section role="status">
            <span className="sr-only">Loading people you should meet…</span>
            {variant === "desktop" ? (
                <div className="mb-3 flex items-center gap-3" aria-hidden="true">
                    <Skeleton className="h-3 w-40 rounded-sm" />
                    <div className="h-px flex-1 bg-border" />
                </div>
            ) : null}
            <div className="space-y-3" aria-hidden="true">
                {[0, 1, 2].map((item) => (
                    <PersonCardSkeleton key={item} />
                ))}
            </div>
        </section>
    );
}

export function DiscoverPeopleRail({ initialPage, variant }: DiscoverPeopleRailProps) {
    const { data, isLoading, isError, refetch } = useSuggestedPeople(3, undefined, DISCOVER_RAIL_FILTERS, initialPage, false);
    const people = useMemo(() => data?.pages[0]?.items ?? [], [data]);
    const viewerSkills = data?.pages[0]?.viewerSkills ?? [];

    if (isLoading && people.length === 0) return <RailSkeleton variant={variant} />;

    // A failed refresh keeps the people already shown; only a first load that fails says so.
    if (isError && people.length === 0) return <ErrorNotice what="People you should meet" onRetry={() => void refetch()} />;

    // Nothing to suggest: the rail steps aside and the feed takes the width (spec §15).
    if (people.length === 0) return null;

    return (
        <section aria-labelledby={variant === "desktop" ? "people-you-should-meet" : undefined}>
            {/* In the drawer the dialog's title already says it. */}
            {variant === "desktop" ? (
                <div className="mb-3 flex items-center gap-3">
                    <h2 id="people-you-should-meet" className="nb-micro whitespace-nowrap">People you should meet</h2>
                    <div className="h-px flex-1 bg-border" aria-hidden="true" />
                </div>
            ) : null}
            <div className="space-y-3">
                {people.map((profile) => <SuggestedPersonCard key={profile.id} profile={profile} viewerSkills={viewerSkills} />)}
            </div>
            <Button asChild variant="ghost" size="sm" className="mt-2 -ml-2.5 text-primary">
                <Link href="/network?tab=suggested"><Users className="size-4" aria-hidden="true" /> Explore people</Link>
            </Button>
        </section>
    );
}

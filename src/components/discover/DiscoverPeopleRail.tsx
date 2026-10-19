"use client";

import { useCallback, useMemo } from "react";
import Link from "next/link";
import { toast } from "sonner";

import PersonCard from "@/components/network/PersonCard";
import { PersonCardSkeleton } from "@/components/network/PersonCardSkeleton";
import { CONNECTION_COPY } from "@/lib/connections/copy";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { profileHref } from "@/lib/routing/identifiers";
import { ErrorNotice } from "@/components/ui/ErrorNotice";
import { Skeleton } from "@/components/ui/skeleton";
import { RailSection, RailSectionHeading } from "@/components/ui/rail-section";
import { DISCOVER_RAIL_CARD_COUNT, DISCOVER_RAIL_FILTERS, DISCOVER_RAIL_PEOPLE_LIMIT } from "@/lib/discover/query";
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
            return await toast.promise(sendRequest.mutateAsync({ userId }), {
                loading: CONNECTION_COPY.sending,
                success: (result) => getConnectionRequestSuccessMessage(result.status),
                error: (error) => error instanceof Error ? error.message : CONNECTION_COPY.sendFailed,
            }).unwrap();
        } catch {
            // Propagate failure so the card cannot turn a failed request into Requested.
            throw new Error(CONNECTION_COPY.sendFailed);
        }
    }, [profile.canConnect, sendRequest]);

    return (
        <PersonCard
            profile={profile}
            variant="rail"
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
                    <PersonCardSkeleton key={item} variant="rail" />
                ))}
            </div>
        </section>
    );
}

export function DiscoverPeopleRail({ initialPage, variant }: DiscoverPeopleRailProps) {
    const { data, isLoading, isError, refetch } = useSuggestedPeople(DISCOVER_RAIL_PEOPLE_LIMIT, undefined, DISCOVER_RAIL_FILTERS, initialPage, false, true);
    const suggestions = useMemo(() => data?.pages[0]?.items ?? [], [data]);
    const people = suggestions.slice(0, DISCOVER_RAIL_CARD_COUNT);
    const viewerSkills = data?.pages[0]?.viewerSkills ?? [];
    const shared = data?.pages[0]?.sharedConnections;
    const sharedMatchesPeople = shared?.targetIds.length === people.length
        && shared.targetIds.every(id => people.some(person => person.id === id));
    const showShared = sharedMatchesPeople && shared && shared.total > 0 && shared.people.length > 0;
    const previewPeople = showShared ? shared.people : suggestions.slice(DISCOVER_RAIL_CARD_COUNT, DISCOVER_RAIL_PEOPLE_LIMIT)
        .filter(person => person.connectionStatus === 'none' && person.canConnect !== false && !person.isLockedProfile);

    if (isLoading && people.length === 0) return <RailSkeleton variant={variant} />;

    // A failed refresh keeps the people already shown; only a first load that fails says so.
    if (isError && people.length === 0) return <ErrorNotice what="People you should meet" onRetry={() => void refetch()} />;

    // Nothing to suggest: the rail steps aside and the feed takes the width (spec §15).
    if (people.length === 0) return null;

    return (
        <section aria-labelledby={variant === "desktop" ? "people-you-should-meet" : undefined}>
            {/* In the drawer the dialog's title already says it. */}
            {variant === "desktop" ? (
                <RailSectionHeading id="people-you-should-meet" title="People you should meet" />
            ) : null}
            <div className="space-y-3">
                {people.map((profile) => <SuggestedPersonCard key={profile.id} profile={profile} viewerSkills={viewerSkills} />)}
            </div>
            {previewPeople.length > 0 ? (
                <RailSection title={showShared ? "Shared connections" : "More people to meet"} className="mt-6" contentClassName="flex items-center gap-3 bg-muted/40 p-3">
                    <p className="sr-only">{showShared ? `${shared.total} ${shared.total === 1 ? 'connection' : 'connections'} shared with the people suggested above.` : 'Additional suggestions for your network.'}</p>
                    <div className="flex shrink-0 items-center gap-1">
                        {previewPeople.map(person => (
                            <Link key={person.id} href={profileHref(person)}
                                aria-label={`View ${person.fullName || person.username || 'connection'}’s profile`}
                                className="nb-touch-target flex size-7 items-center justify-center rounded-[3px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                                <UserAvatar identity={person} size={26} roundedClassName="rounded-[3px]" className="border border-border" fallbackClassName="text-[10px]" />
                            </Link>
                        ))}
                    </div>
                    {showShared && shared.total > shared.people.length ? (
                        <span className="nb-meta min-w-0">and {shared.total - shared.people.length} {shared.total - shared.people.length === 1 ? 'other' : 'others'}</span>
                    ) : !showShared ? <Link href="/network?tab=suggested" className="nb-ui-label nb-touch-target inline-flex min-w-0 items-center text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">View more</Link> : null}
                </RailSection>
            ) : null}
        </section>
    );
}

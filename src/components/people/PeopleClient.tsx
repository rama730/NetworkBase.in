"use client";

import { forwardRef, useCallback, useEffect, useMemo, useState, type HTMLAttributes } from "react";
import { Loader2, Users } from "lucide-react";
import { VirtuosoGrid } from "react-virtuoso";
import { toast } from "sonner";
import { useDebounce } from "use-debounce";

import PersonCard from "@/components/people/PersonCard";
import { PersonCardSkeleton } from "@/components/people/PersonCardSkeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { getConnectionRequestSuccessMessage, useConnectionMutations, useSuggestedPeople } from "@/hooks/useConnections";

interface PeopleClientProps {
    initialUser: { id?: string | null } | null;
    searchQuery: string;
}

const GridList = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>((props, ref) => (
    <div {...props} ref={ref} className="grid grid-cols-1 gap-[14px] pb-8 sm:grid-cols-2" />
));
GridList.displayName = "SuggestedPeopleGrid";

const GridItem = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>((props, ref) => (
    <div {...props} ref={ref} className="h-[158px]" />
));
GridItem.displayName = "SuggestedPersonItem";

export default function PeopleClient({ initialUser, searchQuery }: PeopleClientProps) {
    const [debouncedSearch] = useDebounce(searchQuery, 300);
    const [routeScrollParent, setRouteScrollParent] = useState<HTMLElement | null>(() =>
        typeof document === "undefined" ? null : document.querySelector<HTMLElement>("[data-scroll-root=\"route\"]"),
    );

    useEffect(() => {
        setRouteScrollParent(document.querySelector<HTMLElement>("[data-scroll-root=\"route\"]"));
    }, []);

    const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useSuggestedPeople(20, debouncedSearch || undefined);
    const { sendRequest } = useConnectionMutations();
    const profiles = useMemo(() => data?.pages.flatMap((page) => page.items) ?? [], [data]);
    const viewerSkills = data?.pages[0]?.viewerSkills;
    const isInitialLoading = isLoading && profiles.length === 0;

    const handleConnect = useCallback(async (userId: string) => {
        if (!initialUser?.id) {
            toast.error("Please log in to connect");
            return;
        }
        await toast.promise(sendRequest.mutateAsync({ userId }), {
            loading: "Sending request...",
            success: (result) => getConnectionRequestSuccessMessage(result.status),
            error: (error) => error instanceof Error ? error.message : "Failed to send request",
        });
    }, [initialUser?.id, sendRequest]);

    if (isInitialLoading) {
        return (
            <div className="grid grid-cols-1 gap-[14px] sm:grid-cols-2" aria-label="Loading suggested people">
                <span className="sr-only" role="status">Loading suggested people…</span>
                {[1, 2, 3, 4, 5, 6].map((item) => <PersonCardSkeleton key={item} />)}
            </div>
        );
    }

    if (profiles.length === 0) {
        return (
            <EmptyState
                icon={Users}
                title={debouncedSearch ? "No people match your search." : "No suggestions yet."}
                description={debouncedSearch ? "Try a different name, skill, or location." : "New collaboration suggestions will appear here."}
            />
        );
    }

    return (
        <div style={{ minHeight: 400 }}>
            <VirtuosoGrid
                customScrollParent={routeScrollParent ?? undefined}
                increaseViewportBy={600}
                data={profiles}
                computeItemKey={(_, profile) => profile.id}
                endReached={() => {
                    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
                }}
                components={{
                    List: GridList,
                    Item: GridItem,
                    Footer: () => isFetchingNextPage ? (
                        <div className="col-span-full flex justify-center py-6"><Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="Loading more suggestions" /></div>
                    ) : null,
                }}
                itemContent={(index, profile) => (
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

"use client";

import { CONNECTION_COPY } from "@/lib/connections/copy";
import { useCallback, useMemo } from "react";
import { Users } from "lucide-react";
import { toast } from "sonner";
import { useDebounce } from "use-debounce";

import PersonCard, { PersonCardGrid } from "@/components/network/PersonCard";
import { PersonCardSkeleton } from "@/components/network/PersonCardSkeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { getConnectionRequestSuccessMessage, useConnectionMutations, useSuggestedPeople } from "@/hooks/useConnections";

interface PeopleClientProps {
    initialUser: { id?: string | null } | null;
    searchQuery: string;
}

export default function NetworkPeopleTab({ initialUser, searchQuery }: PeopleClientProps) {
    const [debouncedSearch] = useDebounce(searchQuery, 300);
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
            loading: CONNECTION_COPY.sending,
            success: (result) => getConnectionRequestSuccessMessage(result.status),
            error: (error) => error instanceof Error ? error.message : CONNECTION_COPY.sendFailed,
        }).unwrap();
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
        <PersonCardGrid
            items={profiles}
            getKey={(profile) => profile.id}
            hasNextPage={Boolean(hasNextPage)}
            isFetchingNextPage={isFetchingNextPage}
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
    );
}

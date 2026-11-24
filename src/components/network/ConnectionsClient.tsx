"use client";

import { CONNECTION_COPY } from "@/lib/connections/copy";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PersonCardContent } from "./PersonCardContent";
import { personCardName } from "@/lib/network/person-card";
import Link from "next/link";
import {
    Ban,
    Check,
    ChevronDown,
    MessageSquare,
    UserMinus,
    Users,
} from "@/components/ui/icons";
import { toast } from "@/lib/feedback";

import { EmptyState } from "@/components/ui/EmptyState";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

import { PersonCardGrid } from "@/components/network/PersonCard";
import { PersonCardSkeleton } from "@/components/network/PersonCardSkeleton";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import {
    useConnectionMutations,
    useConnections,
    type NetworkConnectionItem,
} from "@/hooks/useConnections";
import { profileHref } from "@/lib/routing/identifiers";

import { messageUserInWindow } from "@/components/messages/message-user";
import { useBlockFlow } from "@/components/privacy/BlockDialog";
import {
    activeNetworkFilters,
    networkPersonFilters,
    normalizeNetworkQuery,
    type NetworkBrowseQuery,
} from "@/lib/network/browse-query";
import { padCount } from "@/lib/ui/tab-marker";
import { searchMatchLine } from "@/lib/network/mix";
import { useNetworkNotifications } from "@/hooks/useNetworkNotifications";
import { NetworkLoadError } from "./NetworkMix";

export default function ConnectionsClient({
    searchQuery,
    query: inputQuery,
    onReset,
    onReady,
    onLoadingChange,
    onSortChange,
}: {
    searchQuery: string;
    query?: NetworkBrowseQuery;
    onReset?: () => void;
    onReady?: () => void;
    onLoadingChange?: (loading: boolean) => void;
    /** Recent · Name on the status line (Network mix); the same sort as Filters. */
    onSortChange?: (sort: "recent" | "name") => void;
}) {
    const { totalConnections } = useNetworkNotifications();
    const query =
        inputQuery ?? normalizeNetworkQuery("connections", { q: searchQuery });
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
    } = useConnections(
        50,
        query.q || undefined,
        query.sort === "name" ? "name" : "recent",
        networkPersonFilters(query),
    );
    const { disconnect } = useConnectionMutations();

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
    const [pendingDisconnect, setPendingDisconnect] = useState<{
        id: string;
        name: string;
    } | null>(null);
    // One Block confirmation for the list, with its consequences and Undo (Blocking B5).
    const blockFlow = useBlockFlow("person_card");
    const connections = useMemo(
        () =>
            (data?.pages.flatMap((page) => page.items) ?? []).filter((item) =>
                Boolean(item.otherUser),
            ),
        [data],
    );

    const handleDisconnect = useCallback(async () => {
        if (!pendingDisconnect) return;
        try {
            await toast
                .promise(disconnect.mutateAsync(pendingDisconnect.id), {
                    loading: "Disconnecting…",
                    success: "Connection removed",
                    error: (error) =>
                        error instanceof Error
                            ? error.message
                            : "Couldn’t remove connection",
                })
                .unwrap();
        } catch {
            // Handled
        } finally {
            setPendingDisconnect(null);
        }
    }, [disconnect, pendingDisconnect]);

    const isInitialLoading = isLoading && !data;
    useEffect(() => {
        if (!isInitialLoading) onReady?.();
    }, [isInitialLoading, onReady]);

    const showSkeleton = isInitialLoading || showThresholdSkeleton || (connections.length === 0 && isQueryTransition);

    if (showSkeleton) {
        return (
            <div
                className="nb-person-card-grid grid grid-cols-1 gap-[14px] sm:grid-cols-2"
                aria-label="Loading connections"
            >
                <span className="sr-only" role="status">
                    Loading connections…
                </span>
                {[1, 2, 3, 4].map((item) => (
                    <PersonCardSkeleton key={item} />
                ))}
            </div>
        );
    }

    if (isError && !data)
        return <NetworkLoadError what="Connections" onRetry={() => void refetch()} />;
    if (connections.length === 0 && !hasNextPage) {
        return (
            <EmptyState
                icon={Users}
                figure={filtered ? undefined : "person"}
                title={
                    filtered
                        ? "No connections match your search or filters"
                        : "Your connections live here"
                }
                description={
                    filtered
                        ? "Try a different name, skill, location, or filter."
                        : "People you connect with will appear here."
                }
                action={
                    filtered && onReset ? (
                        <button
                            className="text-primary hover:underline"
                            onClick={onReset}
                        >
                            Reset search and filters
                        </button>
                    ) : !filtered ? (
                        <Link
                            href="/network?tab=suggested"
                            className="text-sm max-md:text-[13px] font-medium text-primary hover:underline"
                        >
                            Find people to connect with
                        </Link>
                    ) : undefined
                }
            />
        );
    }

    return (
        <>
            <div className="nb-meta nb-network-status mb-3 text-muted-foreground">
                <span role="status">{query.q ? searchMatchLine(connections.length, Boolean(hasNextPage), query.q, totalConnections || undefined) : `${padCount(totalConnections || connections.length)} connections`}</span>
                {onSortChange ? (
                    <span className="nb-network-sort" role="radiogroup" aria-label="Sort connections">
                        {(["recent", "name"] as const).map((sort) => {
                            const checked = (query.sort === "name" ? "name" : "recent") === sort;
                            return (
                                <button key={sort} type="button" role="radio" aria-checked={checked} tabIndex={checked ? 0 : -1}
                                    onClick={() => onSortChange(sort)}
                                    onKeyDown={(event) => {
                                        if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
                                        event.preventDefault();
                                        const next = sort === "recent" ? "name" : "recent";
                                        const group = event.currentTarget.parentElement;
                                        onSortChange(next);
                                        requestAnimationFrame(() => group?.querySelector<HTMLElement>(`[data-sort="${next}"]`)?.focus());
                                    }}
                                    data-sort={sort}>
                                    {sort === "recent" ? "Recent" : "Name"}
                                </button>
                            );
                        })}
                    </span>
                ) : null}
            </div>
            <PersonCardGrid
                items={connections}
                getKey={(connection) => connection.id}
                hasNextPage={Boolean(hasNextPage)}
                isFetchingNextPage={isFetchingNextPage}
                isFetchNextPageError={isFetchNextPageError}
                fetchNextPage={fetchNextPage}
                loadingLabel="Loading more connections"
                renderItem={(connection) => (
                    <ConnectionCard
                        connection={connection}
                        onDisconnect={(id, name) =>
                            setPendingDisconnect({ id, name })
                        }
                        onBlock={(userId, name) =>
                            blockFlow.openBlock({ id: userId, name })
                        }
                    />
                )}
            />

            <ConfirmDialog
                open={Boolean(pendingDisconnect)}
                onOpenChange={(open) => !open && setPendingDisconnect(null)}
                title={
                    pendingDisconnect
                        ? `Remove connection with ${pendingDisconnect.name}?`
                        : "Remove connection?"
                }
                description="They will not be notified, but you will no longer see each other’s connection updates."
                confirmLabel="Disconnect"
                variant="destructive"
                loading={disconnect.isPending}
                onConfirm={() => void handleDisconnect()}
            />

            {blockFlow.dialog}
        </>
    );
}

function ConnectionCard({
    connection,
    onDisconnect,
    onBlock,
}: {
    connection: NetworkConnectionItem;
    onDisconnect: (id: string, name: string) => void;
    onBlock: (userId: string, name: string) => void;
}) {
    const user = connection.otherUser;
    if (!user) return null;
    const displayName = personCardName(user);
    return (
        <PersonCardContent
            person={user}
            connected
            acceptedAt={connection.acceptedAt}
            action={
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <button
                            type="button"
                            className="nb-touch-target inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-2.5 text-sm max-md:text-[13px] font-medium text-foreground hover:bg-muted"
                            aria-label={`Connection actions for ${displayName}`}
                        >
                            <Check
                                className="size-4 text-[var(--status-success)]"
                                aria-hidden="true"
                            />
                            <span className="max-sm:sr-only">Connected</span>
                            <ChevronDown
                                className="size-3.5 text-muted-foreground"
                                aria-hidden="true"
                            />
                        </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        {user.canSendMessage ? (
                            <>
                                <DropdownMenuItem asChild>
                                    <Link
                                        href={`/messages?userId=${user.id}`}
                                        onClick={(event) =>
                                            messageUserInWindow(user.id, event)
                                        }
                                    >
                                        <MessageSquare className="size-4" />
                                        Message
                                    </Link>
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                            </>
                        ) : null}
                        <DropdownMenuItem
                            onClick={() =>
                                onDisconnect(connection.id, displayName)
                            }
                            variant="destructive"
                        >
                            <UserMinus className="size-4" />
                            Disconnect
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            onClick={() => onBlock(user.id, displayName)}
                            variant="destructive"
                        >
                            <Ban className="size-4" />
                            Block
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            }
        />
    );
}

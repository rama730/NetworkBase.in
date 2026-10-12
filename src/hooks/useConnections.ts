import { useEffect, useRef, useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import {
    InfiniteData,
    QueryKey,
    useInfiniteQuery,
    useMutation,
    useQuery,
    useQueryClient,
} from '@tanstack/react-query';
import { MAX_RETAINED_PERSON_QUERY_PAGES } from '@/lib/network/person-card-bounds';
import {
    acceptAllIncomingConnectionRequests,
    acceptConnectionRequest,
    cancelConnectionRequest,
    withdrawAllSentConnectionRequests,
    dismissConnectionSuggestion,
    getConnectionsFeed,
    rejectAllIncomingConnectionRequests,
    rejectConnectionRequest,
    removeConnection,
    sendConnectionRequest,
    undoRejectConnectionRequest,
    type ConnectionStats,
    type ConnectionsFeedInput,
    type ConnectionsFeedTab,
    type DiscoverFilters,
    type HistoryFilters,
    type SuggestedProfile,
} from '@/app/actions/connections';
import { queryKeys } from '@/lib/query-keys';

export type FeedStats = Pick<ConnectionStats, 'totalConnections' | 'pendingIncoming' | 'pendingSent'>;

export function getConnectionRequestSuccessMessage(status?: string) {
    if (status === 'pending_sent') return 'Connection request already pending';
    if (status === 'pending_received') return 'They already sent you a request';
    if (status === 'connected') return 'Already connected';
    return 'Connection request sent';
}

export type NetworkConnectionItem = {
    id: string;
    type: 'network';
    requesterId: string;
    addresseeId: string;
    status: string;
    createdAt: Date;
    updatedAt: Date;
    otherUser: {
        id: string;
        username: string | null;
        fullName: string | null;
        avatarUrl: string | null;
        headline: string | null;
        location: string | null;
        skills?: string[];
        interests?: string[];
        bio?: string | null;
        openTo?: string[];
        messagePrivacy?: SuggestedProfile['messagePrivacy'];
        canSendMessage?: boolean;
        lastActiveAt?: string | null;
    };
};

export type DiscoverConnectionItem = SuggestedProfile & {
    type: 'discover';
};

type RequestFeedUser = {
    id: string;
    username: string | null;
    fullName: string | null;
    avatarUrl: string | null;
    headline: string | null;
    location: string | null;
    skills?: string[];
    interests?: string[];
    openTo?: string[];
    messagePrivacy?: SuggestedProfile['messagePrivacy'];
    canSendMessage?: boolean;
    lastActiveAt?: string | null;
};

export type RequestConnectionItem = {
    id: string;
    type: 'requests_incoming' | 'requests_sent';
    requesterId: string;
    addresseeId: string;
    status: string;
    createdAt: Date;
    updatedAt: Date;
    message?: string | null;
    mutualCount?: number;
    user: RequestFeedUser;
};

type FeedItemByTab = {
    network: NetworkConnectionItem;
    discover: DiscoverConnectionItem;
    requests_incoming: RequestConnectionItem;
    requests_sent: RequestConnectionItem;
};

type FeedPage<T> = {
    success: true;
    items: T[];
    hasMore: boolean;
    nextCursor: string | null;
    stats: FeedStats;
    viewerProjectIds?: string[];
    viewerSkills?: string[];
};

export type ConnectionFeedPage<T> = FeedPage<T>;

type FeedErrorPage = {
    success: false;
    error?: string;
    items: [];
    hasMore: false;
    nextCursor: null;
    stats: FeedStats;
};

export type PendingIncomingRequest = {
    id: string;
    requesterId: string;
    addresseeId: string;
    status: string;
    createdAt: Date;
    requesterUsername: string | null;
    requesterFullName: string | null;
    requesterAvatarUrl: string | null;
    requesterHeadline: string | null;
    requesterLocation?: string | null;
    requesterSkills?: string[];
    requesterOpenTo?: string[];
    requesterMessagePrivacy?: SuggestedProfile['messagePrivacy'];
    requesterCanSendMessage?: boolean;
    requesterLastActiveAt?: string | null;
    message?: string | null;
    mutualCount?: number;
};

export type PendingSentRequest = {
    id: string;
    requesterId: string;
    addresseeId: string;
    status: string;
    createdAt: Date;
    addresseeUsername: string | null;
    addresseeFullName: string | null;
    addresseeAvatarUrl: string | null;
    addresseeHeadline: string | null;
    addresseeLocation?: string | null;
    addresseeSkills?: string[];
    addresseeOpenTo?: string[];
    addresseeMessagePrivacy?: SuggestedProfile['messagePrivacy'];
    addresseeCanSendMessage?: boolean;
    addresseeLastActiveAt?: string | null;
};

export type PendingRequestsData = {
    incoming: PendingIncomingRequest[];
    sent: PendingSentRequest[];
    hasMoreIncoming: boolean;
    hasMoreSent: boolean;
    stats: FeedStats;
};

const EMPTY_STATS: FeedStats = {
    totalConnections: 0,
    pendingIncoming: 0,
    pendingSent: 0,
};

export const CONNECTIONS_QUERY_KEYS = {
    root: ['connections'] as const,
    feed: (tab: ConnectionsFeedTab, limit: number, search?: string) =>
        ['connections', 'feed', tab, limit, search || ''] as const,
    pendingRequests: (limit: number) => ['connections', 'pending-requests', limit] as const,
    requestHistory: (limit: number) => ['connections', 'request-history', limit] as const,
    suggestions: (limit: number, search?: string) => ['connections', 'suggestions', limit, search || ''] as const,
};

function normalizeFeedResult<T>(result: FeedPage<T> | FeedErrorPage): FeedPage<T> {
    if (!result.success) {
        throw new Error(result.error || 'Failed to load connections');
    }
    return result;
}

function updateFeedQueries<T>(
    queryClient: ReturnType<typeof useQueryClient>,
    keyPrefix: QueryKey,
    updater: (page: FeedPage<T>) => FeedPage<T>,
) {
    const all = queryClient.getQueriesData<InfiniteData<FeedPage<T>>>({ queryKey: keyPrefix });
    for (const [key, data] of all) {
        if (!data) continue;
        const next: InfiniteData<FeedPage<T>> = {
            ...data,
            pages: data.pages.map((page) => updater(page)),
        };
        queryClient.setQueryData(key, next);
    }
}

function updateStatsQueries(
    queryClient: ReturnType<typeof useQueryClient>,
    updater: (stats: FeedStats) => FeedStats,
) {
    const keys = queryClient.getQueriesData<FeedStats>({
        queryKey: ['connections', 'stats'],
    });

    for (const [key, value] of keys) {
        if (!value) continue;
        queryClient.setQueryData(
            key,
            updater({
                totalConnections: Number(value.totalConnections || 0),
                pendingIncoming: Number(value.pendingIncoming || 0),
                pendingSent: Number(value.pendingSent || 0),
            }),
        );
    }
}

function updatePendingRequestQueries(
    queryClient: ReturnType<typeof useQueryClient>,
    updater: (prev: PendingRequestsData) => PendingRequestsData,
) {
    queryClient.setQueriesData<PendingRequestsData>(
        { queryKey: ['connections', 'pending-requests'] },
        (prev) => {
            if (!prev) return prev;
            return updater(prev);
        },
    );
}

function patchDiscoverAndSuggestionStatus(
    queryClient: ReturnType<typeof useQueryClient>,
    input: {
        userIds?: Iterable<string | null | undefined>;
        connectionIds?: Iterable<string | null | undefined>;
        status: DiscoverConnectionItem['connectionStatus'];
        canConnect: boolean;
        connectionId?: string;
    },
) {
    const userIds = new Set(Array.from(input.userIds ?? []).filter((id): id is string => !!id));
    const connectionIds = new Set(Array.from(input.connectionIds ?? []).filter((id): id is string => !!id));
    const patch = (item: DiscoverConnectionItem): DiscoverConnectionItem => {
        if (!userIds.has(item.id) && (!item.connectionId || !connectionIds.has(item.connectionId))) {
            return item;
        }
        return {
            ...item,
            connectionStatus: input.status,
            canConnect: input.canConnect,
            connectionId: input.connectionId,
        };
    };

    updateFeedQueries<DiscoverConnectionItem>(queryClient, ['connections', 'feed', 'discover'], (page) => ({
        ...page,
        items: page.items.map(patch),
    }));

    queryClient.setQueriesData<Array<{
        kind: string;
        userId?: string;
        connectionStatus?: DiscoverConnectionItem['connectionStatus'];
        canConnect?: boolean;
    }>>({ queryKey: queryKeys.globalSearch.networkRoot() }, (items) => items?.map((item) =>
        item.kind === 'profile' && item.userId && userIds.has(item.userId)
            ? { ...item, connectionStatus: input.status, canConnect: input.canConnect }
            : item,
    ));

}

function invalidateConnectionsScoped(queryClient: ReturnType<typeof useQueryClient>) {
    void queryClient.invalidateQueries({ queryKey: ['connections', 'feed', 'network'] });
    void queryClient.invalidateQueries({ queryKey: ['connections', 'feed', 'discover'] });
    void queryClient.invalidateQueries({ queryKey: ['connections', 'feed', 'requests_incoming'] });
    void queryClient.invalidateQueries({ queryKey: ['connections', 'feed', 'requests_sent'] });
    void queryClient.invalidateQueries({ queryKey: ['connections', 'pending-requests'] });
    void queryClient.invalidateQueries({ queryKey: queryKeys.connections.pending() });
    void queryClient.invalidateQueries({ queryKey: ['connections', 'request-history'] });
    void queryClient.invalidateQueries({ queryKey: ['connections', 'stats'] });
}

async function cancelConnectionsScoped(queryClient: ReturnType<typeof useQueryClient>) {
    await Promise.all([
        queryClient.cancelQueries({ queryKey: ['connections', 'feed'] }),
        queryClient.cancelQueries({ queryKey: ['connections', 'pending-requests'] }),
        queryClient.cancelQueries({ queryKey: ['connections', 'stats'] }),
    ]);
}

export function useConnectionsFeed<TTab extends ConnectionsFeedTab>(
    tab: TTab,
    options?: {
        limit?: number;
        search?: string;
        sortBy?: 'recent' | 'name' | 'oldest';
        enabled?: boolean;
        filters?: DiscoverFilters;
        historyFilters?: HistoryFilters;
        requestSortBy?: 'recent' | 'mutual' | 'oldest';
        initialPage?: FeedPage<FeedItemByTab[TTab]>;
        /** false skips connection stats and owned-project ids (a rail needs neither). */
        includeMeta?: boolean;
    },
) {
    const limit = options?.limit ?? 20;
    const search = options?.search;
    const sortBy = options?.sortBy;
    const enabled = options?.enabled ?? true;
    const filters = options?.filters;
    const historyFilters = options?.historyFilters;
    const requestSortBy = options?.requestSortBy;
    const initialPage = options?.initialPage;
    const includeMeta = options?.includeMeta;

    // 2J: Include filters and requestSortBy in queryKey for cache separation
    const filtersKey = filters ? JSON.stringify(filters) : '';
    const requestSortKey = requestSortBy || '';

    return useInfiniteQuery({
        queryKey: [...CONNECTIONS_QUERY_KEYS.feed(tab, limit, search), sortBy || 'recent', filtersKey, requestSortKey] as const,
        queryFn: async ({ pageParam }: { pageParam: string | undefined }) => {
            const result = await getConnectionsFeed({
                tab,
                limit,
                search,
                sortBy,
                cursor: pageParam,
                filters,
                historyFilters,
                requestSortBy,
                includeMeta,
            } satisfies ConnectionsFeedInput);

            return normalizeFeedResult(result as FeedPage<FeedItemByTab[TTab]> | FeedErrorPage);
        },
        initialPageParam: undefined as string | undefined,
        initialData: initialPage
            ? { pages: [initialPage], pageParams: [undefined] }
            : undefined,
        getNextPageParam: (lastPage) => lastPage.nextCursor || undefined,
        maxPages: MAX_RETAINED_PERSON_QUERY_PAGES,
        staleTime: tab === 'network' ? 30_000 : 60_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        enabled,
    });
}

export function useConnections(limit = 50, search?: string, sortBy?: 'recent' | 'name' | 'oldest') {
    return useConnectionsFeed('network', { limit, search, sortBy });
}

export function useSuggestedPeople(
    limit = 20,
    search?: string,
    filters?: DiscoverFilters,
    initialPage?: FeedPage<DiscoverConnectionItem>,
    includeMeta?: boolean,
) {
    return useConnectionsFeed('discover', { limit, search, filters, initialPage, includeMeta });
}

function mapIncomingRequest(item: RequestConnectionItem): PendingIncomingRequest {
    return {
        id: item.id,
        requesterId: item.requesterId,
        addresseeId: item.addresseeId,
        status: item.status,
        createdAt: item.createdAt,
        requesterUsername: item.user.username,
        requesterFullName: item.user.fullName,
        requesterAvatarUrl: item.user.avatarUrl,
        requesterHeadline: item.user.headline,
        requesterLocation: item.user.location,
        requesterSkills: item.user.skills ?? [],
        requesterOpenTo: item.user.openTo ?? [],
        requesterMessagePrivacy: item.user.messagePrivacy ?? 'connections',
        requesterCanSendMessage: item.user.canSendMessage ?? false,
        requesterLastActiveAt: item.user.lastActiveAt ?? null,
        message: (item as RequestConnectionItem & { message?: string | null }).message ?? null,
        mutualCount: (item as RequestConnectionItem & { mutualCount?: number }).mutualCount,
    };
}

function mapSentRequest(item: RequestConnectionItem): PendingSentRequest {
    return {
        id: item.id,
        requesterId: item.requesterId,
        addresseeId: item.addresseeId,
        status: item.status,
        createdAt: item.createdAt,
        addresseeUsername: item.user.username,
        addresseeFullName: item.user.fullName,
        addresseeAvatarUrl: item.user.avatarUrl,
        addresseeHeadline: item.user.headline,
        addresseeLocation: item.user.location,
        addresseeSkills: item.user.skills ?? [],
        addresseeOpenTo: item.user.openTo ?? [],
        addresseeMessagePrivacy: item.user.messagePrivacy ?? 'connections',
        addresseeCanSendMessage: item.user.canSendMessage ?? false,
        addresseeLastActiveAt: item.user.lastActiveAt ?? null,
    };
}

export function usePendingRequests(
    limit = 20,
    enabled = true,
    options: { includeSent?: boolean } = {},
) {
    const includeSent = options.includeSent ?? true;
    return useQuery({
        queryKey: [...CONNECTIONS_QUERY_KEYS.pendingRequests(limit), { includeSent }] as const,
        queryFn: async (): Promise<PendingRequestsData> => {
            const [incoming, sent] = includeSent
                ? await Promise.all([
                    getConnectionsFeed({ tab: 'requests_incoming', limit }),
                    getConnectionsFeed({ tab: 'requests_sent', limit }),
                ])
                : [await getConnectionsFeed({ tab: 'requests_incoming', limit }), null];

            const incomingOk = incoming.success
                ? (incoming as FeedPage<RequestConnectionItem>)
                : { items: [], hasMore: false, nextCursor: null, stats: EMPTY_STATS };
            const sentOk = sent?.success
                ? (sent as FeedPage<RequestConnectionItem>)
                : { items: [], hasMore: false, nextCursor: null, stats: EMPTY_STATS };

            return {
                incoming: incomingOk.items.map(mapIncomingRequest),
                sent: sentOk.items.map(mapSentRequest),
                hasMoreIncoming: incomingOk.hasMore,
                hasMoreSent: sentOk.hasMore,
                stats: incomingOk.stats || sentOk.stats || EMPTY_STATS,
            };
        },
        staleTime: 45_000,
        gcTime: 5 * 60 * 1000,
        refetchOnWindowFocus: false,
        enabled,
    });
}

function connectionMutationTargetId(variables: unknown) {
    if (typeof variables === 'string') return variables;
    if (!variables || typeof variables !== 'object') return undefined;
    const record = variables as Record<string, unknown>;
    for (const key of ['userId', 'targetUserId', 'profileId', 'id'] as const) {
        if (typeof record[key] === 'string') return record[key];
    }
    return undefined;
}

// One idempotency key per Connect click: the mutation's automatic retry reuses the same variables object,
// so it reuses the key and the server replays the first answer instead of sending twice.
const requestKeys = new WeakMap<object, string>();
const requestKeyFor = (variables: object) => {
    let key = requestKeys.get(variables);
    if (!key) {
        key = crypto.randomUUID();
        requestKeys.set(variables, key);
    }
    return key;
};

/** What a Connect changes in the cache, kept so a failure can put it back exactly (not wait for a refetch). */
type ConnectSnapshot = Array<[readonly unknown[], unknown]>;
const snapshotConnect = (queryClient: ReturnType<typeof useQueryClient>): ConnectSnapshot => [
    ...queryClient.getQueriesData({ queryKey: ['connections', 'feed', 'discover'] }),
    ...queryClient.getQueriesData({ queryKey: ['connections', 'stats'] }),
    ...queryClient.getQueriesData({ queryKey: queryKeys.globalSearch.networkRoot() }),
];

export function useConnectionMutations() {
    const queryClient = useQueryClient();

    const invalidateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const invalidateAll = useCallback((targetId?: string) => {
        if (invalidateTimeoutRef.current) {
            clearTimeout(invalidateTimeoutRef.current);
        }
        invalidateTimeoutRef.current = setTimeout(() => {
            invalidateConnectionsScoped(queryClient);
            void queryClient.invalidateQueries({
                queryKey: queryKeys.globalSearch.networkRoot(),
                refetchType: 'active',
            });
            void queryClient.invalidateQueries({
                queryKey: queryKeys.globalSearch.discoverRoot(),
                refetchType: 'active',
            });
            if (targetId) {
                void queryClient.invalidateQueries({ queryKey: queryKeys.profile.byTarget(targetId) });
            }
            invalidateTimeoutRef.current = null;
        }, 150);
    }, [queryClient]);

    useEffect(() => {
        return () => {
            if (invalidateTimeoutRef.current) {
                clearTimeout(invalidateTimeoutRef.current);
            }
        };
    }, []);

    const sendRequest = useMutation({
        mutationFn: async (variables: { userId: string; message?: string }) => {
            const result = await sendConnectionRequest(variables.userId, requestKeyFor(variables), variables.message);
            if (!result.success) throw new Error(result.error || 'Failed to send request');
            return { ...result, userId: variables.userId };
        },
        onMutate: async ({ userId }) => {
            await cancelConnectionsScoped(queryClient);
            const previous = snapshotConnect(queryClient);

            patchDiscoverAndSuggestionStatus(queryClient, {
                userIds: [userId],
                status: 'pending_sent',
                canConnect: false,
            });

            updateStatsQueries(queryClient, (stats) => ({
                ...stats,
                pendingSent: stats.pendingSent + 1,
            }));
            return { previous };
        },
        // Put the row back to Connect at once (offline too), then check with the server.
        onError: (_err, vars, context) => {
            for (const [key, data] of context?.previous ?? []) queryClient.setQueryData(key, data);
            invalidateAll(connectionMutationTargetId(vars));
        },
        onSuccess: (result) => {
            if (result.status !== 'created') {
                updateStatsQueries(queryClient, (stats) => ({
                    ...stats,
                    pendingSent: Math.max(0, stats.pendingSent - 1),
                }));
            }

            const nextStatus =
                result.status === 'connected'
                    ? 'connected'
                    : result.status === 'pending_received'
                        ? 'pending_received'
                        : result.status === 'pending_sent' || result.status === 'created'
                            ? 'pending_sent'
                            : null;

            if (!nextStatus) return;

            patchDiscoverAndSuggestionStatus(queryClient, {
                userIds: [result.userId],
                connectionIds: result.connectionId ? [result.connectionId] : [],
                status: nextStatus,
                canConnect: false,
                connectionId: result.connectionId,
            });
        },
        onSettled: (_data, _err, vars) => {
            const targetId = connectionMutationTargetId(vars);
            void queryClient.invalidateQueries({ queryKey: ['connections', 'feed', 'requests_sent'] });
            void queryClient.invalidateQueries({ queryKey: ['connections', 'pending-requests'] });
            void queryClient.invalidateQueries({ queryKey: queryKeys.connections.pending() });
            void queryClient.invalidateQueries({ queryKey: ['connections', 'stats'] });
            if (targetId) {
                void queryClient.invalidateQueries({ queryKey: queryKeys.profile.byTarget(targetId) });
            }
        },
    });

    const cancelRequest = useMutation({
        mutationFn: async (id: string) => {
            const result = await cancelConnectionRequest(id);
            if (!result.success) throw new Error(result.error || 'Failed to cancel request');
            return { ...result, id };
        },
        onMutate: async (id) => {
            await cancelConnectionsScoped(queryClient);
            let targetUserId: string | undefined;
            updatePendingRequestQueries(queryClient, (prev) => {
                const request = prev.sent.find((item) => item.id === id || item.addresseeId === id);
                targetUserId = request?.addresseeId || (id.length === 36 ? id : undefined);
                return {
                    ...prev,
                    sent: prev.sent.filter((item) => item.id !== id && item.addresseeId !== id),
                };
            });

            patchDiscoverAndSuggestionStatus(queryClient, {
                userIds: targetUserId ? [targetUserId, id] : [id],
                connectionIds: [id],
                status: 'none',
                canConnect: true,
                connectionId: undefined,
            });

            updateStatsQueries(queryClient, (stats) => ({
                ...stats,
                pendingSent: Math.max(0, stats.pendingSent - 1),
            }));

            return { targetUserId };
        },
        onSuccess: (result, id, context) => {
            patchDiscoverAndSuggestionStatus(queryClient, {
                userIds: [result.addresseeId, context?.targetUserId, id],
                connectionIds: [result.connectionId, id],
                status: 'none',
                canConnect: true,
                connectionId: undefined,
            });
        },
        onError: (_err, _vars, context) => invalidateAll(context?.targetUserId),
        onSettled: (data, _err, vars, context) => invalidateAll(data?.addresseeId || context?.targetUserId || (typeof vars === 'string' ? vars : undefined)),
    });

    const acceptRequest = useMutation({
        mutationFn: async (id: string) => {
            const result = await acceptConnectionRequest(id, { idempotencyKey: id });
            if (!result.success) throw new Error(result.error || 'Failed to accept request');
            return { id };
        },
        onMutate: async (id) => {
            await cancelConnectionsScoped(queryClient);

            // Find the pending request to get user details for network insert
            let acceptedConnection: NetworkConnectionItem | null = null;
            updatePendingRequestQueries(queryClient, (prev) => {
                const req = prev.incoming.find(r => r.id === id);
                if (req) {
                    acceptedConnection = {
                        id,
                        type: 'network',
                        requesterId: req.requesterId,
                        addresseeId: req.addresseeId,
                        status: 'accepted',
                        createdAt: req.createdAt,
                        updatedAt: new Date(),
                        otherUser: {
                            id: req.requesterId,
                            username: req.requesterUsername,
                            fullName: req.requesterFullName,
                            avatarUrl: req.requesterAvatarUrl,
                            headline: req.requesterHeadline,
                            location: req.requesterLocation ?? null,
                            skills: req.requesterSkills ?? [],
                            openTo: req.requesterOpenTo ?? [],
                            messagePrivacy: req.requesterMessagePrivacy ?? 'connections',
                            canSendMessage: true,
                            lastActiveAt: req.requesterLastActiveAt ?? null,
                        },
                    };
                }
                return {
                    ...prev,
                    incoming: prev.incoming.filter((item) => item.id !== id),
                };
            });

            if (acceptedConnection) {
                const nextAcceptedConnection = acceptedConnection;
                updateFeedQueries<NetworkConnectionItem>(queryClient, ['connections', 'feed', 'network'], (page) => ({
                    ...page,
                    items: [
                        nextAcceptedConnection,
                        ...page.items.filter((item) => item.id !== id),
                    ],
                }));
            }

            updateFeedQueries<DiscoverConnectionItem>(queryClient, ['connections', 'feed', 'discover'], (page) => ({
                ...page,
                items: page.items.map((item) =>
                    item.connectionId === id
                        ? { ...item, connectionStatus: 'connected', canConnect: false }
                        : item
                ),
            }));

            updateStatsQueries(queryClient, (stats) => ({
                ...stats,
                totalConnections: stats.totalConnections + 1,
                pendingIncoming: Math.max(0, stats.pendingIncoming - 1),
            }));
        },
        onError: (_err, vars) => invalidateAll(connectionMutationTargetId(vars)),
        onSettled: (_data, _err, vars) => invalidateAll(connectionMutationTargetId(vars)),
    });

    const rejectRequest = useMutation({
        mutationFn: async ({ id, reason }: { id: string; reason?: string }) => {
            const result = await rejectConnectionRequest(id, reason);
            if (!result.success) throw new Error(result.error || 'Failed to reject request');
            return { id, undoUntil: result.undoUntil, serverNow: result.serverNow };
        },
        onMutate: async ({ id }) => {
            await cancelConnectionsScoped(queryClient);
            updatePendingRequestQueries(queryClient, (prev) => ({
                ...prev,
                incoming: prev.incoming.filter((item) => item.id !== id),
            }));

            updateFeedQueries<DiscoverConnectionItem>(queryClient, ['connections', 'feed', 'discover'], (page) => ({
                ...page,
                items: page.items.map((item) =>
                    item.connectionId === id
                        ? { ...item, connectionStatus: 'none', canConnect: true, connectionId: undefined }
                        : item
                ),
            }));

            updateStatsQueries(queryClient, (stats) => ({
                ...stats,
                pendingIncoming: Math.max(0, stats.pendingIncoming - 1),
            }));
        },
        onError: (_err, vars) => invalidateAll(connectionMutationTargetId(vars)),
        onSettled: (_data, _err, vars) => invalidateAll(connectionMutationTargetId(vars)),
    });

    const dismissSuggestion = useMutation({
        mutationFn: async ({ profileId, feedbackReason }: { profileId: string; feedbackReason?: string }) => {
            const result = await dismissConnectionSuggestion(profileId, feedbackReason);
            if (!result.success) throw new Error(result.error || 'Failed to dismiss suggestion');
            return { profileId };
        },
        onMutate: async ({ profileId }) => {
            await cancelConnectionsScoped(queryClient);
            updateFeedQueries<DiscoverConnectionItem>(queryClient, ['connections', 'feed', 'discover'], (page) => ({
                ...page,
                items: page.items.filter((item) => item.id !== profileId),
            }));
        },
        onError: (_err, vars) => invalidateAll(connectionMutationTargetId(vars)),
        onSettled: (_data, _err, vars) => invalidateAll(connectionMutationTargetId(vars)),
    });

    const undoRejectRequest = useMutation({
        mutationFn: async (id: string) => {
            const result = await undoRejectConnectionRequest(id);
            if (!result.success) throw new Error(result.error || 'Failed to undo reject');
            return { id };
        },
        onSettled: (_data, _err, vars) => invalidateAll(connectionMutationTargetId(vars)),
    });

    const acceptAllIncoming = useMutation({
        mutationFn: async (limit: number | undefined) => {
            const result = await acceptAllIncomingConnectionRequests(limit);
            if (!result.success) throw new Error(result.error || 'Failed to accept all requests');
            return result;
        },
        onMutate: async () => {
            await cancelConnectionsScoped(queryClient);

            const previousPending = queryClient.getQueryData(['connections', 'pending-requests']);
            const previousStats = queryClient.getQueryData(['connections', 'stats']);

            let acceptedCount = 0;

            updatePendingRequestQueries(queryClient, (prev) => {
                acceptedCount = Math.max(acceptedCount, prev.incoming.length);
                return {
                    ...prev,
                    incoming: [],
                };
            });

            if (acceptedCount > 0) {
                updateStatsQueries(queryClient, (stats) => ({
                    ...stats,
                    totalConnections: stats.totalConnections + acceptedCount,
                    pendingIncoming: Math.max(0, stats.pendingIncoming - acceptedCount),
                }));
            }

            return { previousPending, previousStats };
        },
        onError: (_err, _vars, context) => {
            if (context?.previousPending) queryClient.setQueryData(['connections', 'pending-requests'], context.previousPending);
            if (context?.previousStats) queryClient.setQueryData(['connections', 'stats'], context.previousStats);
            invalidateAll();
        },
        onSettled: () => invalidateAll(),
    });
    const withdrawAllSent = useMutation({
        mutationFn: async () => {
            const res = await withdrawAllSentConnectionRequests();
            if (!res.success) throw new Error(res.error || 'Failed to cancel requests');
            return res;
        },
        onMutate: async () => {
            await cancelConnectionsScoped(queryClient);

            const previousPending = queryClient.getQueryData(['connections', 'pending-requests']);
            const previousStats = queryClient.getQueryData(['connections', 'stats']);
            const sentUserIds = new Set<string>();
            const sentConnectionIds = new Set<string>();
            let withdrawnCount = 0;

            updatePendingRequestQueries(queryClient, (prev) => {
                withdrawnCount = prev.sent.length;
                for (const request of prev.sent) {
                    sentUserIds.add(request.addresseeId);
                    sentConnectionIds.add(request.id);
                }
                return {
                    ...prev,
                    sent: [],
                };
            });

            if (withdrawnCount > 0) {
                patchDiscoverAndSuggestionStatus(queryClient, {
                    userIds: sentUserIds,
                    connectionIds: sentConnectionIds,
                    status: 'none',
                    canConnect: true,
                    connectionId: undefined,
                });

                updateStatsQueries(queryClient, (stats) => ({
                    ...stats,
                    pendingSent: Math.max(0, stats.pendingSent - withdrawnCount),
                }));
            }

            return { previousPending, previousStats, sentUserIds, sentConnectionIds };
        },
        onSuccess: (result, _vars, context) => {
            patchDiscoverAndSuggestionStatus(queryClient, {
                userIds: context?.sentUserIds ?? [],
                connectionIds: context?.sentConnectionIds ?? [],
                status: 'none',
                canConnect: true,
                connectionId: undefined,
            });
            toast.success(result.count && result.count > 0 ? `Cancelled ${result.count} sent request${result.count === 1 ? '' : 's'}` : 'No sent requests to cancel');
        },
        onError: (_err, _vars, context) => {
            if (context?.previousPending) queryClient.setQueryData(['connections', 'pending-requests'], context.previousPending);
            if (context?.previousStats) queryClient.setQueryData(['connections', 'stats'], context.previousStats);
            toast.error("Failed to cancel sent requests");
        },
        onSettled: () => invalidateAll(),
    });

    const rejectAllIncoming = useMutation({
        mutationFn: async (limit: number | undefined) => {
            const result = await rejectAllIncomingConnectionRequests(limit);
            if (!result.success) throw new Error(result.error || 'Failed to reject all requests');
            return result;
        },
        onMutate: async () => {
            await cancelConnectionsScoped(queryClient);

            const previousPending = queryClient.getQueryData(['connections', 'pending-requests']);
            const previousStats = queryClient.getQueryData(['connections', 'stats']);

            let rejectedCount = 0;

            updatePendingRequestQueries(queryClient, (prev) => {
                rejectedCount = Math.max(rejectedCount, prev.incoming.length);
                return {
                    ...prev,
                    incoming: [],
                };
            });

            if (rejectedCount > 0) {
                updateStatsQueries(queryClient, (stats) => ({
                    ...stats,
                    pendingIncoming: Math.max(0, stats.pendingIncoming - rejectedCount),
                }));
            }

            return { previousPending, previousStats };
        },
        onError: (_err, _vars, context) => {
            if (context?.previousPending) queryClient.setQueryData(['connections', 'pending-requests'], context.previousPending);
            if (context?.previousStats) queryClient.setQueryData(['connections', 'stats'], context.previousStats);
            invalidateAll();
        },
        onSettled: () => invalidateAll(),
    });

    const disconnect = useMutation({
        mutationFn: async (id: string) => {
            const result = await removeConnection(id);
            if (!result.success) throw new Error(result.error || 'Failed to remove connection');
            return { id };
        },
        onMutate: async (id) => {
            await cancelConnectionsScoped(queryClient);
            updateFeedQueries<NetworkConnectionItem>(queryClient, ['connections', 'feed', 'network'], (page) => ({
                ...page,
                items: page.items.filter((item) => item.id !== id),
            }));
            updateFeedQueries<DiscoverConnectionItem>(queryClient, ['connections', 'feed', 'discover'], (page) => ({
                ...page,
                items: page.items.map((item) =>
                    item.connectionId === id
                        ? { ...item, connectionStatus: 'none', canConnect: true, connectionId: undefined }
                        : item
                ),
            }));
            updateStatsQueries(queryClient, (stats) => ({
                ...stats,
                totalConnections: Math.max(0, stats.totalConnections - 1),
            }));
        },
        onError: () => {
            // Re-fetch to restore the canonical sorted state on failure.
            invalidateAll();
        },
        onSettled: (_data, _err, vars) => invalidateAll(connectionMutationTargetId(vars)),
    });

    const blockProfile = useMutation({
        mutationFn: async (targetUserId: string) => {
            const res = await fetch('/api/v1/privacy/blocks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: targetUserId }),
            });
            const data = await res.json().catch(() => null);
            if (!res.ok) {
                throw new Error(data?.error?.message || data?.message || 'Failed to block account');
            }
            return { targetUserId };
        },
        onMutate: async (targetUserId) => {
            await cancelConnectionsScoped(queryClient);
            updatePendingRequestQueries(queryClient, (prev) => ({
                ...prev,
                incoming: prev.incoming.filter((item) => item.requesterId !== targetUserId),
                sent: prev.sent.filter((item) => item.addresseeId !== targetUserId),
            }));
        },
        onError: (_err, vars) => invalidateAll(connectionMutationTargetId(vars)),
        onSettled: (_data, _err, vars) => invalidateAll(connectionMutationTargetId(vars)),
    });

    const result = useMemo(() => ({
        sendRequest,
        cancelRequest,
        withdrawAllSent,
        acceptRequest,
        rejectRequest,
        dismissSuggestion,
        undoRejectRequest,
        acceptAllIncoming,
        rejectAllIncoming,
        disconnect,
        blockProfile,
    }), [
        sendRequest,
        cancelRequest,
        withdrawAllSent,
        acceptRequest,
        rejectRequest,
        dismissSuggestion,
        undoRejectRequest,
        acceptAllIncoming,
        rejectAllIncoming,
        disconnect,
        blockProfile,
    ]);

    return result;
}

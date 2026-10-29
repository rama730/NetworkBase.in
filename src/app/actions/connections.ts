"use server";

import { openInvitesFor } from '@/lib/organizations/members';
import { personFilterSql } from '@/lib/network/person-filter-sql';
import type { NetworkPersonFilters } from '@/lib/network/browse-query';
import { readPersonCardDetails } from '@/lib/network/person-card-read';
import type { PersonCardDetails } from '@/lib/network/person-card';
import { db } from '@/lib/db';
import { getConnectionStatsForUser } from '@/lib/connections/stats';
import { readSharedConnections } from '@/lib/connections/shared';
import { DISCOVER_RAIL_CARD_COUNT } from '@/lib/discover/query';
import { isLooseUuid } from '@/lib/validations/uuid';
import { z } from 'zod';
import { notFixtureAccountSql } from '@/lib/accounts/fixture-accounts';
import { connectionSuggestionDismissals, connectionSuggestions, connections, profiles, projects, roleApplications } from '@/lib/db/schema';
import { countPendingInvitationsForCandidate } from '@/lib/workspaces/workspace-invitations';
import { getAuthUser } from '@/lib/supabase/auth-user';
import { IdempotencyConflictError, runIdempotent } from '@/lib/security/idempotency';
import { eq, and, or, desc, asc, sql, inArray, isNull, type SQL } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { consumeRateLimit } from '@/lib/security/rate-limit';
import {
    CONNECTION_BANNER_HIDE_AFTER_MS,
    CONNECTION_REQUEST_HISTORY_STATUSES,
    type ConnectionRequestHistoryStatus,
} from '@/lib/connections/request-history';
import { runInFlightDeduped } from '@/lib/utils/inflight-dedupe';
import { canReviewProjectSql, countReviewableApplications } from '@/lib/applications/reviewers';
import { redis, getCachedData, cacheData } from '@/lib/redis';
import { visibleLastActiveAt } from '@/lib/presence/sql';
import {
    applyConnectionPairsToRedis,
    invalidateDiscoverCacheForUsers,
    revalidateConnectionsPaths,
} from '@/lib/connections/internal-helpers';
import { queueCounterRefreshBestEffort } from '@/lib/my-work/counter-buffer';
import { recordPrivacyReadEvents } from '@/lib/privacy/audit';
import { buildViewerScopedProfileView } from '@/lib/privacy/profile-views';
import {
    resolvePrivacyRelationship,
    resolvePrivacyRelationships,
} from '@/lib/privacy/resolver';
import type { PrivacyRelationshipState } from '@/lib/privacy/relationship-state';
import { emitConnectionAcceptedNotification, emitConnectionRequestReceivedNotification } from '@/lib/notifications/emitters';
import { logger } from '@/lib/logger';
import { containsLikePattern, normalizeSearchQuery, tokenizeSearchQuery } from '@/lib/search/query';
import { recordGlobalSearchMetric } from '@/lib/search/observability';
import { inngest } from '../../inngest/client';

// ============================================================================
// TYPES
// ============================================================================

export interface ConnectionStats {
    totalConnections: number;
    pendingIncoming: number;
    pendingSent: number;
}

export async function readNetworkPendingCountsAction() {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false as const, error: 'Sign in to continue', pendingConnections: 0, pendingInvites: 0, pendingApplications: 0, totalConnections: 0 };

        const [stats, pendingInvites, pendingApplications, orgInvites] = await Promise.all([
            getConnectionStatsForUser(user.id),
            countPendingInvitationsForCandidate(user.id),
            countReviewableApplications(user.id),
            // The Network badge includes organization invitations (report §30.6).
            openInvitesFor(user.id).then((rows) => rows.length).catch(() => 0),
        ]);
        return {
            success: true as const,
            pendingConnections: stats.pendingIncoming,
            pendingInvites: pendingInvites + orgInvites,
            pendingApplications,
            totalConnections: stats.totalConnections,
        };
    } catch (error) {
        logger.error('connections.pending_counts_failed', {
            module: 'connections',
            error: error instanceof Error ? error.message : String(error),
        });
        return { success: false as const, error: 'Couldn’t load pending requests', pendingConnections: 0, pendingInvites: 0, pendingApplications: 0, totalConnections: 0 };
    }
}

export interface SuggestedProfile extends PersonCardDetails {
    id: string;
    username: string | null;
    fullName: string | null;
    avatarUrl: string | null;
    headline: string | null;
    location: string | null;
    connectionStatus: 'none' | 'pending_sent' | 'pending_received' | 'connected' | 'blocked';
    connectionId?: string;
    canConnect?: boolean;
    profileVisibility?: 'public' | 'connections' | 'private';
    isLockedProfile?: boolean;
    mutualConnections?: number | null;
    recommendationReason?: string;
    projects?: Array<{ id: string; title: string; status: string | null }>;
    experienceLevel?: 'student' | 'junior' | 'mid' | 'senior' | 'lead' | 'founder' | null;
    skills?: string[];
    interests?: string[];
    openTo?: string[];
    messagePrivacy?: 'everyone' | 'connections' | null;
    canSendMessage?: boolean;
    lastActiveAt?: string | null;
    scoringBreakdown?: { overlap: number; mutual: number; recency: number; completeness: number };
}

export type ConnectionsFeedTab = 'network' | 'requests_incoming' | 'requests_sent' | 'discover';

export interface DiscoverFilters extends NetworkPersonFilters {
    seniorPlus?: boolean;
    hasMutuals?: boolean;
    hasSharedProjects?: boolean;
    /** Discover's rail: only people you can actually see and connect with (no locked cards). */
    openProfilesOnly?: boolean;
}

export interface HistoryFilters {
    status?: ConnectionRequestHistoryStatus;
    direction?: 'sent' | 'received';
    dateFrom?: string;
    dateTo?: string;
}

export interface ConnectionsFeedInput {
    tab: ConnectionsFeedTab;
    limit?: number;
    cursor?: string;
    search?: string;
    includeMeta?: boolean;
    includeSharedConnections?: boolean;
    sortBy?: 'recent' | 'name' | 'oldest';
    filters?: DiscoverFilters;
    historyFilters?: HistoryFilters;
    requestSortBy?: 'recent' | 'mutual' | 'oldest';
}

const CONNECTION_REJECTION_REASONS = ['not_interested', 'dont_know', 'spam', 'other'] as const;
const MAX_REQUESTS_LIMIT = 1000;

interface ConnectionsFeedStats {
    totalConnections: number;
    pendingIncoming: number;
    pendingSent: number;
}

async function applySuggestedProfilePrivacy(
    viewerId: string,
    items: SuggestedProfile[],
): Promise<SuggestedProfile[]> {
    const relationships = await resolvePrivacyRelationships(viewerId, items.map((item) => item.id));

    return items.map((item) => {
        const relationship = relationships.get(item.id) ?? null;
        const scoped = buildViewerScopedProfileView({
            profile: item as unknown as Record<string, unknown> & { id: string },
            relationship,
            isOwner: viewerId === item.id,
        });
        const locked = !!relationship && !relationship.canViewProfile;
        const connectionStatus = suggestedStatusFromPrivacyRelationship(relationship, item.connectionStatus);
        const connectionId = getUsableRelationshipConnectionId(relationship?.latestConnectionId) ?? item.connectionId;

        if (!locked) {
            return {
                ...item,
                connectionStatus,
                connectionId,
                username: scoped?.username ?? item.username,
                fullName: scoped?.fullName ?? item.fullName,
                avatarUrl: scoped?.avatarUrl ?? item.avatarUrl,
                headline: scoped?.headline ?? item.headline,
                location: scoped?.location ?? item.location,
                skills: scoped?.skills ?? item.skills ?? [],
                interests: scoped?.interests ?? item.interests ?? [],
                openTo: scoped?.openTo ?? item.openTo ?? [],
                lastActiveAt: typeof scoped?.lastActiveAt === 'string'
                    ? scoped.lastActiveAt
                    : scoped?.lastActiveAt instanceof Date
                        ? scoped.lastActiveAt.toISOString()
                        : item.lastActiveAt ?? null,
                messagePrivacy: (scoped?.messagePrivacy as SuggestedProfile['messagePrivacy']) ?? item.messagePrivacy ?? null,
                canSendMessage: relationship?.canSendMessage ?? item.canSendMessage,
                canConnect: relationship?.canSendConnectionRequest ?? item.canConnect,
                isLockedProfile: false,
            };
        }

        return {
            ...item,
            connectionStatus,
            connectionId,
            username: scoped?.username ?? null,
            fullName: scoped?.fullName ?? null,
            avatarUrl: scoped?.avatarUrl ?? null,
            headline: scoped?.headline ?? null,
            location: scoped?.location ?? null,
            projects: [],
            portfolio: null,
            openToCollaborate: null,
            mutualConnections: null,
            skills: scoped?.skills ?? [],
            interests: scoped?.interests ?? [],
            openTo: scoped?.openTo ?? [],
            lastActiveAt: typeof scoped?.lastActiveAt === 'string'
                ? scoped.lastActiveAt
                : scoped?.lastActiveAt instanceof Date
                    ? scoped.lastActiveAt.toISOString()
                    : null,
            messagePrivacy: (scoped?.messagePrivacy as SuggestedProfile['messagePrivacy']) ?? null,
            canSendMessage: relationship?.canSendMessage ?? false,
            canConnect: relationship?.canSendConnectionRequest ?? false,
            isLockedProfile: locked,
        };
    });
}

function suggestedStatusFromPrivacyRelationship(
    relationship: PrivacyRelationshipState | null,
    fallback: SuggestedProfile['connectionStatus'],
): SuggestedProfile['connectionStatus'] {
    if (!relationship) return fallback;
    switch (relationship.connectionState) {
        case 'connected':
            return 'connected';
        case 'pending_outgoing':
            return 'pending_sent';
        case 'pending_incoming':
            return 'pending_received';
        case 'blocked_by_viewer':
        case 'blocked_by_target':
            return 'blocked';
        case 'none':
        default:
            return 'none';
    }
}

function getUsableRelationshipConnectionId(connectionId: string | null | undefined) {
    if (!connectionId || connectionId.startsWith('redis-fast-path-')) return undefined;
    return connectionId;
}

type NetworkFeedItem = {
    id: string;
    requesterId: string;
    addresseeId: string;
    status: string;
    createdAt: Date;
    updatedAt: Date;
    otherUser?: {
        id?: string;
        username?: string | null;
        fullName?: string | null;
        avatarUrl?: string | null;
        headline?: string | null;
    } | null;
};

const REJECT_REQUEST_COOLDOWN_MS = 2 * 24 * 60 * 60 * 1000;
type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

// ============================================================================
// ============================================================================

// PURE OPTIMIZATION: lockConnectionPair fully replaced by native UNIQUE index constraint

// ponytail: canonical lexicographical sorting of profile IDs eliminates 40P01 deadlocks on concurrent counter updates. ceiling: 10,000 bulk connections. upgrade: none needed.
async function applyConnectionsCountDeltas(tx: DbTransaction, deltas: Map<string, number>) {
    const rows = Array.from(deltas, ([userId, amount]) => ({ userId, amount }))
        .filter((row) => row.amount !== 0)
        .sort((a, b) => a.userId.localeCompare(b.userId));
    if (rows.length === 0) return;
    await tx.execute(sql`
        WITH delta_rows AS (
            SELECT "userId"::uuid AS user_id, amount
            FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS ("userId" uuid, amount integer)
            ORDER BY "userId" ASC
        ),
        locked_profiles AS (
            SELECT p.id, d.amount
            FROM delta_rows d
            JOIN profiles p ON p.id = d.user_id
            ORDER BY p.id ASC
            FOR UPDATE
        )
        UPDATE profiles AS profile
        SET connections_count = GREATEST(0, profile.connections_count + lp.amount),
            updated_at = now()
        FROM locked_profiles lp
        WHERE profile.id = lp.id
    `);
}

const CONNECTIONS_CURSOR_DELIMITER = '|';
const CONNECTIONS_DATE_CURSOR_PREFIX = 'd:';
const CONNECTIONS_NAME_CURSOR_PREFIX = 'n:';
const CONNECTIONS_MUTUAL_CURSOR_PREFIX = 'm:';

type DateConnectionsCursor = {
    kind: 'date';
    sortMode: 'recent' | 'oldest';
    updatedAt: string;
    id: string;
    /** Relevance bucket of the last row, for discovery text search ordered by (rank, updatedAt, id). */
    rank?: number;
};

type NameConnectionsCursor = {
    kind: 'name';
    sortMode: 'name';
    fullName: string | null;
    username: string | null;
    id: string;
};

type MutualConnectionsCursor = {
    kind: 'mutual';
    sortMode: 'mutual';
    mutualCount: number;
    createdAt: string;
    id: string;
};

type ParsedConnectionsCursor = DateConnectionsCursor | NameConnectionsCursor | MutualConnectionsCursor;

function encodeConnectionsCursor(updatedAt: Date | string, id: string, sortMode: 'recent' | 'oldest', rank?: number) {
    const base = `${CONNECTIONS_DATE_CURSOR_PREFIX}${sortMode}${CONNECTIONS_CURSOR_DELIMITER}${typeof updatedAt === 'string' ? updatedAt : updatedAt.toISOString()}${CONNECTIONS_CURSOR_DELIMITER}${id}`;
    return rank === undefined ? base : `${base}${CONNECTIONS_CURSOR_DELIMITER}${rank}`;
}

function encodeConnectionsNameCursor(fullName: string | null, username: string | null, id: string) {
    const payload = Buffer.from(JSON.stringify({
        sortMode: 'name' as const,
        fullName: fullName ?? null,
        username: username ?? null,
        id,
    }), 'utf8').toString('base64url');

    return `${CONNECTIONS_NAME_CURSOR_PREFIX}${payload}`;
}

function encodeConnectionsMutualCursor(mutualCount: number, createdAt: Date, id: string) {
    const payload = Buffer.from(JSON.stringify({
        sortMode: 'mutual' as const,
        mutualCount,
        createdAt: createdAt.toISOString(),
        id,
    }), 'utf8').toString('base64url');

    return `${CONNECTIONS_MUTUAL_CURSOR_PREFIX}${payload}`;
}

function parseConnectionsCursor(cursor?: string): ParsedConnectionsCursor | null {
    if (!cursor) return null;

    if (cursor.startsWith(CONNECTIONS_MUTUAL_CURSOR_PREFIX)) {
        try {
            const payload = Buffer.from(cursor.slice(CONNECTIONS_MUTUAL_CURSOR_PREFIX.length), 'base64url').toString('utf8');
            const parsed = JSON.parse(payload) as {
                sortMode?: 'mutual';
                mutualCount?: number;
                createdAt?: string;
                id?: string;
            };

            if (!parsed.id || typeof parsed.mutualCount !== 'number' || !Number.isFinite(parsed.mutualCount) || !parsed.createdAt) {
                return null;
            }

            const parsedDate = new Date(parsed.createdAt);
            if (Number.isNaN(parsedDate.getTime())) return null;

            return {
                kind: 'mutual',
                sortMode: 'mutual',
                mutualCount: parsed.mutualCount,
                createdAt: parsedDate.toISOString(),
                id: parsed.id,
            };
        } catch {
            return null;
        }
    }

    if (cursor.startsWith(CONNECTIONS_NAME_CURSOR_PREFIX)) {
        try {
            const payload = Buffer.from(cursor.slice(CONNECTIONS_NAME_CURSOR_PREFIX.length), 'base64url').toString('utf8');
            const parsed = JSON.parse(payload) as {
                sortMode?: 'name';
                fullName?: string | null;
                username?: string | null;
                id?: string;
            };

            if (!parsed.id) return null;

            return {
                kind: 'name',
                sortMode: 'name',
                fullName: typeof parsed.fullName === 'string' ? parsed.fullName : null,
                username: typeof parsed.username === 'string' ? parsed.username : null,
                id: parsed.id,
            };
        } catch {
            return null;
        }
    }

    const rawCursor = cursor.startsWith(CONNECTIONS_DATE_CURSOR_PREFIX)
        ? cursor.slice(CONNECTIONS_DATE_CURSOR_PREFIX.length)
        : cursor;
    const parts = rawCursor.split(CONNECTIONS_CURSOR_DELIMITER);
    const [sortModeRaw, dateRaw, id, rankRaw] = parts.length >= 3
        ? parts
        : [null, parts[0], parts[1]];
    if (!dateRaw || !id) return null;
    const parsedDate = new Date(dateRaw);
    if (Number.isNaN(parsedDate.getTime())) return null;
    const sortMode = sortModeRaw === 'recent' || sortModeRaw === 'oldest' ? sortModeRaw : 'recent';
    const rank = rankRaw === undefined ? undefined : Number(rankRaw);
    return {
        kind: 'date',
        sortMode,
        updatedAt: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{1,6}Z$/.test(dateRaw) ? dateRaw : parsedDate.toISOString(),
        id,
        ...(rank !== undefined && Number.isFinite(rank) ? { rank } : {}),
    };
}

function buildNullableCursorEquals(
    column: typeof profiles.fullName | typeof profiles.username,
    value: string | null,
) {
    return value === null ? sql`${column} IS NULL` : sql`${column} = ${value}`;
}

function compareIncomingRequestsByMutual(
    a: { mutualCount?: number; createdAt: Date; id: string },
    b: { mutualCount?: number; createdAt: Date; id: string },
) {
    const mutualDiff = (b.mutualCount ?? 0) - (a.mutualCount ?? 0);
    if (mutualDiff !== 0) return mutualDiff;

    const createdAtDiff = b.createdAt.getTime() - a.createdAt.getTime();
    if (createdAtDiff !== 0) return createdAtDiff;

    return b.id.localeCompare(a.id);
}

function buildNullableAscendingAfterCursor(
    column: typeof profiles.fullName | typeof profiles.username,
    value: string | null,
) {
    if (value === null) {
        return sql`FALSE`;
    }

    return sql`(${column} IS NULL OR ${column} > ${value})`;
}

function buildNameSortedConnectionsCursorCondition(cursor: NameConnectionsCursor) {
    const fullNameEquals = buildNullableCursorEquals(profiles.fullName, cursor.fullName);
    const fullNameAfter = buildNullableAscendingAfterCursor(profiles.fullName, cursor.fullName);
    const usernameEquals = buildNullableCursorEquals(profiles.username, cursor.username);
    const usernameAfter = buildNullableAscendingAfterCursor(profiles.username, cursor.username);

    return sql`(
        ${fullNameAfter}
        OR (${fullNameEquals} AND ${usernameAfter})
        OR (${fullNameEquals} AND ${usernameEquals} AND ${connections.id} < ${cursor.id})
    )`;
}

function buildProfileNameIlikeSearchCondition(searchTokens: string[]) {
    return and(...searchTokens.map((token) => {
        const pattern = containsLikePattern(token);
        return sql`(${profiles.fullName} ILIKE ${pattern} OR ${profiles.username} ILIKE ${pattern})`;
    }))!;
}

function buildProfileNameFuzzySearchCondition(searchPattern: string, safeSearch: string) {
    return sql`(
        similarity(${profiles.fullName}, ${safeSearch}) > 0.3
        OR similarity(${profiles.username}, ${safeSearch}) > 0.3
        OR ${profiles.fullName} ILIKE ${searchPattern}
        OR ${profiles.username} ILIKE ${searchPattern}
    )`;
}

function buildDiscoverProfileSearchCondition(searchTokens: string[]) {
    return and(...searchTokens.map((token) => {
        const pattern = containsLikePattern(token);
        return sql`(
            ${profiles.fullName} ILIKE ${pattern}
            OR ${profiles.username} ILIKE ${pattern}
            OR ${profiles.headline} ILIKE ${pattern}
            OR ${profiles.location} ILIKE ${pattern}
            OR EXISTS (
                SELECT 1
                FROM jsonb_array_elements_text(
                    CASE WHEN jsonb_typeof(${profiles.skills}) = 'array' THEN ${profiles.skills} ELSE '[]'::jsonb END
                ) AS skill(value)
                WHERE skill.value ILIKE ${pattern}
            )
            OR EXISTS (
                SELECT 1
                FROM jsonb_array_elements_text(
                    CASE WHEN jsonb_typeof(${profiles.interests}) = 'array' THEN ${profiles.interests} ELSE '[]'::jsonb END
                ) AS interest(value)
                WHERE interest.value ILIKE ${pattern}
            )
        )`;
    }))!;
}

function buildConnectionDateCursorCondition(params: {
    column: typeof connections.updatedAt | typeof connections.createdAt | typeof profiles.updatedAt | SQL;
    idColumn?: typeof connections.id | typeof profiles.id;
    isoValue: string;
    id?: string | null;
    direction: 'before' | 'after';
}) {
    const operator = params.direction === 'after' ? sql`>` : sql`<`;
    if (!params.id) {
        return sql`${params.column} ${operator} ${params.isoValue}`;
    }
    const idColumn = params.idColumn ?? connections.id;
    return sql`(
        ${params.column} ${operator} ${params.isoValue}
        OR (${params.column} = ${params.isoValue} AND ${idColumn} ${operator} ${params.id})
    )`;
}

// An availability pause removes the role boost immediately, before worker refresh.
const suggestionScore = sql<number>`GREATEST(0, ${connectionSuggestions.score} - CASE
    WHEN NOT ${profiles.openToCollaborate} AND ${connectionSuggestions.reason} LIKE 'Matches your open role:%' THEN 50 ELSE 0 END)`;

function buildSuggestionScoreCursorCondition(cursor: { score: number; id: string }) {
    return sql`(
        ${suggestionScore} < ${cursor.score}
        OR (${suggestionScore} = ${cursor.score} AND ${connectionSuggestions.suggestedUserId} < ${cursor.id})
    )`;
}

function getSafeSearch(search?: string) {
    const normalized = normalizeSearchQuery(search || '');
    return normalized.length > 0 ? normalized : undefined;
}

function getErrorCode(error: unknown) {
    if (!error || typeof error !== "object" || !("code" in error)) {
        return null;
    }
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? code : null;
}

const connectionsFeedInputSchema = z.object({
    tab: z.enum(['network', 'discover', 'requests_incoming', 'requests_sent']),
    limit: z.number().max(100).optional(),
    cursor: z.string().max(1000).optional(),
    search: z.string().max(100).optional(),
    sortBy: z.enum(['recent', 'name', 'oldest']).optional(),
    filters: z.object({
        seniorPlus: z.boolean().optional(),
        hasMutuals: z.boolean().optional(),
        hasSharedProjects: z.boolean().optional(),
        openProfilesOnly: z.boolean().optional(),
        skills: z.array(z.string().trim().min(1).max(80)).max(5).optional(),
        location: z.string().trim().max(100).optional(),
        openToCollaborate: z.boolean().optional(),
    }).strict().optional(),
    historyFilters: z.object({
        status: z.enum(CONNECTION_REQUEST_HISTORY_STATUSES).optional(),
        direction: z.enum(['sent', 'received']).optional(),
        dateFrom: z.string().trim().max(40).optional(),
        dateTo: z.string().trim().max(40).optional(),
    }).strict().optional(),
    requestSortBy: z.enum(['recent', 'mutual', 'oldest']).optional(),
    includeMeta: z.boolean().optional(),
    includeSharedConnections: z.boolean().optional(),
});

async function getConnectionsFeedImpl(
    input: ConnectionsFeedInput,
    user: Awaited<ReturnType<typeof getAuthUser>>,
) {
    const startedAt = performance.now();
    const validation = connectionsFeedInputSchema.safeParse(input);
    if (!validation.success) {
        return {
            success: false as const,
            code: 'VALIDATION' as const,
            error: 'Invalid connection search request',
            items: [],
            nextCursor: null,
            hasMore: false,
            stats: { totalConnections: 0, pendingIncoming: 0, pendingSent: 0 },
        };
    }
    input = validation.data;
    if (!user) {
        return {
            success: false as const,
            code: 'UNAUTHENTICATED' as const,
            error: 'Sign in to continue',
            items: [],
            nextCursor: null,
            hasMore: false,
            stats: { totalConnections: 0, pendingIncoming: 0, pendingSent: 0 },
        };
    }

    const limit = Math.max(1, Math.min(input.limit ?? 20, 60));
    const tab = input.tab;
    const safeSearch = getSafeSearch(input.search);
    const includeMeta = input.includeMeta !== false;
    const recordPreview = (outcome: 'success' | 'empty' | 'rate-limited' | 'error', resultCount: number) => {
        if (includeMeta || !safeSearch) return;
        recordGlobalSearchMetric({
            domain: 'network',
            scope: tab,
            outcome,
            durationMs: performance.now() - startedAt,
            resultCount,
            queryLength: safeSearch.length,
            tokenCount: tokenizeSearchQuery(safeSearch).length,
        });
    };

    if (safeSearch) {
        const searchRate = await consumeRateLimit(`connections-search:${user.id}`, 100, 60);
        if (!searchRate.allowed) {
            recordPreview('rate-limited', 0);
            return {
                success: false as const,
                code: 'RATE_LIMITED' as const,
                retryAfterMs: 1_000,
                error: 'Too many searches. Wait and try again.',
                items: [],
                nextCursor: null,
                hasMore: false,
                stats: includeMeta
                    ? await getConnectionStatsForUser(user.id)
                    : { totalConnections: 0, pendingIncoming: 0, pendingSent: 0 },
            };
        }
    }

    // Statistics and the first page do not depend on each other.
    const statsStartedAt = performance.now();
    const statsPromise: Promise<ConnectionsFeedStats> = includeMeta
        ? getConnectionStatsForUser(user.id)
        : Promise.resolve({ totalConnections: 0, pendingIncoming: 0, pendingSent: 0 });
    // Only the discover tab reads these: other tabs neither wait for them nor leave them unhandled (PERF-008).
    const metadataPromise = tab !== 'discover' ? null : Promise.all([
        includeMeta
            ? db.select({ id: projects.id }).from(projects).where(eq(projects.ownerId, user.id)).limit(50)
            : Promise.resolve([]),
        // Always: one row, and skill matching on suggestions needs it even without the rest of the meta.
        db.select({ skills: profiles.skills }).from(profiles).where(eq(profiles.id, user.id)).limit(1),
    ]);
    const searchPattern = safeSearch ? containsLikePattern(safeSearch.toLowerCase()) : undefined;
    const searchTokens = safeSearch ? tokenizeSearchQuery(safeSearch.toLowerCase()) : [];
    const rawParsedCursor = parseConnectionsCursor(input.cursor);

    if (tab === 'network') {
        const sortBy = input.sortBy ?? 'recent';
        const connectedDate = sql<Date>`coalesce(${connections.acceptedAt}, ${connections.createdAt})`;
        const parsedCursor = rawParsedCursor?.sortMode === sortBy ? rawParsedCursor : null;
        const conditions = [
            eq(connections.status, 'accepted'),
            or(eq(connections.requesterId, user.id), eq(connections.addresseeId, user.id)),
            isNull(profiles.deletedAt),
            ...personFilterSql(user.id, input.filters),
        ];

        if (searchPattern && safeSearch) conditions.push(searchTokens.length === 1
            ? buildProfileNameFuzzySearchCondition(searchPattern, safeSearch)
            : buildProfileNameIlikeSearchCondition(searchTokens));

        if (parsedCursor) {
            if (sortBy === 'name' && parsedCursor.kind === 'name') {
                conditions.push(buildNameSortedConnectionsCursorCondition(parsedCursor));
            } else if (sortBy === 'oldest' && parsedCursor.kind === 'date') {
                conditions.push(buildConnectionDateCursorCondition({
                    column: connectedDate,
                    isoValue: parsedCursor.updatedAt,
                    id: parsedCursor.id,
                    direction: 'after',
                }));
            } else if (sortBy !== 'name' && parsedCursor.kind === 'date') {
                conditions.push(buildConnectionDateCursorCondition({
                    column: connectedDate,
                    isoValue: parsedCursor.updatedAt,
                    id: parsedCursor.id,
                    direction: 'before',
                }));
            }
        }

        const orderClauses = sortBy === 'name'
            ? [
                sql`${profiles.fullName} ASC NULLS LAST`,
                sql`${profiles.username} ASC NULLS LAST`,
                desc(connections.id),
            ]
            : sortBy === 'oldest'
                ? [asc(connectedDate), asc(connections.id)]
                : [desc(connectedDate), desc(connections.id)];

        const rows = await db
            .select({
                id: connections.id,
                requesterId: connections.requesterId,
                addresseeId: connections.addresseeId,
                status: connections.status,
                createdAt: connections.createdAt,
                updatedAt: connections.updatedAt,
                acceptedAt: connections.acceptedAt,
                sortDate: sql<string>`to_char(${connectedDate} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
                profileId: profiles.id,
                username: profiles.username,
                fullName: profiles.fullName,
                avatarUrl: profiles.avatarUrl,
                headline: profiles.headline,
                location: profiles.location,
                skills: profiles.skills,
                interests: profiles.interests,
                bio: sql<string | null>`null`,
                messagePrivacy: profiles.messagePrivacy,
                openTo: profiles.openTo,
                lastActiveAt: visibleLastActiveAt(user.id),
            })
            .from(connections)
            .innerJoin(
                profiles,
                or(
                    and(eq(connections.requesterId, user.id), eq(connections.addresseeId, profiles.id)),
                    and(eq(connections.addresseeId, user.id), eq(connections.requesterId, profiles.id)),
                ),
            )
            .where(and(...conditions))
            .orderBy(...orderClauses)
            .limit(limit + 1);

        const hasMore = rows.length > limit;

        const items = rows.slice(0, limit).map((row) => ({
            id: row.id,
            type: 'network' as const,
            requesterId: row.requesterId,
            addresseeId: row.addresseeId,
            status: row.status,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            acceptedAt: row.acceptedAt,
            otherUser: {
                id: row.profileId,
                username: row.username,
                fullName: row.fullName,
                avatarUrl: row.avatarUrl,
                headline: row.headline,
                location: row.location,
                skills: (row.skills as string[] | null) ?? [],
                interests: (row.interests as string[] | null) ?? [],
                bio: (row.bio as string | null) ?? null,
                openTo: (row.openTo as string[] | null) ?? [],
                messagePrivacy: (row.messagePrivacy || 'connections') as SuggestedProfile['messagePrivacy'],
                canSendMessage: true,
                lastActiveAt: row.lastActiveAt?.toISOString() ?? null,
            },
        }));
        const networkRelationships = await resolvePrivacyRelationships(
            user.id,
            items.map((item) => item.otherUser.id).filter(Boolean),
        );
        const cardDetails = await readPersonCardDetails(user.id, items.map(item => item.otherUser.id), networkRelationships);
        const visibleItems = items.map((item) => {
            const relationship = networkRelationships.get(item.otherUser.id) ?? null;
            const scoped = buildViewerScopedProfileView({
                profile: {
                    id: item.otherUser.id,
                    username: item.otherUser.username,
                    fullName: item.otherUser.fullName,
                    avatarUrl: item.otherUser.avatarUrl,
                    headline: item.otherUser.headline,
                    location: item.otherUser.location,
                    skills: item.otherUser.skills,
                    interests: item.otherUser.interests,
                    bio: item.otherUser.bio,
                    openTo: item.otherUser.openTo,
                    messagePrivacy: item.otherUser.messagePrivacy,
                    lastActiveAt: item.otherUser.lastActiveAt,
                },
                relationship,
                isOwner: false,
            });

            return {
                ...item,
                otherUser: {
                    ...item.otherUser,
                    username: scoped?.username ?? null,
                    fullName: scoped?.fullName ?? null,
                    avatarUrl: scoped?.avatarUrl ?? null,
                    headline: scoped?.headline ?? null,
                    location: scoped?.location ?? null,
                    skills: cardDetails[item.otherUser.id]?.skills ?? [],
                    ...cardDetails[item.otherUser.id],
                    interests: scoped?.interests ?? [],
                    bio: scoped?.bio ?? null,
                    openTo: scoped?.openTo ?? [],
                    messagePrivacy: (scoped?.messagePrivacy as SuggestedProfile['messagePrivacy']) ?? null,
                    canSendMessage: relationship?.canSendMessage ?? false,
                    lastActiveAt: typeof scoped?.lastActiveAt === 'string'
                        ? scoped.lastActiveAt
                        : scoped?.lastActiveAt instanceof Date
                            ? scoped.lastActiveAt.toISOString()
                            : null,
                },
            };
        }).filter(item => !item.otherUser.isUnavailable);
        after(async () => {
            try {
                await recordPrivacyReadEvents({
                    subjectUserIds: visibleItems.map((item) => item.otherUser.id),
                    viewerUserId: user.id,
                    eventType: 'network_profile_served',
                    route: 'connections.network',
                    metadata: { count: visibleItems.length },
                });
            } catch (error) {
                logger.error('connections.network_privacy_audit_failed', {
                    module: 'connections',
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        });

        // The cursor holds the raw sort keys; the displayed names may have been redacted by privacy.
        const lastRawRow = rows[limit - 1];
        const nextCursor = hasMore && lastRawRow
            ? sortBy === 'name'
                ? encodeConnectionsNameCursor(lastRawRow.fullName, lastRawRow.username, lastRawRow.id)
                : encodeConnectionsCursor(lastRawRow.sortDate, lastRawRow.id, sortBy)
            : null;

        recordPreview(visibleItems.length > 0 ? 'success' : 'empty', visibleItems.length);
        const stats = await statsPromise;
        logger.metric('connections.feed', {
            tab,
            itemCount: visibleItems.length,
            durationMs: Math.round(performance.now() - startedAt),
            statsElapsedMs: Math.round(performance.now() - statsStartedAt),
        });
        return { success: true as const, items: visibleItems, hasMore, nextCursor, stats };
    }

    if (tab === 'requests_incoming' || tab === 'requests_sent') {
        const isIncoming = tab === 'requests_incoming';
        const isMutualRequestsSort = isIncoming && input.requestSortBy === 'mutual';
        const mutualCursor = isMutualRequestsSort && rawParsedCursor?.kind === 'mutual' ? rawParsedCursor : null;
        const profileJoinCondition = isIncoming
            ? eq(profiles.id, connections.requesterId)
            : eq(profiles.id, connections.addresseeId);
        const userCondition = isIncoming
            ? eq(connections.addresseeId, user.id)
            : eq(connections.requesterId, user.id);

        const conditions = [
            eq(connections.status, 'pending'),
            userCondition,
            isNull(profiles.deletedAt),
        ];
        if (searchPattern) conditions.push(buildProfileNameIlikeSearchCondition(searchTokens));
        if (!isMutualRequestsSort && rawParsedCursor?.kind === 'date') {
            conditions.push(buildConnectionDateCursorCondition({
                column: connections.createdAt,
                isoValue: rawParsedCursor.updatedAt,
                id: rawParsedCursor.id,
                // The cursor continues in the query's own direction (COR-030).
                direction: input.requestSortBy === 'oldest' ? 'after' : 'before',
            }));
        }

        const requestsQuery = db
            .select({
                id: connections.id,
                requesterId: connections.requesterId,
                addresseeId: connections.addresseeId,
                status: connections.status,
                createdAt: connections.createdAt,
                updatedAt: connections.updatedAt,
                message: connections.message,
                username: profiles.username,
                fullName: profiles.fullName,
                avatarUrl: profiles.avatarUrl,
                headline: profiles.headline,
                location: profiles.location,
                skills: profiles.skills,
                interests: profiles.interests,
                openTo: profiles.openTo,
                messagePrivacy: profiles.messagePrivacy,
                lastActiveAt: visibleLastActiveAt(user.id),
            })
            .from(connections)
            .innerJoin(profiles, profileJoinCondition)
            .where(and(...conditions))
            .orderBy(
                input.requestSortBy === 'oldest' ? asc(connections.createdAt) : desc(connections.createdAt),
                input.requestSortBy === 'oldest' ? asc(connections.id) : desc(connections.id),
            );

        // Ranking by mutual count needs every pending request in the window, not just the newest page:
        // the sort happens in memory and the cursor is a position in that full order.
        const effectiveLimit = isMutualRequestsSort ? MAX_REQUESTS_LIMIT : Math.min(limit + 1, MAX_REQUESTS_LIMIT);
        const rows = await requestsQuery.limit(effectiveLimit);

        const rawHasMore = rows.length > limit;

        let mutualCountsMap: Record<string, string> | null = null;
        if (isIncoming && redis) {
            try {
                const hash = await redis.hgetall(`discover:mutuals:${user.id}`);
                if (hash && Object.keys(hash).length > 0) {
                    mutualCountsMap = hash as Record<string, string>;
                }
            } catch { /* ignore */ }
        }

        const candidateRows = isMutualRequestsSort ? rows : rows.slice(0, limit + 10);
        const seenRequestUserIds = new Set<string>();
            const dedupedItems = candidateRows.reduce<Array<{
                id: string;
                type: ConnectionsFeedTab;
                requesterId: string;
                addresseeId: string;
            status: string;
            createdAt: Date;
            updatedAt: Date;
            message?: string | null;
            mutualCount?: number;
                user: PersonCardDetails & {
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
            }>>((acc, row) => {
            const userId = isIncoming ? row.requesterId : row.addresseeId;
            if (seenRequestUserIds.has(userId)) return acc;
            seenRequestUserIds.add(userId);
            acc.push({
                id: row.id,
                type: tab,
                requesterId: row.requesterId,
                addresseeId: row.addresseeId,
                status: row.status,
                createdAt: row.createdAt,
                updatedAt: row.updatedAt,
                message: row.message,
                mutualCount: isIncoming && mutualCountsMap ? Number(mutualCountsMap[userId] || 0) : undefined,
                user: {
                    id: isIncoming ? row.requesterId : row.addresseeId,
                    username: row.username,
                    fullName: row.fullName,
                    avatarUrl: row.avatarUrl,
                    headline: row.headline,
                    location: row.location,
                    skills: (row.skills as string[] | null) ?? [],
                    interests: (row.interests as string[] | null) ?? [],
                    openTo: (row.openTo as string[] | null) ?? [],
                    messagePrivacy: (row.messagePrivacy || 'connections') as SuggestedProfile['messagePrivacy'],
                    canSendMessage: (row.messagePrivacy || 'connections') === 'everyone',
                    lastActiveAt: row.lastActiveAt?.toISOString() ?? null,
                },
            });
            return acc;
        }, []);

        // A pending request grants no profile access: project every person
        // through the same viewer-scoped profile view as the network tab (COR-029).
        const requestRelationships = await resolvePrivacyRelationships(user.id, dedupedItems.map((item) => item.user.id));
        for (const item of dedupedItems) {
            const relationship = requestRelationships.get(item.user.id) ?? null;
            const scoped = buildViewerScopedProfileView({ profile: { ...item.user }, relationship, isOwner: false });
            item.user = {
                ...item.user,
                username: scoped?.username ?? null,
                fullName: scoped?.fullName ?? null,
                avatarUrl: scoped?.avatarUrl ?? null,
                headline: scoped?.headline ?? null,
                location: scoped?.location ?? null,
                skills: scoped?.skills ?? [],
                interests: scoped?.interests ?? [],
                openTo: scoped?.openTo ?? [],
                messagePrivacy: (scoped?.messagePrivacy as SuggestedProfile['messagePrivacy']) ?? null,
                canSendMessage: relationship?.canSendMessage ?? false,
                lastActiveAt: typeof scoped?.lastActiveAt === 'string'
                    ? scoped.lastActiveAt
                    : scoped?.lastActiveAt instanceof Date
                        ? scoped.lastActiveAt.toISOString()
                        : null,
            };
        }

        async function enrichRequestPage(page: typeof dedupedItems) {
            const details = await readPersonCardDetails(user!.id, page.map(item => item.user.id), requestRelationships);
            return page.map(item => ({ ...item, user: { ...item.user, ...details[item.user.id] } })).filter(item => !item.user.isUnavailable);
        }
        if (isMutualRequestsSort) {
            const sortedItems = [...dedupedItems].sort(compareIncomingRequestsByMutual);
            const pagedItems = mutualCursor
                ? sortedItems.filter((item) => compareIncomingRequestsByMutual(item, {
                    mutualCount: mutualCursor.mutualCount,
                    createdAt: new Date(mutualCursor.createdAt),
                    id: mutualCursor.id,
                }) > 0)
                : sortedItems;
            const items = pagedItems.slice(0, limit);
            const hasMore = pagedItems.length > limit;
            const nextCursor = hasMore && items.length > 0
                ? encodeConnectionsMutualCursor(
                    items[items.length - 1]!.mutualCount ?? 0,
                    items[items.length - 1]!.createdAt,
                    items[items.length - 1]!.id,
                )
                : null;
            return { success: true as const, items: await enrichRequestPage(items), hasMore, nextCursor, stats: await statsPromise };
        }

        const items = dedupedItems.slice(0, limit);
        const nextCursor = rawHasMore && items.length > 0
            ? encodeConnectionsCursor(
                items[items.length - 1]!.createdAt,
                items[items.length - 1]!.id,
                input.requestSortBy === 'oldest' ? 'oldest' : 'recent',
            )
            : null;

        return { success: true as const, items: await enrichRequestPage(items), hasMore: rawHasMore, nextCursor, stats: await statsPromise };
    }

    let suggestionCursor: { score: number; id: string } | null = null;
    if (input.cursor?.startsWith('s:')) {
        const [scoreValue, id] = input.cursor.slice(2).split('|');
        const score = Number(scoreValue);
        if (Number.isFinite(score) && id) suggestionCursor = { score, id };
        // A cursor that doesn't parse is a bad request, not page 1 again (that would repeat people).
        else return { success: false as const, code: 'VALIDATION' as const, error: 'Invalid connection search request' };
    }

    const discoverConditions = [
        eq(connectionSuggestions.userId, user.id),
        eq(profiles.onboardingStatus, 'completed'),
        isNull(profiles.deletedAt),
        notFixtureAccountSql(profiles.email),
        sql`NOT EXISTS (
            SELECT 1 FROM ${connectionSuggestionDismissals}
            WHERE ${connectionSuggestionDismissals.userId} = ${user.id}
              AND ${connectionSuggestionDismissals.dismissedProfileId} = ${profiles.id}
        )`,
        sql`NOT EXISTS (
            SELECT 1 FROM ${connections} existing
            WHERE ((existing.requester_id = ${user.id} AND existing.addressee_id = ${profiles.id})
               OR (existing.requester_id = ${profiles.id} AND existing.addressee_id = ${user.id}))
              AND existing.status IN ('accepted', 'blocked')
        )`,
    ];
    if (suggestionCursor) discoverConditions.push(buildSuggestionScoreCursorCondition(suggestionCursor));
    if (searchPattern) {
        discoverConditions.push(eq(profiles.visibility, 'public'));
        discoverConditions.push(buildDiscoverProfileSearchCondition(searchTokens));
    }
    if (input.filters?.seniorPlus) discoverConditions.push(sql`${profiles.experienceLevel} IN ('senior', 'lead', 'founder')`);
    discoverConditions.push(...personFilterSql(user.id, input.filters));
    if (input.filters?.openProfilesOnly) {
        // Null settings mean the defaults (public, everyone), as the privacy resolver reads them.
        discoverConditions.push(sql`coalesce(${profiles.visibility}, 'public') = 'public'`);
        discoverConditions.push(sql`coalesce(${profiles.connectionPrivacy}, 'everyone') <> 'nobody'`);
    }
    if (input.filters?.hasSharedProjects) {
        discoverConditions.push(sql`EXISTS (SELECT 1 FROM ${projects} WHERE ${projects.ownerId} = ${profiles.id})`);
    }

    const discoverQueryStartedAt = performance.now();
    const rows = searchPattern ? [] : await db
        .select({
            suggestedUserId: connectionSuggestions.suggestedUserId,
            mutualConnectionsCount: connectionSuggestions.mutualConnectionsCount,
            score: suggestionScore,
            reason: sql<string>`CASE WHEN NOT ${profiles.openToCollaborate} AND ${connectionSuggestions.reason} LIKE 'Matches your open role:%'
                THEN ${connectionSuggestions.mutualConnectionsCount}::text || ' mutual connections' ELSE ${connectionSuggestions.reason} END`,
            username: profiles.username,
            fullName: profiles.fullName,
            avatarUrl: profiles.avatarUrl,
            headline: profiles.headline,
            location: profiles.location,
            visibility: profiles.visibility,
            messagePrivacy: profiles.messagePrivacy,
            connectionPrivacy: profiles.connectionPrivacy,
            experienceLevel: profiles.experienceLevel,
            lastActiveAt: visibleLastActiveAt(user.id),
            skills: profiles.skills,
            interests: profiles.interests,
            openTo: profiles.openTo,
        })
        .from(connectionSuggestions)
        .innerJoin(profiles, eq(profiles.id, connectionSuggestions.suggestedUserId))
        .where(and(...discoverConditions))
        .orderBy(desc(suggestionScore), desc(connectionSuggestions.suggestedUserId))
        .limit(limit + 1);
    const discoverQueryMs = Math.round(performance.now() - discoverQueryStartedAt);

    let items: Array<SuggestedProfile & { type: 'discover' }> = rows.slice(0, limit).map((row) => {
        const profileVisibility = (row.visibility || 'public') as SuggestedProfile['profileVisibility'];
        return {
            id: row.suggestedUserId,
            type: 'discover' as const,
            username: row.username,
            fullName: row.fullName,
            avatarUrl: row.avatarUrl,
            headline: row.headline,
            location: row.location,
            connectionStatus: 'none' as const,
            canConnect: true,
            profileVisibility,
            isLockedProfile: profileVisibility !== 'public',
            mutualConnections: row.mutualConnectionsCount,
            recommendationReason: row.reason || `${row.mutualConnectionsCount} mutual connections`,
            experienceLevel: row.experienceLevel as SuggestedProfile['experienceLevel'],
            openTo: (row.openTo as string[]) ?? [],
            messagePrivacy: (row.messagePrivacy || 'connections') as SuggestedProfile['messagePrivacy'],
            canSendMessage: row.messagePrivacy === 'everyone',
            lastActiveAt: row.lastActiveAt?.toISOString() ?? null,
            skills: (row.skills as string[]) ?? [],
            interests: (row.interests as string[]) ?? [],
        };
    });

    let searchFallbackHasMore = false;
    let searchFallbackNextCursor: string | null = null;
    // Search must cover every eligible profile, not only the viewer's precomputed
    // suggestion rows. The same query is also the cold-start fallback.
    if ((!suggestionCursor || searchPattern) && !input.filters?.hasMutuals && (Boolean(searchPattern) || items.length === 0)) {
        const fallbackConditions = [
            sql`${profiles.id} != ${user.id}`,
            eq(profiles.onboardingStatus, 'completed'),
            isNull(profiles.deletedAt),
        ];
        if (searchPattern) {
            fallbackConditions.push(sql`NOT EXISTS (
                SELECT 1 FROM ${connections} blocked_connection
                WHERE blocked_connection.status = 'blocked'
                  AND (
                    (blocked_connection.requester_id = ${user.id} AND blocked_connection.addressee_id = ${profiles.id})
                    OR (blocked_connection.requester_id = ${profiles.id} AND blocked_connection.addressee_id = ${user.id})
                  )
            )`);
            fallbackConditions.push(sql`(
                ${profiles.visibility} = 'public'
                OR EXISTS (
                    SELECT 1 FROM ${connections} accepted_connection
                    WHERE accepted_connection.status = 'accepted'
                      AND (
                        (accepted_connection.requester_id = ${user.id} AND accepted_connection.addressee_id = ${profiles.id})
                        OR (accepted_connection.requester_id = ${profiles.id} AND accepted_connection.addressee_id = ${user.id})
                      )
                )
            )`);
            fallbackConditions.push(buildDiscoverProfileSearchCondition(searchTokens));
        } else {
            fallbackConditions.push(sql`NOT EXISTS (
                SELECT 1 FROM ${connectionSuggestionDismissals}
                WHERE ${connectionSuggestionDismissals.userId} = ${user.id}
                  AND ${connectionSuggestionDismissals.dismissedProfileId} = ${profiles.id}
            )`);
            fallbackConditions.push(sql`NOT EXISTS (
                SELECT 1 FROM ${connections} existing
                WHERE ((existing.requester_id = ${user.id} AND existing.addressee_id = ${profiles.id})
                   OR (existing.requester_id = ${profiles.id} AND existing.addressee_id = ${user.id}))
                  AND existing.status IN ('accepted', 'blocked')
            )`);
        }
        fallbackConditions.push(...personFilterSql(user.id, input.filters));
        if (input.filters?.seniorPlus) fallbackConditions.push(sql`${profiles.experienceLevel} IN ('senior', 'lead', 'founder')`);
        if (input.filters?.openProfilesOnly) {
            fallbackConditions.push(sql`coalesce(${profiles.visibility}, 'public') = 'public'`);
            fallbackConditions.push(sql`coalesce(${profiles.connectionPrivacy}, 'everyone') <> 'nobody'`);
        }
        if (input.filters?.hasSharedProjects) {
            fallbackConditions.push(sql`EXISTS (SELECT 1 FROM ${projects} WHERE ${projects.ownerId} = ${profiles.id})`);
        }
        const searchRank = sql`CASE
                    WHEN lower(coalesce(${profiles.username}, '')) = ${safeSearch?.toLowerCase() ?? ''} THEN 100
                    WHEN lower(coalesce(${profiles.fullName}, '')) = ${safeSearch?.toLowerCase() ?? ''} THEN 95
                    WHEN lower(coalesce(${profiles.username}, '')) LIKE ${(safeSearch?.toLowerCase() ?? '') + '%'} THEN 80
                    WHEN lower(coalesce(${profiles.fullName}, '')) LIKE ${(safeSearch?.toLowerCase() ?? '') + '%'} THEN 75
                    ELSE 10
                END`;
        // Results are ordered (rank DESC, updatedAt DESC, id DESC), so the cursor carries all three.
        if (searchPattern && rawParsedCursor?.kind === 'date' && rawParsedCursor.sortMode === 'recent' && rawParsedCursor.rank !== undefined) {
            fallbackConditions.push(sql`(
                ${searchRank} < ${rawParsedCursor.rank}
                OR (${searchRank} = ${rawParsedCursor.rank}
                    AND (${profiles.updatedAt}, ${profiles.id}) < (${rawParsedCursor.updatedAt}::timestamptz, ${rawParsedCursor.id}::uuid))
            )`);
        } else if (!searchPattern && rawParsedCursor?.kind === 'date') {
            fallbackConditions.push(buildConnectionDateCursorCondition({
                column: profiles.updatedAt,
                idColumn: profiles.id,
                isoValue: rawParsedCursor.updatedAt,
                id: rawParsedCursor.id,
                direction: 'before',
            }));
        }

        const fallbackRows = await db
            .select({
                id: profiles.id,
                username: profiles.username,
                fullName: profiles.fullName,
                avatarUrl: profiles.avatarUrl,
                headline: profiles.headline,
                location: profiles.location,
                visibility: profiles.visibility,
                messagePrivacy: profiles.messagePrivacy,
                connectionPrivacy: profiles.connectionPrivacy,
                experienceLevel: profiles.experienceLevel,
                lastActiveAt: visibleLastActiveAt(user.id),
                skills: profiles.skills,
                interests: profiles.interests,
                openTo: profiles.openTo,
                updatedAt: profiles.updatedAt,
                searchRank: sql<number>`${searchRank}`,
            })
            .from(profiles)
            .where(and(...fallbackConditions))
            .orderBy(
                searchPattern ? sql`${searchRank} DESC` : sql`${profiles.lastActiveAt} DESC NULLS LAST`,
                searchPattern ? desc(profiles.updatedAt) : desc(profiles.id),
                desc(profiles.id),
            )
            .limit(limit + 1);

        const fallbackPageRows = fallbackRows.slice(0, limit);
        if (searchPattern) {
            searchFallbackHasMore = fallbackRows.length > limit;
            const lastFallbackRow = fallbackPageRows[fallbackPageRows.length - 1];
            searchFallbackNextCursor = searchFallbackHasMore && lastFallbackRow
                ? encodeConnectionsCursor(lastFallbackRow.updatedAt, lastFallbackRow.id, 'recent', Number(lastFallbackRow.searchRank))
                : null;
        }

        items = fallbackPageRows.map((row) => {
            const profileVisibility = (row.visibility || 'public') as SuggestedProfile['profileVisibility'];
            return {
                id: row.id,
                type: 'discover' as const,
                username: row.username,
                fullName: row.fullName,
                avatarUrl: row.avatarUrl,
                headline: row.headline,
                location: row.location,
                connectionStatus: 'none' as const,
                canConnect: true,
                profileVisibility,
                isLockedProfile: profileVisibility !== 'public',
                mutualConnections: undefined,
                recommendationReason: "Suggested for your network",
                experienceLevel: row.experienceLevel as SuggestedProfile['experienceLevel'],
                openTo: (row.openTo as string[]) ?? [],
                messagePrivacy: (row.messagePrivacy || 'connections') as SuggestedProfile['messagePrivacy'],
                canSendMessage: row.messagePrivacy === 'everyone',
                lastActiveAt: row.lastActiveAt?.toISOString() ?? null,
                skills: (row.skills as string[]) ?? [],
                interests: (row.interests as string[]) ?? [],
            };
        });
    }
    const privacyStartedAt = performance.now();
    const cardDetails = await readPersonCardDetails(user.id, items.map(item => item.id));
    const privateAware = (await applySuggestedProfilePrivacy(user.id, items)).map(item => item.isLockedProfile
            ? { ...item, skills: [], portfolio: null, openToCollaborate: null, mutualConnections: null, isUnavailable: cardDetails[item.id]?.isUnavailable }
            : { ...item, ...cardDetails[item.id] })
        .filter(item => item.id !== user.id && item.connectionStatus !== 'blocked' && !item.isUnavailable);
    // The Discover rail suggests people you can actually connect with (not "mutuals only" strangers).
    const visibleItems = input.filters?.openProfilesOnly
        ? privateAware.filter((item) => item.connectionStatus !== 'none' || item.canConnect !== false)
        : privateAware;
    const privacyMs = Math.round(performance.now() - privacyStartedAt);
    const metadataStartedAt = performance.now();
    const [viewerProjects, viewerProfiles] = await metadataPromise!;
    const metadataMs = Math.round(performance.now() - metadataStartedAt);
    after(async () => {
        try {
            await recordPrivacyReadEvents({
                subjectUserIds: visibleItems.map((item) => item.id),
                viewerUserId: user.id,
                eventType: 'discover_profile_served',
                route: 'connections.discover.precomputed',
                metadata: { count: visibleItems.length },
            });
        } catch (error) {
            logger.error('connections.discover_privacy_audit_failed', {
                module: 'connections',
                error: error instanceof Error ? error.message : String(error),
            });
        }
    });
    const hasMore = searchPattern ? searchFallbackHasMore : rows.length > limit;
    const last = rows[Math.min(limit - 1, rows.length - 1)];
    recordPreview(visibleItems.length > 0 ? 'success' : 'empty', visibleItems.length);
    const stats = await statsPromise;
    logger.metric('connections.feed', {
        tab,
        itemCount: visibleItems.length,
        durationMs: Math.round(performance.now() - startedAt),
        statsElapsedMs: Math.round(performance.now() - statsStartedAt),
        discoverQueryMs,
        privacyMs,
        metadataMs,
    });
    return {
        success: true as const,
        items: visibleItems,
        hasMore,
        nextCursor: searchPattern
            ? searchFallbackNextCursor
            : hasMore && last ? `s:${last.score}|${last.suggestedUserId}` : null,
        stats,
        viewerProjectIds: viewerProjects.map((project) => project.id),
        viewerSkills: (viewerProfiles[0]?.skills as string[]) ?? [],
        sharedConnections: input.includeSharedConnections
            ? await readSharedConnections(user.id, visibleItems.slice(0, DISCOVER_RAIL_CARD_COUNT).map(item => item.id)).catch(error => {
                logger.warn('connections.shared_summary_failed', { error: error instanceof Error ? error.message : String(error) });
                return undefined;
            })
            : undefined,
    };
}

export async function getConnectionsFeed(input: ConnectionsFeedInput) {
    const startedAt = performance.now();
    const user = await getAuthUser();
    if (!user) {
        return getConnectionsFeedImpl(input, null);
    }
    // Validate before any cache read: an invalid request never gets someone else's cached answer.
    if (!connectionsFeedInputSchema.safeParse(input).success) return getConnectionsFeedImpl(input, user);
    const safeSearch = input.search ? input.search.trim().replace(/\s+/g, ' ').slice(0, 100) : '';
    const includeMeta = input.includeMeta !== false;
    // Everything that changes the answer is in the key (page size, page, sort and filters too), and only
    // the first page of a search preview is cached.
    const requestShape = JSON.stringify({
        tab: input.tab,
        limit: input.limit ?? 20,
        search: safeSearch.toLowerCase(),
        sortBy: input.sortBy ?? 'recent',
        filters: input.filters ?? null,
        historyFilters: input.historyFilters ?? null,
        requestSortBy: input.requestSortBy ?? null,
        includeSharedConnections: input.includeSharedConnections === true,
    });
    const previewRevision = !includeMeta && safeSearch && !input.cursor
        ? await redis?.get<number>('search:preview:people:revision').catch(() => 0) ?? 0
        : 0;
    const cacheKey = !includeMeta && safeSearch && !input.cursor
        ? `search:preview:people:v4:${previewRevision}:${user.id}:${requestShape}`
        : null;

    if (cacheKey) {
        const cached = await getCachedData<
            Awaited<ReturnType<typeof getConnectionsFeedImpl>>
        >(cacheKey);
        if (cached) {
            return cached as Awaited<ReturnType<typeof getConnectionsFeedImpl>>;
        }
    }

    const dedupeKey = `connections:feed:${user.id}:${JSON.stringify({
        tab: input.tab,
        limit: input.limit ?? 20,
        cursor: input.cursor ?? null,
        search: safeSearch,
        includeMeta,
        sortBy: input.sortBy ?? 'recent',
        includeSharedConnections: input.includeSharedConnections === true,
        filters: input.filters ?? null,
        historyFilters: input.historyFilters ?? null,
        requestSortBy: input.requestSortBy ?? null,
    })}`;
    const result = await runInFlightDeduped(dedupeKey, () => getConnectionsFeedImpl(input, user));
    logger.metric('connections.feed.action', {
        tab: input.tab,
        durationMs: Math.round(performance.now() - startedAt),
        includeMeta,
    });

    if (cacheKey && result && result.success && result.items.length > 0) {
        await cacheData(cacheKey, result, 180);
    }

    return result;
}


const CONNECTION_REQUEST_IDEMPOTENCY_TTL_SECONDS = 60;

// Two anti-spam layers independent of the short-window per-user and
// per-target token buckets above. The daily cap stops "phishing-style" fan-out
// where one compromised account DMs hundreds of strangers per day; the
// per-(sender, target) 24h hold prevents oscillating the same request until a
// bucket refills.
const CONNECTION_REQUEST_DAILY_CAP = 50;
const CONNECTION_REQUEST_DAILY_WINDOW_SECONDS = 24 * 60 * 60;
const CONNECTION_REQUEST_PER_TARGET_HOLD_SECONDS = 24 * 60 * 60;

async function clearConnectionRequestHold(userA: string, userB: string) {
    if (!redis) return;
    try {
        await Promise.allSettled([
            redis.del(`connections-send-hold:${userA}:${userB}`),
            redis.del(`connections-send-hold:${userB}:${userA}`),
        ]);
    } catch {
        // A stale hold should never make terminal DB states unrecoverable.
    }
}

type SendConnectionRequestResult = {
    success: boolean;
    error?: string;
    connectionId?: string;
    status?: 'created' | 'pending_sent' | 'pending_received' | 'connected';
};

/**
 * Sends a connection request once per idempotency key: a retry with the same key replays the first
 * result, and a retry while the first is still running says so (never a success it hasn't earned).
 */
export async function sendConnectionRequest(
    addresseeId: string,
    idempotencyKey?: string,
    _message?: string,
): Promise<SendConnectionRequestResult> {
    if (!isLooseUuid(addresseeId)) {
        return { success: false, error: 'Invalid user ID' };
    }
    const user = await getAuthUser();
    if (!user) return { success: false, error: 'Sign in to continue' };
    try {
        const outcome = await runIdempotent(
            { namespace: 'connection-request', scopeId: `${user.id}:${addresseeId}`, key: idempotencyKey, resultTtlSeconds: CONNECTION_REQUEST_IDEMPOTENCY_TTL_SECONDS },
            () => sendConnectionRequestNow(user, addresseeId, _message),
        );
        return outcome.result;
    } catch (error) {
        if (error instanceof IdempotencyConflictError) return { success: false, error: 'Your request is still being sent. Try again in a moment.' };
        console.error('Error sending connection request:', error);
        return { success: false, error: 'Request wasn’t sent' };
    }
}

async function sendConnectionRequestNow(
    user: NonNullable<Awaited<ReturnType<typeof getAuthUser>>>,
    addresseeId: string,
    _message?: string,
): Promise<SendConnectionRequestResult> {
    const returnFailure = async (error: string): Promise<SendConnectionRequestResult> => ({ success: false, error });

    try {
        // Clamp message length to prevent oversized payloads.
        const requestMessage = _message?.trim().slice(0, 500) || null;

        // Can't connect to yourself
        if (user.id === addresseeId) {
            return await returnFailure('Cannot connect to yourself');
        }

        // PURE OPTIMIZATION (Flow 1.4, Item 1, Item 105):
        // Authoritative privacy check replaces redundant un-locked connections pre-read.
        const privacy = await resolvePrivacyRelationship(user.id, addresseeId);
        if (!privacy) {
            return await returnFailure('User not found');
        }
        if (privacy.isConnected) {
            return { success: true, connectionId: privacy.latestConnectionId ?? undefined, status: 'connected' };
        }
        if (privacy.hasPendingOutgoingRequest) {
            return {
                success: true,
                connectionId: privacy.latestConnectionId ?? undefined,
                status: 'pending_sent',
            };
        }
        if (privacy.hasPendingIncomingRequest) {
            return {
                success: true,
                connectionId: privacy.latestConnectionId ?? undefined,
                status: 'pending_received',
            };
        }
        if (privacy.blockedByViewer || privacy.blockedByTarget) {
            return await returnFailure('You cannot send a request to this account.');
        }
        if (!privacy.canSendConnectionRequest) {
            if (privacy.connectionPrivacy === 'nobody') {
                return await returnFailure('This user is not accepting connection requests.');
            }
            if (privacy.connectionPrivacy === 'mutuals_only') {
                return await returnFailure('This user only accepts requests from mutual connections.');
            }
            return await returnFailure('Cannot send request right now.');
        }

        // If retrying a prior terminal connection (cancelled/disconnected/rejected), clear any stale hold.
        if (privacy.latestConnectionId && privacy.connectionState === 'none') {
            await clearConnectionRequestHold(user.id, addresseeId);
        }

        const perTargetHoldKey = `connections-send-hold:${user.id}:${addresseeId}`;
        const shouldEnforcePerTargetHold = !privacy.latestConnectionId;
        if (shouldEnforcePerTargetHold && redis) {
            try {
                const held = await redis.get(perTargetHoldKey);
                if (held) {
                    return await returnFailure('You have recently contacted this person. Wait before trying again.');
                }
            } catch {
                // Fall through — Redis hiccup should not block legit flow.
            }
        }

        const requestRate = await consumeRateLimit(`connections-send:${user.id}`, 30, 60);
        if (!requestRate.allowed) {
            return await returnFailure('Too many requests. Wait and try again.');
        }
        const dailyRate = await consumeRateLimit(
            `connections-send-daily:${user.id}`,
            CONNECTION_REQUEST_DAILY_CAP,
            CONNECTION_REQUEST_DAILY_WINDOW_SECONDS,
        );
        if (!dailyRate.allowed) {
            return await returnFailure('You have sent too many connection requests today. Try again tomorrow.');
        }
        const targetRate = await consumeRateLimit(`connections-send-target:${user.id}:${addresseeId}`, 3, 3600);
        if (!targetRate.allowed) {
            return await returnFailure('You have sent too many requests to this person. Wait before trying again.');
        }

        const txResult = await db.transaction(async (tx) => {
            const pairKey = [user.id, addresseeId].sort().join(":");
            // ponytail: 64-bit hashtextextended advisory lock serializes connection pair creation. ceiling: 10M connection pairs. upgrade: partition connections table by hash of low uuid.
            await tx.execute(sql`
                SELECT pg_advisory_xact_lock(hashtextextended('connection-pair:' || ${pairKey}, 0))
            `);
            // ponytail: Match connections_active_pair_unique functional index (LEAST, GREATEST) for a 1-row direct B-tree seek. ceiling: 10M pairs at <0.2ms seek. upgrade: none needed, native unique constraint handles idempotency.
            const [minUserId, maxUserId] = user.id < addresseeId ? [user.id, addresseeId] : [addresseeId, user.id];
            const existing = await tx
                .select({
                    id: connections.id,
                    status: connections.status,
                    requesterId: connections.requesterId,
                    addresseeId: connections.addresseeId,
                    updatedAt: connections.updatedAt,
                })
                .from(connections)
                .where(
                    and(
                        sql`LEAST(${connections.requesterId}, ${connections.addresseeId}) = ${minUserId}::uuid`,
                        sql`GREATEST(${connections.requesterId}, ${connections.addresseeId}) = ${maxUserId}::uuid`
                    )
                )
                .limit(1);

            if (existing.length > 0) {
                const conn = existing[0]!;
                if (conn.status === 'accepted') return { connectionId: conn.id, status: 'connected' as const, skippedWrite: true };
                if (conn.status === 'pending') {
                    if (conn.requesterId === user.id) {
                        return {
                            connectionId: conn.id,
                            status: 'pending_sent' as const,
                            skippedWrite: true,
                        };
                    }

                    // ponytail: serializes concurrent reciprocal requests and automatically fulfills mutual intent. ceiling: 10k reciprocal requests/min. upgrade: unified acceptance transaction pipeline.
                    const [lowerId, higherId] = [user.id, conn.requesterId].sort();
                    await tx.execute(sql`
                        WITH accepted_conn AS (
                            UPDATE connections
                            SET status = 'accepted', accepted_at = now(), updated_at = now()
                            WHERE id = ${conn.id}::uuid
                              AND status = 'pending'
                            RETURNING requester_id, addressee_id
                        ),
                        canonical_profiles AS (
                            SELECT id FROM profiles
                            WHERE id IN (${lowerId}::uuid, ${higherId}::uuid)
                            ORDER BY id ASC
                            FOR UPDATE
                        )
                        UPDATE profiles
                        SET connections_count = GREATEST(0, connections_count + 1),
                            updated_at = now()
                        WHERE id IN (SELECT id FROM canonical_profiles)
                    `);

                    return { connectionId: conn.id, status: 'connected' as const, autoAccepted: true };
                }
                if (conn.status === 'blocked') return { error: 'Cannot send request' };
                if (conn.status === 'rejected' || conn.status === 'cancelled' || conn.status === 'disconnected') {
                    if (conn.status === 'rejected') {
                        const isSameDirection = conn.requesterId === user.id && conn.addresseeId === addresseeId;
                        if (isSameDirection) {
                            const cooldownUntil = new Date(new Date(conn.updatedAt).getTime() + REJECT_REQUEST_COOLDOWN_MS);
                            if (cooldownUntil.getTime() > Date.now()) {
                                return {
                                    error: `This request was recently declined. You can retry after ${cooldownUntil.toLocaleString()}.`,
                                };
                            }
                        }
                    }

                    const [reactivated] = await tx
                        .update(connections)
                        .set({
                            requesterId: user.id,
                            addresseeId,
                            status: 'pending',
                            message: requestMessage,
                            updatedAt: new Date(),
                            createdAt: new Date(), // PURE OPTIMIZATION: Reset createdAt so it bubbles to top of incoming feeds
                        })
                        .where(and(
                            eq(connections.id, conn.id),
                            eq(connections.status, conn.status),
                            eq(connections.requesterId, conn.requesterId),
                            eq(connections.addresseeId, conn.addresseeId),
                        ))
                        .returning({ id: connections.id });
                    if (!reactivated) return { error: 'Connection changed while retrying. Try again.' };
                    return { connectionId: conn.id, status: 'created' as const };
                }
            }

            try {
                const inserted = await tx
                    .insert(connections)
                    .values({
                        requesterId: user.id,
                        addresseeId: addresseeId,
                        status: 'pending',
                        message: requestMessage,
                    })
                    .returning({ id: connections.id });
                return { connectionId: inserted[0]!.id, status: 'created' as const };
            } catch (err: unknown) {
                // If unique constraint is violated, someone else inserted concurrently
                if (getErrorCode(err) === '23505') {
                    return { error: 'Request was already sent or a connection exists.' };
                }
                throw err;
            }
        });

        if (!txResult.connectionId) {
            return await returnFailure(txResult.error || 'Request wasn’t sent');
        }

        const connectionId = txResult.connectionId;
        const isNewRequest = !txResult.skippedWrite;
        const wasAutoAccepted = Boolean((txResult as any).autoAccepted);

        // ponytail: Return HTTP response immediately after authoritative DB commit; offload notifications, Redis holds, and cache purges to Next.js after(). ceiling: 10k req/min with zero HTTP thread blocking. upgrade: durable background queue worker for notification fanout.
        after(async () => {
            try {
                await Promise.allSettled([
                    isNewRequest && redis ? redis.set(perTargetHoldKey, '1', {
                        nx: true,
                        ex: CONNECTION_REQUEST_PER_TARGET_HOLD_SECONDS,
                    }) : Promise.resolve(),
                    invalidateDiscoverCacheForUsers([user.id, addresseeId]),
                    queueCounterRefreshBestEffort([addresseeId]),
                    revalidateConnectionsPaths(),
                    wasAutoAccepted
                        ? emitConnectionAcceptedNotification({
                            recipientUserId: addresseeId,
                            actorUserId: user.id,
                            actorName: (user.user_metadata?.full_name as string | undefined) ?? (user.user_metadata?.username as string | undefined) ?? null,
                            actorAvatarUrl: (user.user_metadata?.avatar_url as string | undefined) ?? null,
                            connectionId,
                            eventKey: new Date().toISOString(),
                        })
                        : isNewRequest
                            ? emitConnectionRequestReceivedNotification({
                                recipientUserId: addresseeId,
                                actorUserId: user.id,
                                actorName: (user.user_metadata?.full_name as string | undefined) ?? (user.user_metadata?.username as string | undefined) ?? null,
                                actorAvatarUrl: (user.user_metadata?.avatar_url as string | undefined) ?? null,
                                connectionId,
                                eventKey: new Date().toISOString(),
                            })
                            : Promise.resolve(),
                ]);
            } catch (bgError) {
                logger.error('connections.send_background_failed', {
                    module: 'connections',
                    error: bgError instanceof Error ? bgError.message : String(bgError),
                    connectionId,
                });
            }
        });

        return { success: true, connectionId: txResult.connectionId, status: txResult.status ?? 'created' };
    } catch (error) {
        console.error('Error sending connection request:', error);
        return { success: false, error: 'Request wasn’t sent' };
    }
}

export async function dismissConnectionSuggestion(
    dismissedProfileId: string,
    feedbackReason?: string,
): Promise<{ success: boolean; error?: string }> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Sign in to continue' };
        if (dismissedProfileId === user.id) return { success: false, error: 'Invalid target profile' };

        const dismissRate = await consumeRateLimit(`connections-dismiss:${user.id}`, 200, 60);
        if (!dismissRate.allowed) {
            return { success: false, error: 'Too many actions. Wait and try again.' };
        }

        // Validate and clamp dismiss feedback reason.
        const safeFeedbackReason = feedbackReason?.trim().slice(0, 120) || undefined;

        await db
            .insert(connectionSuggestionDismissals)
            .values({
                userId: user.id,
                dismissedProfileId,
                ...(safeFeedbackReason ? { reason: safeFeedbackReason } : {}),
            })
            .onConflictDoNothing({
                target: [connectionSuggestionDismissals.userId, connectionSuggestionDismissals.dismissedProfileId],
            });

        await invalidateDiscoverCacheForUsers([user.id]);
        revalidatePath('/network');
        return { success: true };
    } catch (error) {
        console.error('Error dismissing suggestion:', error);
        return { success: false, error: 'Couldn’t dismiss suggestion' };
    }
}

export async function acceptAllIncomingConnectionRequests(
    limit: number = 100
): Promise<{ success: boolean; count?: number; error?: string }> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Sign in to continue' };

        const effectiveLimit = Math.max(1, Math.min(limit, 200));
        const bulkAcceptRate = await consumeRateLimit(`connections-accept-all:${user.id}`, 6, 60);
        if (!bulkAcceptRate.allowed) {
            return { success: false, error: 'Too many bulk actions. Wait and try again.' };
        }

        const accepted = await db.transaction(async (tx) => {
            const pendingRows = await tx
                .select({ id: connections.id })
                .from(connections)
                .where(
                    and(
                        eq(connections.addresseeId, user.id),
                        eq(connections.status, 'pending')
                    )
                )
                .orderBy(desc(connections.createdAt), desc(connections.id))
                .limit(effectiveLimit);
            const pendingIds = pendingRows.map((row) => row.id);
            if (pendingIds.length === 0) return [];

            const rows = await tx
                .update(connections)
                .set({
                    status: 'accepted',
                    updatedAt: new Date(),
                })
                .where(and(
                    inArray(connections.id, pendingIds),
                    eq(connections.addresseeId, user.id),
                    eq(connections.status, 'pending'),
                ))
                .returning({
                    id: connections.id,
                    requesterId: connections.requesterId,
                    addresseeId: connections.addresseeId,
                });

            const counterDeltas = new Map<string, number>();
            for (const row of rows) {
                counterDeltas.set(row.requesterId, (counterDeltas.get(row.requesterId) ?? 0) + 1);
                counterDeltas.set(row.addresseeId, (counterDeltas.get(row.addresseeId) ?? 0) + 1);
            }
            await applyConnectionsCountDeltas(tx, counterDeltas);
            return rows;
        });

        if (accepted.length > 0) {
            const affectedUserIds = new Set<string>([user.id]);
            for (const row of accepted) {
                affectedUserIds.add(row.requesterId);
                affectedUserIds.add(row.addresseeId);
            }

            await Promise.allSettled(
                accepted.map((row) => clearConnectionRequestHold(row.requesterId, row.addresseeId)),
            );
            await queueCounterRefreshBestEffort([...affectedUserIds]);
            await invalidateDiscoverCacheForUsers(affectedUserIds);
            await Promise.allSettled([
                applyConnectionPairsToRedis(accepted, 'add'),
                ...[...affectedUserIds].map((userId) =>
                    inngest.send({ name: 'workspace/connections.sync_suggestions', data: { userId } }),
                ),
                ...accepted.map((row) =>
                    emitConnectionAcceptedNotification({
                        recipientUserId: row.requesterId,
                        actorUserId: row.addresseeId,
                        actorName: (user.user_metadata?.full_name as string | undefined)
                            ?? (user.user_metadata?.username as string | undefined)
                            ?? null,
                        actorAvatarUrl: (user.user_metadata?.avatar_url as string | undefined) ?? null,
                        connectionId: row.id,
                        eventKey: `${row.id}:${new Date().toISOString()}`,
                    }),
                ),
            ]);
            await revalidateConnectionsPaths();
        }

        return { success: true, count: accepted.length };
    } catch (error) {
        console.error('Error accepting all requests:', error);
        return { success: false, error: 'Couldn’t accept all requests' };
    }
}

export async function rejectAllIncomingConnectionRequests(
    limit: number = 100
): Promise<{ success: boolean; count?: number; error?: string }> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Sign in to continue' };

        const effectiveLimit = Math.max(1, Math.min(limit, 200));
        const bulkRejectRate = await consumeRateLimit(`connections-reject-all:${user.id}`, 6, 60);
        if (!bulkRejectRate.allowed) {
            return { success: false, error: 'Too many bulk actions. Wait and try again.' };
        }

        const rejected = await db.transaction(async (tx) => {
            const pendingRows = await tx
                .select({ id: connections.id })
                .from(connections)
                .where(
                    and(
                        eq(connections.addresseeId, user.id),
                        eq(connections.status, 'pending')
                    )
                )
                .orderBy(desc(connections.createdAt), desc(connections.id))
                .limit(effectiveLimit);
            const pendingIds = pendingRows.map((row) => row.id);
            if (pendingIds.length === 0) return [];

            return tx
                .update(connections)
                .set({
                    status: 'rejected',
                    rejectionReason: null,
                    updatedAt: new Date(),
                })
                .where(and(
                    inArray(connections.id, pendingIds),
                    eq(connections.addresseeId, user.id),
                    eq(connections.status, 'pending'),
                ))
                .returning({
                    requesterId: connections.requesterId,
                    addresseeId: connections.addresseeId,
                });
        });

        if (rejected.length > 0) {
            const affectedUserIds = new Set<string>([user.id]);
            for (const row of rejected) {
                affectedUserIds.add(row.requesterId);
                affectedUserIds.add(row.addresseeId);
            }
            await queueCounterRefreshBestEffort([...affectedUserIds]);
            await invalidateDiscoverCacheForUsers(affectedUserIds);
            await revalidateConnectionsPaths();
        }

        return { success: true, count: rejected.length };
    } catch (error) {
        console.error('Error rejecting all requests:', error);
        return { success: false, error: 'Couldn’t decline all requests' };
    }
}

// ============================================================================
// CANCEL CONNECTION REQUEST (Requester only, pending only)
// ============================================================================

export async function cancelConnectionRequest(
    connectionId: string
): Promise<{
    success: boolean;
    error?: string;
    connectionId?: string;
    requesterId?: string;
    addresseeId?: string;
    status?: 'withdrawn' | 'already_withdrawn';
}> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Sign in to continue' };
        const cancelRate = await consumeRateLimit(`connections-cancel:${user.id}`, 60, 60);
        if (!cancelRate.allowed) {
            return { success: false, error: 'Too many actions. Wait and try again.' };
        }

        const cancelled = await db.transaction(async (tx) => {
            const [updated] = await tx
                .update(connections)
                .set({
                    status: 'cancelled',
                    updatedAt: new Date(),
                })
                .where(
                    and(
                        or(
                            eq(connections.id, connectionId),
                            eq(connections.addresseeId, connectionId)
                        ),
                        eq(connections.requesterId, user.id),
                        eq(connections.status, 'pending')
                    )
                )
                .returning({
                    id: connections.id,
                    requesterId: connections.requesterId,
                    addresseeId: connections.addresseeId,
                });

            if (updated) {
                return {
                    id: updated.id,
                    requesterId: updated.requesterId,
                    addresseeId: updated.addresseeId,
                    status: 'withdrawn' as const,
                };
            }

            const [existing] = await tx
                .select({
                    id: connections.id,
                    requesterId: connections.requesterId,
                    addresseeId: connections.addresseeId,
                    status: connections.status,
                })
                .from(connections)
                .where(
                    and(
                        or(
                            eq(connections.id, connectionId),
                            eq(connections.addresseeId, connectionId)
                        ),
                        eq(connections.requesterId, user.id)
                    )
                )
                .limit(1);

            if (!existing) return null;
            if (existing.status === 'cancelled') {
                return {
                    id: existing.id,
                    requesterId: existing.requesterId,
                    addresseeId: existing.addresseeId,
                    status: 'already_withdrawn' as const,
                };
            }
            return null;
        });

        if (!cancelled) {
            return { success: false, error: 'Request cannot be withdrawn or was already processed.' };
        }

        after(async () => {
            try {
                await Promise.allSettled([
                    clearConnectionRequestHold(cancelled.requesterId, cancelled.addresseeId),
                    invalidateDiscoverCacheForUsers([cancelled.requesterId, cancelled.addresseeId]),
                    queueCounterRefreshBestEffort([cancelled.addresseeId]),
                    revalidateConnectionsPaths(),
                ]);
            } catch (err) {
                logger.error('connections.cancel_background_failed', {
                    module: 'connections',
                    error: err instanceof Error ? err.message : String(err),
                    connectionId,
                });
            }
        });

        return {
            success: true,
            connectionId: cancelled.id,
            requesterId: cancelled.requesterId,
            addresseeId: cancelled.addresseeId,
            status: cancelled.status,
        };
    } catch (error) {
        console.error('Error cancelling request:', error);
        return { success: false, error: 'Couldn’t withdraw request' };
    }
}

// ============================================================================
// ACCEPT CONNECTION REQUEST (Addressee only)
// ============================================================================

// Accept a caller-supplied `idempotencyKey` so a double-clicked
// "Accept" button, a flaky network retry, or an offline queue flush never
// produces two acceptance events for the same pending request. The key is
// scoped to (user, connectionId) so a key cannot replay across different
// connections or across users.
export async function acceptConnectionRequest(
    connectionId: string,
    opts?: { idempotencyKey?: string }
): Promise<{ success: boolean; error?: string; requesterId?: string; addresseeId?: string }> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Sign in to continue' };
        const acceptRate = await consumeRateLimit(`connections-accept:${user.id}`, 60, 60);
        if (!acceptRate.allowed) {
            return { success: false, error: 'Too many actions. Wait and try again.' };
        }

        const { result } = await runIdempotent<{ success: boolean; error?: string; requesterId?: string; addresseeId?: string }>(
            {
                namespace: 'connections.accept',
                scopeId: `${user.id}:${connectionId}`,
                key: opts?.idempotencyKey,
            },
            async () => {
                const accepted = await db.transaction(async (tx) => {
                    // ponytail: sort profile IDs before locking to guarantee global canonical lock acquisition order. ceiling: 2 rows. upgrade: none needed.
                    const result = await tx.execute<{ requester_id: string; addressee_id: string }>(sql`
                        WITH updated_conn AS (
                            UPDATE connections
                            SET status = 'accepted', accepted_at = now(), updated_at = now()
                            WHERE id = ${connectionId}::uuid
                              AND addressee_id = ${user.id}::uuid
                              AND status = 'pending'
                            RETURNING requester_id, addressee_id
                        ),
                        canonical_profiles AS (
                            SELECT id FROM (
                                SELECT requester_id AS id FROM updated_conn
                                UNION
                                SELECT addressee_id AS id FROM updated_conn
                            ) p
                            ORDER BY id ASC
                            FOR UPDATE
                        )
                        UPDATE profiles
                        SET connections_count = GREATEST(0, connections_count + 1),
                            updated_at = now()
                        WHERE id IN (SELECT id FROM canonical_profiles)
                        RETURNING id
                    `);

                    const [existing] = await tx
                        .select({
                            requesterId: connections.requesterId,
                            addresseeId: connections.addresseeId,
                            status: connections.status,
                        })
                        .from(connections)
                        .where(and(eq(connections.id, connectionId), eq(connections.addresseeId, user.id)))
                        .limit(1);

                    if (!existing) return null;
                    if (existing.status === 'accepted') {
                        return {
                            requesterId: existing.requesterId,
                            addresseeId: existing.addresseeId,
                            changed: result.length > 0,
                        };
                    }
                    return null;
                });

                if (!accepted) {
                    return { success: false, error: 'Request not found' };
                }

                const acceptedRequesterId = accepted.requesterId;
                const acceptedAddresseeId = accepted.addresseeId;
                if (!acceptedRequesterId || !acceptedAddresseeId) {
                    return { success: false, error: 'Connection record is incomplete' };
                }

                // ponytail: Offload Redis pair mutations, Inngest sync, notifications, and path revalidations post-commit. ceiling: Sub-20ms P95 user latency. upgrade: bulk event emission pipeline.
                after(async () => {
                    try {
                        await Promise.allSettled([
                            clearConnectionRequestHold(acceptedRequesterId, acceptedAddresseeId),
                            invalidateDiscoverCacheForUsers([acceptedRequesterId, acceptedAddresseeId]),
                            revalidateConnectionsPaths(),
                            queueCounterRefreshBestEffort([acceptedRequesterId, acceptedAddresseeId]),
                            accepted.changed ? applyConnectionPairsToRedis([{ requesterId: acceptedRequesterId, addresseeId: acceptedAddresseeId }], 'add') : Promise.resolve(),
                            accepted.changed ? emitConnectionAcceptedNotification({
                                recipientUserId: acceptedRequesterId,
                                actorUserId: acceptedAddresseeId,
                                actorName: (user.user_metadata?.full_name as string | undefined) ?? (user.user_metadata?.username as string | undefined) ?? null,
                                actorAvatarUrl: (user.user_metadata?.avatar_url as string | undefined) ?? null,
                                connectionId,
                                eventKey: new Date().toISOString(),
                            }) : Promise.resolve(),
                            accepted.changed ? inngest.send([
                                { name: 'workspace/connections.sync_suggestions', data: { userId: acceptedRequesterId } },
                                { name: 'workspace/connections.sync_suggestions', data: { userId: acceptedAddresseeId } },
                            ]) : Promise.resolve(),
                        ]);
                    } catch (err) {
                        logger.error('connections.accept_background_failed', {
                            module: 'connections',
                            error: err instanceof Error ? err.message : String(err),
                            connectionId,
                        });
                    }
                });

                return { success: true, requesterId: acceptedRequesterId, addresseeId: acceptedAddresseeId };
            },
        );

        return result;
    } catch (error) {
        if (error instanceof IdempotencyConflictError) {
            return { success: false, error: 'Already working on it. Wait a moment.' };
        }
        console.error('Error accepting request:', error);
        return { success: false, error: 'Couldn’t accept request' };
    }
}

// ============================================================================
// REJECT CONNECTION REQUEST (Addressee only)
// ============================================================================

// Accept an optional idempotencyKey so rapid double-submits don't
// produce duplicate rejection rows. The scope includes the connectionId so
// two different connections can't share a replay window.
export async function rejectConnectionRequest(
    connectionId: string,
    reason?: string,
    opts?: { idempotencyKey?: string },
): Promise<{ success: boolean; error?: string; undoUntil?: string; serverNow?: string }> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Sign in to continue' };
        if (reason && !(CONNECTION_REJECTION_REASONS as readonly string[]).includes(reason)) {
            return { success: false, error: `Invalid rejection reason. Must be one of: ${CONNECTION_REJECTION_REASONS.join(', ')}` };
        }

        const rejectRate = await consumeRateLimit(`connections-reject:${user.id}`, 60, 60);
        if (!rejectRate.allowed) {
            return { success: false, error: 'Too many actions. Wait and try again.' };
        }

        const { result } = await runIdempotent<{
            success: boolean;
            error?: string;
            undoUntil?: string;
            serverNow?: string;
        }>(
            {
                namespace: 'connections.reject',
                scopeId: `${user.id}:${connectionId}`,
                key: opts?.idempotencyKey,
            },
            async () => {
                const rejected = await db.transaction(async (tx) => {
                    const [row] = await tx
                        .update(connections)
                        .set({
                            status: 'rejected',
                            rejectionReason: reason ?? null,
                            updatedAt: new Date(),
                        })
                        .where(
                            and(
                                eq(connections.id, connectionId),
                                eq(connections.addresseeId, user.id),
                                eq(connections.status, 'pending')
                            )
                        )
                        .returning({
                            id: connections.id,
                            requesterId: connections.requesterId,
                            addresseeId: connections.addresseeId,
                            updatedAt: connections.updatedAt,
                        });
                    return row;
                });

                if (!rejected) {
                    return { success: false, error: 'Request not found' };
                }

                after(async () => {
                    try {
                        await Promise.allSettled([
                            queueCounterRefreshBestEffort([rejected.addresseeId]),
                            invalidateDiscoverCacheForUsers([rejected.requesterId, rejected.addresseeId]),
                            revalidateConnectionsPaths(),
                        ]);
                    } catch (err) {
                        logger.error('connections.reject_background_failed', {
                            module: 'connections',
                            error: err instanceof Error ? err.message : String(err),
                            connectionId,
                        });
                    }
                });

                return {
                    success: true,
                    undoUntil: new Date(new Date(rejected.updatedAt).getTime() + 15_000).toISOString(),
                    serverNow: new Date().toISOString(),
                };
            },
        );

        return result;
    } catch (error) {
        if (error instanceof IdempotencyConflictError) {
            return { success: false, error: 'Already working on it. Wait a moment.' };
        }
        console.error('Error rejecting request:', error);
        return { success: false, error: 'Couldn’t decline request' };
    }
}

export async function undoRejectConnectionRequest(
    connectionId: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Sign in to continue' };
        const undoRate = await consumeRateLimit(`connections-undo-reject:${user.id}`, 60, 60);
        if (!undoRate.allowed) {
            return { success: false, error: 'Too many actions. Wait and try again.' };
        }

        const cutoff = new Date(Date.now() - 15_000);
        const [restored] = await db
            .update(connections)
            .set({
                status: 'pending',
                updatedAt: new Date(),
            })
            .where(
                and(
                    eq(connections.id, connectionId),
                    eq(connections.addresseeId, user.id),
                    eq(connections.status, 'rejected'),
                    sql`${connections.updatedAt} >= ${cutoff}`
                )
            )
            .returning({
                id: connections.id,
                requesterId: connections.requesterId,
                addresseeId: connections.addresseeId,
            });

        if (!restored) {
            return { success: false, error: 'Undo window expired' };
        }

        await queueCounterRefreshBestEffort([restored.addresseeId]);
        await invalidateDiscoverCacheForUsers([restored.requesterId, restored.addresseeId]);
        await revalidateConnectionsPaths();
        return { success: true };
    } catch (error) {
        console.error('Error undoing reject request:', error);
        return { success: false, error: 'Couldn’t undo decline' };
    }
}

// ============================================================================
// REMOVE CONNECTION (Either party can remove)
// ============================================================================

export async function removeConnection(
    connectionId: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Sign in to continue' };
        const removeRate = await consumeRateLimit(`connections-remove:${user.id}`, 60, 60);
        if (!removeRate.allowed) {
            return { success: false, error: 'Too many actions. Wait and try again.' };
        }

        const removed = await db.transaction(async (tx) => {
            // ponytail: canonical lock ordering on profile decrement eliminates 40P01 deadlocks. ceiling: 2 profiles. upgrade: none needed.
            await tx.execute(sql`
                WITH updated_conn AS (
                    UPDATE connections
                    SET status = 'disconnected', updated_at = now()
                    WHERE id = ${connectionId}::uuid
                      AND status = 'accepted'
                      AND (requester_id = ${user.id}::uuid OR addressee_id = ${user.id}::uuid)
                    RETURNING requester_id, addressee_id
                ),
                canonical_profiles AS (
                    SELECT id FROM (
                        SELECT requester_id AS id FROM updated_conn
                        UNION
                        SELECT addressee_id AS id FROM updated_conn
                    ) p
                    ORDER BY id ASC
                    FOR UPDATE
                )
                UPDATE profiles
                SET connections_count = GREATEST(0, connections_count - 1),
                    updated_at = now()
                WHERE id IN (SELECT id FROM canonical_profiles)
                RETURNING id
            `);

            const [existing] = await tx
                .select({
                    requesterId: connections.requesterId,
                    addresseeId: connections.addresseeId,
                    status: connections.status,
                })
                .from(connections)
                .where(
                    and(
                        eq(connections.id, connectionId),
                        or(eq(connections.requesterId, user.id), eq(connections.addresseeId, user.id))
                    )
                )
                .limit(1);

            if (!existing || existing.status !== 'disconnected') return null;
            return {
                requesterId: existing.requesterId,
                addresseeId: existing.addresseeId,
            };
        });

        if (!removed) {
            return { success: false, error: 'Connection not found' };
        }

        after(async () => {
            try {
                await Promise.allSettled([
                    clearConnectionRequestHold(removed.requesterId, removed.addresseeId),
                    invalidateDiscoverCacheForUsers([removed.requesterId, removed.addresseeId]),
                    applyConnectionPairsToRedis([removed], 'remove'),
                    revalidateConnectionsPaths(),
                    queueCounterRefreshBestEffort([removed.requesterId, removed.addresseeId]),
                    inngest.send([
                        { name: 'workspace/connections.sync_suggestions', data: { userId: removed.requesterId } },
                        { name: 'workspace/connections.sync_suggestions', data: { userId: removed.addresseeId } },
                    ]),
                ]);
            } catch (err) {
                logger.error('connections.remove_background_failed', {
                    module: 'connections',
                    error: err instanceof Error ? err.message : String(err),
                    connectionId,
                });
            }
        });

        return { success: true };
    } catch (error) {
        console.error('Error removing connection:', error);
        return { success: false, error: 'Couldn’t remove connection' };
    }
}

// ============================================================================
// GET ACCEPTED CONNECTIONS (Paginated)
// ============================================================================

export async function getAcceptedConnections(
    input: {
        limit?: number;
        cursor?: string; // cursor format: ISODate|connectionId
        search?: string;
        targetUserId?: string;
    } = {}
) {
    const {
        limit: rawLimit = 30,
        cursor,
        search,
        targetUserId,
    } = input;

    // C1: Clamp limit to prevent unbounded fetches
    const limit = Math.max(1, Math.min(rawLimit, 60));

    const user = await getAuthUser();
    const userIdToFetch = targetUserId || user?.id;

    if (!userIdToFetch) return { success: false as const, error: 'Sign in to continue', connections: [], hasMore: false, nextCursor: null, totalConnections: null };

    // C1: Rate limit to prevent enumeration
    if (user?.id) {
        const rate = await consumeRateLimit(`connections-accepted:${user.id}`, 60, 60);
        if (!rate.allowed) {
            return { success: false as const, error: 'Too many requests. Try again shortly.', connections: [], hasMore: false, nextCursor: null, totalConnections: null };
        }
    }

    if (!targetUserId || targetUserId === user?.id) {
        const feed = await getConnectionsFeed({
            tab: 'network',
            limit,
            cursor,
            search,
        });

        if (!feed.success) {
            return { success: false as const, error: feed.error, connections: [], hasMore: false, nextCursor: null, totalConnections: null };
        }

        return {
            success: true as const,
            totalConnections: feed.stats.totalConnections,
            connections: (feed.items as NetworkFeedItem[]).map((item) => ({
                id: item.id,
                requesterId: item.requesterId,
                addresseeId: item.addresseeId,
                status: item.status,
                createdAt: item.createdAt,
                updatedAt: item.updatedAt,
                otherUser: item.otherUser,
            })),
            hasMore: feed.hasMore,
            nextCursor: feed.nextCursor,
        };
    }

    // Another person's network: same rule as viewing their profile, blocks included (COR-029).
    const targetRelationship = await resolvePrivacyRelationship(user?.id ?? null, targetUserId);
    if (!targetRelationship?.canViewProfile) {
        return { success: false as const, error: 'This connection list is not available.', connections: [], hasMore: false, nextCursor: null, totalConnections: null };
    }

    const normalizedSearch = normalizeSearchQuery(search || '').toLowerCase();
    const searchPattern = normalizedSearch ? containsLikePattern(normalizedSearch) : undefined;
    const searchTokens = normalizedSearch ? tokenizeSearchQuery(normalizedSearch) : [];
    const [cursorDateRaw, cursorIdRaw] = cursor ? cursor.split('|') : [];
    const cursorDate = cursorDateRaw ? new Date(cursorDateRaw) : undefined;
    const cursorConnectionId = cursorIdRaw || undefined;

    const conditions = [
        eq(connections.status, 'accepted'),
        isNull(profiles.deletedAt),
        or(
            eq(connections.requesterId, userIdToFetch),
            eq(connections.addresseeId, userIdToFetch)
        ),
    ];

    if (searchPattern) conditions.push(buildProfileNameIlikeSearchCondition(searchTokens));

    if (cursorDate && cursorConnectionId) {
        conditions.push(buildConnectionDateCursorCondition({
            column: connections.updatedAt,
            isoValue: cursorDate.toISOString(),
            id: cursorConnectionId,
            direction: 'before',
        }));
    } else if (cursorDate) {
        conditions.push(buildConnectionDateCursorCondition({
            column: connections.updatedAt,
            isoValue: cursorDate.toISOString(),
            direction: 'before',
        }));
    }

    // Join only the opposite party profile to avoid self-rows and simplify filtering.
    const results = await db
        .select({
            // Connection
            id: connections.id,
            requesterId: connections.requesterId,
            addresseeId: connections.addresseeId,
            status: connections.status,
            createdAt: connections.createdAt,
            updatedAt: connections.updatedAt,
            // Profile (Other User)
            profileId: profiles.id,
            username: profiles.username,
            fullName: profiles.fullName,
            avatarUrl: profiles.avatarUrl,
            headline: profiles.headline,
        })
        .from(connections)
        .innerJoin(
            profiles,
            or(
                and(
                    eq(connections.requesterId, userIdToFetch),
                    eq(connections.addresseeId, profiles.id)
                ),
                and(
                    eq(connections.addresseeId, userIdToFetch),
                    eq(connections.requesterId, profiles.id)
                )
            )
        )
        .where(and(...conditions))
        .orderBy(desc(connections.updatedAt), desc(connections.id))
        .limit(limit + 1);

    const hasMore = results.length > limit;
    const connectionList = results.slice(0, limit);

    const nextCursor = hasMore && connectionList.length > 0
        ? `${connectionList[connectionList.length - 1]!.updatedAt.toISOString()}|${connectionList[connectionList.length - 1]!.id}`
        : null;

    // Each listed person is projected for this viewer (blocked people lose their identity).
    const listedRelationships = await resolvePrivacyRelationships(user?.id ?? null, connectionList.map((row) => row.profileId));
    const enrichedConnections = connectionList.map(row => {
        const scoped = buildViewerScopedProfileView({
            profile: { id: row.profileId, username: row.username, fullName: row.fullName, avatarUrl: row.avatarUrl, headline: row.headline },
            relationship: listedRelationships.get(row.profileId) ?? null,
            isOwner: false,
        });
        return {
            id: row.id,
            requesterId: row.requesterId,
            addresseeId: row.addresseeId,
            status: row.status as typeof connections.$inferSelect.status,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            otherUser: {
                id: row.profileId,
                username: scoped?.username ?? null,
                fullName: scoped?.fullName ?? null,
                avatarUrl: scoped?.avatarUrl ?? null,
                headline: scoped?.headline ?? null,
            }
        };
    });

    const stats = await getConnectionStatsForUser(userIdToFetch);
    return { success: true as const, connections: enrichedConnections, hasMore, nextCursor, totalConnections: stats.totalConnections };
}
// ============================================================================
// CHECK CONNECTION STATUS
// ============================================================================

// ============================================================================
// CHECK CONNECTION STATUS
// ============================================================================

export async function checkConnectionStatus(
    otherUserId: string
): Promise<{
    success: boolean;
    status?: 'none' | 'pending_sent' | 'pending_received' | 'connected' | 'blocked' | 'open';
    connectionId?: string;
    isIncomingRequest?: boolean;
    isPendingSent?: boolean;
    hasActiveApplication?: boolean;
    isApplicant?: boolean;
    isCreator?: boolean;
    activeApplicationId?: string;
    activeApplicationStatus?: 'pending' | 'accepted' | 'rejected' | 'project_deleted';
    activeProjectId?: string;
    error?: string;
}> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Sign in to continue' };

        // C2: Rate limit to prevent relationship enumeration
        const rate = await consumeRateLimit(`connections-status:${user.id}`, 120, 60);
        if (!rate.allowed) {
            return { success: false, error: 'Too many requests. Wait and try again.' };
        }

        const [privacy, activeApplications] = await Promise.all([
            resolvePrivacyRelationship(user.id, otherUserId),
            db
                .select({
                    id: roleApplications.id,
                    applicantId: roleApplications.applicantId,
                    status: roleApplications.status,
                    projectId: roleApplications.projectId,
                    updatedAt: roleApplications.updatedAt,
                })
                .from(roleApplications)
                .where(
                    // The two people are an applicant and one of the project's reviewers (its owner or an admin).
                    or(
                        and(eq(roleApplications.applicantId, user.id), canReviewProjectSql(otherUserId, sql`${roleApplications.projectId}`)),
                        and(eq(roleApplications.applicantId, otherUserId), canReviewProjectSql(user.id, sql`${roleApplications.projectId}`))
                    )
                )
                .orderBy(desc(roleApplications.updatedAt), desc(roleApplications.id))
                .limit(1)
        ]);
        const activeApp = activeApplications[0];
        if (!privacy) {
            return { success: false, error: 'User not found' };
        }

        // RULE: If there is an active application, the gate is OPEN
        // A block always wins: an application never opens a conversation between two people who blocked each other.
        if (activeApp && !(privacy.blockedByViewer || privacy.blockedByTarget)) {
            const appStatus = activeApp.status as 'pending' | 'accepted' | 'rejected' | 'project_deleted';
            const isPending = appStatus === 'pending';
            const updatedAtMs = new Date(activeApp.updatedAt).getTime();
            const isFreshTerminal =
                Number.isFinite(updatedAtMs) &&
                Date.now() - updatedAtMs <= CONNECTION_BANNER_HIDE_AFTER_MS;

            // Only override the standard status with the application gate if it is tangibly active or fresh.
            if (isPending || isFreshTerminal) {
                return {
                    success: true,
                    status: 'open', // Allows messaging system to operate
                    connectionId: privacy.latestConnectionId ?? undefined,
                    hasActiveApplication: true,
                    activeApplicationId: activeApp.id,
                    activeApplicationStatus: appStatus,
                    activeProjectId: activeApp.projectId, // Mapped correctly by Drizzle
                    isApplicant: activeApp.applicantId === user.id,
                    isCreator: activeApp.applicantId !== user.id,
                    // PURE OPTIMIZATION: Crucially append connection booleans so profile UI doesn't visually drop existing connection requests!
                    isIncomingRequest: privacy.connectionState === 'pending_incoming',
                    isPendingSent: privacy.connectionState === 'pending_outgoing'
                };
            }
        }

        if (privacy.blockedByViewer || privacy.blockedByTarget) {
            return { success: true, status: 'blocked', connectionId: privacy.latestConnectionId ?? undefined };
        }

        if (privacy.connectionState === 'connected') {
            return { success: true, status: 'connected', connectionId: privacy.latestConnectionId ?? undefined };
        }

        if (privacy.connectionState === 'pending_outgoing') {
            if (privacy.canSendMessage) {
                return {
                    success: true,
                    status: 'open',
                    connectionId: privacy.latestConnectionId ?? undefined,
                    isPendingSent: true,
                };
            }
            return { success: true, status: 'pending_sent', connectionId: privacy.latestConnectionId ?? undefined };
        }

        if (privacy.connectionState === 'pending_incoming') {
            return {
                success: true,
                status: 'open',
                connectionId: privacy.latestConnectionId ?? undefined,
                isIncomingRequest: true,
            };
        }

        if (privacy.canSendMessage) {
            return { success: true, status: 'open' };
        }

        return { success: true, status: 'none' };
    } catch (error) {
        console.error('Error checking connection status:', error);
        return { success: false, error: 'Couldn’t check connection status' };
    }
}

export async function withdrawAllSentConnectionRequests(): Promise<{ success: boolean; count?: number; error?: string }> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Sign in to continue' };

        const withdrawRate = await consumeRateLimit(`connections-withdraw-all:${user.id}`, 6, 60);
        if (!withdrawRate.allowed) {
            return { success: false, error: 'Too many bulk actions. Wait and try again.' };
        }

        const withdrawn = await db
            .update(connections)
            .set({
                status: 'cancelled',
                updatedAt: new Date(),
            })
            .where(
                and(
                    eq(connections.requesterId, user.id),
                    eq(connections.status, 'pending')
                )
            )
            .returning({
                requesterId: connections.requesterId,
                addresseeId: connections.addresseeId,
            });

        if (withdrawn.length > 0) {
            await Promise.allSettled(
                withdrawn.map((row) => clearConnectionRequestHold(row.requesterId, row.addresseeId)),
            );

            const affectedUserIds = new Set<string>([user.id]);
            for (const row of withdrawn) {
                affectedUserIds.add(row.addresseeId);
            }

            await queueCounterRefreshBestEffort([...affectedUserIds]);
            await invalidateDiscoverCacheForUsers(affectedUserIds);
            await revalidateConnectionsPaths();
        }

        return { success: true, count: withdrawn.length };
    } catch (error) {
        console.error('connections.withdraw_all_sent_failed', { error });
        return { success: false, error: 'Couldn’t withdraw requests' };
    }
}

export async function getProfileConnectionCountAction(profileId: string) {
    if (!isLooseUuid(profileId)) {
        return { success: false as const, error: 'Invalid profile' };
    }
    const viewer = await getAuthUser();
    const relationship = await resolvePrivacyRelationship(viewer?.id ?? null, profileId);
    if (!relationship?.canViewProfile) return { success: false as const, error: 'Profile unavailable' };
    const rate = await consumeRateLimit(`profile:connection-count:${viewer?.id ?? profileId}`, 60, 60);
    if (!rate.allowed) return { success: false as const, error: 'Too many attempts. Try again in a minute.' };
    const stats = await getConnectionStatsForUser(profileId);
    return { success: true as const, connectionsCount: stats.totalConnections };
}

/** On-demand identities: a count in a feed never authorizes reading the people behind it. */
export async function readPersonSharedConnectionsAction(input: { targetId: string; offset?: number }) {
    const parsed = z.object({ targetId: z.string().uuid(), offset: z.number().int().min(0).max(10000).optional() }).safeParse(input);
    const user = await getAuthUser();
    if (!user || !parsed.success || parsed.data.targetId === user.id) return { success: false as const, error: 'Mutual connections are unavailable.' };
    try {
        const rate = await consumeRateLimit(`person-shared:${user.id}`, 60, 60);
        if (!rate.allowed) return { success: false as const, error: 'Wait before trying again.' };
        const relationship = await resolvePrivacyRelationship(user.id, parsed.data.targetId);
        if (!relationship?.canViewProfile) return { success: false as const, error: 'This profile is no longer available.' };
        const summary = await readSharedConnections(user.id, [parsed.data.targetId], { limit: 20, offset: parsed.data.offset });
        if (parsed.data.offset && !summary.people.length) return { success: false as const, error: 'Mutual connections changed. Retry to reload the list.' };
        const stillPermitted = await resolvePrivacyRelationship(user.id, parsed.data.targetId);
        if (!stillPermitted?.canViewProfile) return { success: false as const, error: 'This profile is no longer available.' };
        return { success: true as const, summary };
    } catch (error) {
        logger.warn('connections.shared_people_failed', { error: error instanceof Error ? error.message : String(error) });
        return { success: false as const, error: 'Couldn’t load mutual connections. Try again.' };
    }
}

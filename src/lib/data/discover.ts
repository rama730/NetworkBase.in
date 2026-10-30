import { and, asc, desc, eq, ilike, inArray, isNull, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import { canonicalSkillKey } from '@/lib/skills/matching';
import { normalizeSkillLookup } from '@/lib/skills/normalization';
import { FILTER_VIEWS, SORT_OPTIONS, type FilterView } from '@/constants/discover';
import { db } from '@/lib/db';
import { connections, profiles, workspaceFollows, workspaceMembers, workspaceOpenRoles, workspaces, roleApplications } from '@/lib/db/schema';
import { recordDiscoverMetric } from '@/lib/discover/observability';
import { DISCOVER_RANKING_SCHEMA_VERSION, DISCOVER_RANKING_WEIGHTS } from '@/lib/discover/ranking-config';
import { buildDiscoverSnapshotKey } from '@/lib/discover/snapshot-cache';
import { logger } from '@/lib/logger';
import { cacheData, getCachedData } from '@/lib/redis';
import { buildWorkspaceOwnerPresentation } from '@/lib/privacy/presentation';
import { resolvePrivacyRelationships } from '@/lib/privacy/resolver';
import { getWorkspaceMemberRoleLabel } from '@/lib/workspaces/settings-policies';
import { filterWorkspaceLinksForAudience } from '@/lib/workspaces/social-links';
import { DiscoverFilters, Workspace } from '@/types/discover';
import { showKeeps } from '@/lib/organizations/profile-rules';
import { orgTypeLabel } from '@/lib/organizations/config';
import { countCanonicalSkillMatches } from '@/lib/skills/matching';
import { containsLikePattern, escapeLikePattern, normalizeSearchQuery, tokenizeSearchQuery } from '@/lib/search/query';

export const DEFAULT_FILTERS: DiscoverFilters = {
    status: 'all',
    type: 'all',
    tech: [],
    sort: SORT_OPTIONS.NEWEST,
    search: undefined,
};

interface DiscoverQueryOptions {
    view?: FilterView;
    viewerId?: string | null;
    surface?: 'full' | 'preview';
}

// Cursors carry the exact sort key: created_at with microseconds (as Postgres stores it), the score as
// JS prints it (round-trips a float8), and the "now" the first page ranked with, so every page of a
// ranked feed scores the same way and a page edge never repeats or skips a row.
type ParsedCursor =
    | { kind: 'score'; fingerprint: string; score: number; createdAt: string; id: string; now: number }
    | { kind: 'time'; fingerprint: string; createdAt: string; id: string }
    | { kind: 'snapshot'; fingerprint: string; now: number; id: string; index: number | null }
    | null;

/** A ranked list moved on under its cursor (snapshot expired and the project left it): start it again. */
export class StaleDiscoverFeedError extends Error {
    constructor() {
        super('This list changed since you opened it');
        this.name = 'StaleDiscoverFeedError';
    }
}

export class InvalidDiscoverCursorError extends Error {
    constructor() {
        super('Invalid workspace search cursor');
        this.name = 'InvalidDiscoverCursorError';
    }
}

type RawProjectRow = {
    id: string;
    ownerId: string;
    title: string;
    slug: string | null;
    description: string | null;
    shortDescription: string | null;
    coverImage: string | null;
    category: string | null;
    viewCount: number | null;
    followersCount: number | null;

    tags: string[] | null;
    skills: string[] | null;
    visibility: string | null;
    status: string | null;
    lifecycleStages: string[] | null;
    /** import_source.metadata.leadFocus, the only part a card reads. */
    leadFocus: string | null;
    externalLinks: import('@/lib/profile/normalization').SocialLinkStorage | null;
    githubRepoUrl: string | null;
    kind: 'workspace' | 'organization';
    orgType: string | null;
    /** Other's own label and "Part of" for the org card (report §34.11). */
    orgCard: { typeLabel?: string | null; partOf?: string | null } | null;
    parentId: string | null;
    createdAt: Date;
    /** created_at as text with microseconds, for cursors. */
    cursorAt: string;
    updatedAt: Date;
    feedScore: number | null;
};

type CandidateProject = {
    id: string;
    ownerId: string;
    title: string;
    description: string | null;
    shortDescription: string | null;
    category: string | null;
    skills: string[] | null;
    tags: string[] | null;
    coverImage: string | null;
    lifecycleStages: string[] | null;
    viewCount: number | null;
    followersCount: number | null;
    updatedAt: Date;
    createdAt: Date;
};

type SnapshotItem = {
    id: string;
    score: number;
    reasons: string[];
};

type SnapshotPayload = {
    items: SnapshotItem[];
};

const MAX_PERSONALIZATION_TERMS = 8;
const MAX_TECH_TERMS = 8;
const MAX_SEARCH_TOKENS = 8;

const normalizeTerm = (value: string) =>
    normalizeSearchQuery(value)
        .toLowerCase()
        .replace(/[^\p{L}\p{N}+.#\-\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();

const likePattern = containsLikePattern;

const dedupeTerms = (values: Array<string | null | undefined>, max = MAX_PERSONALIZATION_TERMS) => {
    const unique = new Set<string>();
    for (const rawValue of values) {
        if (!rawValue) continue;
        const normalized = normalizeTerm(rawValue);
        if (!normalized || normalized.length < 2) continue;
        unique.add(normalized);
        if (unique.size >= max) break;
    }
    return Array.from(unique);
};

const isTimestamp = (value: string | undefined): value is string => Boolean(value) && Number.isFinite(Date.parse(value!));
const isUuidLike = (value: string | undefined): value is string => Boolean(value) && /^[0-9a-f-]{36}$/i.test(value!);

// A cursor's "now" comes from a first page loaded within the last day; anything else is forged.
const isRecent = (now: number) => Number.isFinite(now) && Math.abs(now - Date.now()) < 24 * 60 * 60 * 1000;

const parseDiscoverCursor = (cursor?: string): ParsedCursor => {
    if (!cursor) return null;
    const [prefix, rest = ''] = [cursor.slice(0, 2), cursor.slice(2)];
    const parts = rest.split('|');

    if (prefix === 's:') {
        const [fingerprint, scoreRaw, createdAt, id, nowRaw, extra] = parts;
        const score = Number(scoreRaw);
        const now = Number(nowRaw);
        if (fingerprint && Number.isFinite(score) && isTimestamp(createdAt) && isUuidLike(id) && isRecent(now) && extra === undefined) {
            return { kind: 'score', fingerprint, score, createdAt, id, now };
        }
    } else if (prefix === 'h:') {
        const [fingerprint, nowRaw, id, indexRaw, extra] = parts;
        const now = Number(nowRaw);
        const index = indexRaw === undefined ? null : Number(indexRaw);
        if (fingerprint && isRecent(now) && isUuidLike(id) && (index === null || (Number.isInteger(index) && index >= 0)) && extra === undefined) {
            return { kind: 'snapshot', fingerprint, now, id, index };
        }
    } else if (prefix === 't:') {
        const [fingerprint, createdAt, id, extra] = parts;
        if (fingerprint && isTimestamp(createdAt) && isUuidLike(id) && extra === undefined) {
            return { kind: 'time', fingerprint, createdAt, id };
        }
    }
    throw new InvalidDiscoverCursorError();
};

const buildTimeCursor = (fingerprint: string, cursorAt: string, id: string) => `t:${fingerprint}|${cursorAt}|${id}`;
// The position rides along: if the project at the cursor left the list, the next page starts there anyway.
const buildSnapshotCursor = (fingerprint: string, now: number, id: string, index: number) => `h:${fingerprint}|${now}|${id}|${index}`;
const buildScoreCursor = (fingerprint: string, score: number, cursorAt: string, id: string, now: number) =>
    `s:${fingerprint}|${Number.isFinite(score) ? String(score) : '0'}|${cursorAt}|${id}|${now}`;

/** created_at as UTC text with microseconds: a cursor built from it compares exactly. */
const cursorAtSql = sql<string>`to_char(${workspaces.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/** The trending score at a fixed moment (the first page's), so later pages rank the same way. */
const trendingScoreSql = (nowMs: number) => {
    const weights = DISCOVER_RANKING_WEIGHTS;
    const now = new Date(nowMs).toISOString();
    return sql<number>`(
        (ln(1 + greatest(coalesce(${workspaces.viewCount}, 0), 0)) * ${weights.trending.views}) +
        (ln(1 + greatest(coalesce(${workspaces.followersCount}, 0), 0)) * ${weights.trending.follows}) +
        (greatest(0, 72 - (extract(epoch from (${now}::timestamptz - ${workspaces.updatedAt})) / 3600.0)) * ${weights.trending.recency})
    )`;
};

const getViewerPersonalizationTerms = async (viewerId: string | null | undefined): Promise<string[]> => {
    if (!viewerId) return [];

    const [viewerProfile, followedProjects] = await Promise.all([
        db
            .select({
                skills: profiles.skills,
                interests: profiles.interests,
            })
            .from(profiles)
            .where(eq(profiles.id, viewerId))
            .limit(1),
        db
            .select({
                category: workspaces.category,
                skills: workspaces.skills,
                tags: workspaces.tags,
            })
            .from(workspaceFollows)
            .innerJoin(workspaces, eq(workspaceFollows.projectId, workspaces.id))
            .where(eq(workspaceFollows.userId, viewerId))
            .orderBy(desc(workspaceFollows.createdAt))
            .limit(20)
            .catch(() => []),
    ]);

    const [profile] = viewerProfile;
    const values: string[] = [];

    for (const skill of profile?.skills ?? []) values.push(skill);
    for (const interest of profile?.interests ?? []) values.push(interest);

    for (const followed of followedProjects) {
        if (followed.category) values.push(followed.category);
        for (const skill of followed.skills ?? []) values.push(skill);
        for (const tag of followed.tags ?? []) values.push(tag);
    }

    return dedupeTerms(values, MAX_PERSONALIZATION_TERMS);
};

const buildTermMatchConditions = (terms: string[]) => terms.map((term) => {
        const pattern = likePattern(term);
        return or(
            ilike(workspaces.title, pattern),
            ilike(workspaces.description, pattern),
            sql<boolean>`EXISTS (SELECT 1 FROM workspace_skills ps JOIN skills s ON ps.skill_id = s.id WHERE ps.workspace_id = ${workspaces.id} AND s.name ILIKE ${pattern})`,
            sql<boolean>`EXISTS (SELECT 1 FROM workspace_tags pt JOIN tags t ON pt.tag_id = t.id WHERE pt.workspace_id = ${workspaces.id} AND t.name ILIKE ${pattern})`,
            sql<boolean>`lower(coalesce(${workspaces.category}, '')) LIKE ${pattern}`,
            // An org's @handle (report §24.3).
            ilike(workspaces.slug, pattern),
        )!;
    });

const buildSearchRelevanceExpr = (terms: string[]) => {
    if (terms.length === 0) return sql<number>`0`;
    return sql<number>`(${sql.join(terms.map((term) => {
        const contains = likePattern(term);
        const prefix = `${escapeLikePattern(term)}%`;
        return sql<number>`(
            CASE
                WHEN ${workspaces.title} ILIKE ${term} THEN 100
                WHEN ${workspaces.title} ILIKE ${prefix} THEN 80
                WHEN ${workspaces.title} ILIKE ${contains} THEN 50
                ELSE 0
            END
            + CASE WHEN EXISTS (
                SELECT 1 FROM workspace_skills ps
                JOIN skills s ON ps.skill_id = s.id
                LEFT JOIN skill_aliases sa ON sa.skill_id = s.id
                WHERE ps.workspace_id = ${workspaces.id}
                  AND (s.name ILIKE ${term} OR sa.normalized_alias ILIKE ${term})
            ) THEN 70 ELSE 0 END
            + CASE WHEN EXISTS (
                SELECT 1 FROM workspace_tags pt JOIN tags t ON pt.tag_id = t.id
                WHERE pt.workspace_id = ${workspaces.id} AND t.name ILIKE ${term}
            ) THEN 60 ELSE 0 END
            + CASE WHEN ${workspaces.category} ILIKE ${term} THEN 55 ELSE 0 END
            + CASE WHEN ${workspaces.description} ILIKE ${contains} THEN 20 ELSE 0 END
        )`;
    }), sql` + `)})`;
};

const buildRecommendationRelevanceExpr = (terms: string[]) => {
    const weights = DISCOVER_RANKING_WEIGHTS;

    if (terms.length === 0) {
        return sql<number>`0`;
    }

    const clauses = terms.map((term) => {
        const pattern = likePattern(term);
        return sql<number>`(
            CASE WHEN lower(coalesce(${workspaces.title}, '')) LIKE ${pattern} THEN ${weights.recommendation.titleMatch} ELSE 0 END +
            CASE WHEN lower(coalesce(${workspaces.description}, '')) LIKE ${pattern} THEN ${weights.recommendation.descriptionMatch} ELSE 0 END +
            CASE WHEN EXISTS (
                SELECT 1
                FROM workspace_skills ps
                JOIN skills s ON ps.skill_id = s.id
                LEFT JOIN skill_aliases sa ON sa.skill_id = s.id
                WHERE ps.workspace_id = ${workspaces.id}
                  AND (s.name ILIKE ${pattern} OR sa.normalized_alias ILIKE ${pattern})
            ) THEN ${weights.recommendation.skillsMatch} ELSE 0 END +
            CASE WHEN EXISTS (SELECT 1 FROM workspace_tags pt JOIN tags t ON pt.tag_id = t.id WHERE pt.workspace_id = ${workspaces.id} AND t.name ILIKE ${pattern}) THEN ${weights.recommendation.tagsMatch} ELSE 0 END +
            CASE WHEN lower(coalesce(${workspaces.category}, '')) LIKE ${pattern} THEN ${weights.recommendation.categoryMatch} ELSE 0 END
        )`;
    });

    return sql<number>`(${sql.join(clauses, sql` + `)})`;
};

/** One condition per search word, each matched against a project's title, description, skills, tags and category. */
export const buildSearchConditions = (search: string | undefined): SQL<unknown>[] => {
    if (!search) return [];
    const normalizedSearchTerms = dedupeTerms(tokenizeSearchQuery(search), MAX_SEARCH_TOKENS);
    const fallback = normalizeTerm(search);
    return buildTermMatchConditions(normalizedSearchTerms.length > 0 ? normalizedSearchTerms : fallback ? [fallback] : []);
};

/** Which projects Discover may show this viewer, and the status, type, skill and Following filters. Shared by the card feed and the update feed. */
export const buildBaseConditions = (
    filters: DiscoverFilters,
    view: FilterView,
    viewerId: string | null,
    /** Following an org also lists its public child projects; its children's posts stay out (report §24.10 #12). */
    options: { followedOrgChildren?: boolean } = {},
): SQL<unknown>[] => {
    const conditions: SQL<unknown>[] = [
        // CRITICAL: Always exclude soft-deleted projects from every hub query
        // Literal values, written exactly like the 0195 partial indexes' predicate, so the planner uses them.
        sql<boolean>`${workspaces.deletedAt} IS NULL AND ${workspaces.visibility} IN ('public', 'unlisted') AND ${workspaces.status} <> 'draft'`,
        // A deleted account's projects leave Discover with it.
        sql<boolean>`EXISTS (SELECT 1 FROM ${profiles} owner WHERE owner.id = ${workspaces.ownerId} AND owner.deleted_at IS NULL)`,
        // Decision 160: a new org reaches Discover after 3+ members and 7+ days, or once verified (profile-rules.ts).
        sql<boolean>`(${workspaces.kind} <> 'organization' OR ${workspaces.verifiedAt} IS NOT NULL OR (
            ${workspaces.createdAt} <= now() - interval '7 days'
            AND (SELECT count(*) FROM workspace_members m WHERE m.workspace_id = ${workspaces.id}) >= 3
        ))`,
        // Report §30.3, §30.5: hidden by a platform admin, suspended or deleting projects and orgs (and the child
        // projects of a suspended or deleting org) leave Discover and search; an archived org leaves the feed.
        sql<boolean>`${workspaces.discoverHiddenAt} IS NULL AND ${workspaces.suspendedAt} IS NULL AND ${workspaces.deletionScheduledAt} IS NULL
            AND NOT (${workspaces.kind} = 'organization' AND ${workspaces.status} = 'archived')
            AND (${workspaces.parentId} IS NULL OR NOT EXISTS (SELECT 1 FROM workspaces o WHERE o.id = ${workspaces.parentId}
                AND (o.suspended_at IS NOT NULL OR o.deletion_scheduled_at IS NOT NULL)))`,
    ];
    const show = showKeeps(filters.show ?? 'all');
    if (show.projectKind) conditions.push(eq(workspaces.kind, show.projectKind as 'workspace' | 'organization'));
    if (filters.org) {
        // "Show everything from CSE-3A": the org itself and its public child projects.
        conditions.push(sql<boolean>`(${workspaces.slug} = ${filters.org} AND ${workspaces.kind} = 'organization'
            OR ${workspaces.parentId} = (SELECT o.id FROM workspaces o WHERE o.slug = ${filters.org} AND o.kind = 'organization' AND o.deleted_at IS NULL LIMIT 1))`);
    }

    // Neither side of a block sees the other's projects.
    if (viewerId) {
        conditions.push(sql<boolean>`NOT app_private.blocked_between(${viewerId}, ${workspaces.ownerId})`);
    }

    if (view === FILTER_VIEWS.FOLLOWING && viewerId) {
        const followed = db
            .select({ projectId: workspaceFollows.projectId })
            .from(workspaceFollows)
            .where(eq(workspaceFollows.userId, viewerId));
        // Following an org adds its public child projects (report §24.3); the public rules above still apply.
        conditions.push(options.followedOrgChildren === false
            ? inArray(workspaces.id, followed)
            : or(inArray(workspaces.id, followed), inArray(workspaces.parentId, followed))!);
    }

    if (filters.status && filters.status !== 'all') {
        conditions.push(eq(workspaces.status, filters.status as 'active' | 'completed' | 'archived'));
    }

    if (filters.type && filters.type !== 'all') {
        conditions.push(eq(workspaces.category, filters.type));
    }

    conditions.push(...buildSearchConditions(filters.search));

    // Skills match by identity, not substring ("java" isn't "javascript"; "C" and "R" count):
    // the catalog key, the skill's own name, or one of its aliases.
    const selectedTech = Array.from(new Set((filters.tech ?? []).map((value) => value.trim()).filter(Boolean))).slice(0, MAX_TECH_TERMS);
    if (selectedTech.length > 0) {
        const keys = selectedTech.map(canonicalSkillKey);
        const lookups = selectedTech.map(normalizeSkillLookup);
        const names = selectedTech.map((value) => value.toLowerCase());
        const textArray = (values: string[]) => sql`ARRAY[${sql.join(values.map((value) => sql`${value}`), sql`, `)}]::text[]`;
        conditions.push(sql<boolean>`EXISTS (
            SELECT 1 FROM workspace_skills ps
            JOIN skills s ON ps.skill_id = s.id
            LEFT JOIN skill_aliases sa ON sa.skill_id = s.id
            WHERE ps.workspace_id = ${workspaces.id}
              AND (s.canonical_key = ANY(${textArray(keys)}) OR lower(s.name) = ANY(${textArray(names)}) OR sa.normalized_alias = ANY(${textArray(lookups)}))
        )`);
    }

    return conditions;
};

const countTextMatches = (value: string, terms: string[]) => {
    if (!value || terms.length === 0) return 0;
    let count = 0;
    const normalized = normalizeTerm(value);
    for (const term of terms) {
        if (normalized.includes(term)) count += 1;
    }
    return count;
};

const countArrayMatches = (values: string[] | null, terms: string[]) => {
    if (!values || terms.length === 0) return 0;
    const canonicalMatches = countCanonicalSkillMatches(values, terms);
    const normalized = values.map((item) => normalizeTerm(item)).filter(Boolean);
    let count = canonicalMatches;
    for (const term of terms) {
        const canonical = countCanonicalSkillMatches(values, [term]) > 0;
        if (!canonical && normalized.some((item) => item.includes(term))) count += 1;
    }
    return count;
};

const calculateTrendScore = (candidate: CandidateProject, now: number) => {
    const weights = DISCOVER_RANKING_WEIGHTS;
    const views = Math.max(0, candidate.viewCount || 0);
    const follows = Math.max(0, candidate.followersCount || 0);
    const hoursSinceUpdate = Math.max(0, (now - candidate.updatedAt.getTime()) / (1000 * 60 * 60));
    const recency = Math.max(0, 72 - hoursSinceUpdate);

    return (
        Math.log1p(views) * weights.trending.views +
        Math.log1p(follows) * weights.trending.follows +
        recency * weights.trending.recency
    );
};

const calculateQualityScore = (candidate: CandidateProject) => {
    const weights = DISCOVER_RANKING_WEIGHTS;
    const tagsScore = Math.min(1, (candidate.tags?.length || 0) / 6);
    const skillsScore = Math.min(1, (candidate.skills?.length || 0) / 6);
    const lifecycleScore = Math.min(1, (candidate.lifecycleStages?.length || 0) / 5);

    return (
        (candidate.shortDescription ? 1 : 0) * weights.quality.shortDescription +
        (candidate.coverImage ? 1 : 0) * weights.quality.coverImage +
        tagsScore * weights.quality.tags +
        skillsScore * weights.quality.skills +
        lifecycleScore * weights.quality.lifecycle
    );
};

const calculateRecommendationScore = (candidate: CandidateProject, terms: string[], now: number) => {
    const weights = DISCOVER_RANKING_WEIGHTS;
    const trendScore = calculateTrendScore(candidate, now);
    const qualityScore = calculateQualityScore(candidate);

    if (terms.length === 0) {
        return {
            score: trendScore * weights.recommendation.coldStartBlend + qualityScore,
            matchedTerms: 0,
        };
    }

    const titleMatches = countTextMatches(candidate.title, terms);
    const descriptionMatches = countTextMatches(candidate.description || '', terms);
    const skillsMatches = countArrayMatches(candidate.skills, terms);
    const tagsMatches = countArrayMatches(candidate.tags, terms);
    const categoryMatches = countTextMatches(candidate.category || '', terms);

    const relevance =
        titleMatches * weights.recommendation.titleMatch +
        descriptionMatches * weights.recommendation.descriptionMatch +
        skillsMatches * weights.recommendation.skillsMatch +
        tagsMatches * weights.recommendation.tagsMatch +
        categoryMatches * weights.recommendation.categoryMatch;

    return {
        score: relevance + trendScore * weights.recommendation.trendBlend + qualityScore,
        matchedTerms: titleMatches + descriptionMatches + skillsMatches + tagsMatches + categoryMatches,
    };
};

const applyDiversityRerank = (
    entries: Array<{ id: string; score: number; ownerId: string; category: string | null; reasons: string[] }>,
) => {
    const weights = DISCOVER_RANKING_WEIGHTS;
    const remaining = [...entries].sort((a, b) => b.score - a.score);
    const reranked: typeof entries = [];
    let lastOwnerId: string | null = null;
    let lastCategory: string | null = null;

    while (remaining.length > 0) {
        let bestIndex = 0;
        let bestAdjusted = Number.NEGATIVE_INFINITY;

        for (let index = 0; index < remaining.length; index += 1) {
            const item = remaining[index];
            if (!item) continue;
            let adjusted = item.score;

            if (lastOwnerId && item.ownerId === lastOwnerId) {
                adjusted -= weights.diversity.ownerPenalty;
            }
            if (lastCategory && item.category && item.category === lastCategory) {
                adjusted -= weights.diversity.categoryPenalty;
            }

            if (adjusted > bestAdjusted) {
                bestAdjusted = adjusted;
                bestIndex = index;
            }
        }

        const [chosen] = remaining.splice(bestIndex, 1);
        if (!chosen) break;

        reranked.push(chosen);
        lastOwnerId = chosen.ownerId;
        lastCategory = chosen.category;
    }

    return reranked;
};

const buildReasonLabels = (input: {
    view: FilterView;
    matchedTerms: number;
    trendScore: number;
    qualityScore: number;
    updatedAt: Date;
    now: number;
}) => {
    const reasons: string[] = [];
    const ageHours = (input.now - input.updatedAt.getTime()) / (1000 * 60 * 60);

    if (input.view === FILTER_VIEWS.RECOMMENDATIONS && input.matchedTerms > 0) {
        reasons.push('Matches your skills');
    }

    if (input.trendScore >= 3.5) {
        reasons.push('Trending now');
    }

    if (ageHours <= 48) {
        reasons.push('Recently active');
    }

    if (input.qualityScore >= 0.55) {
        reasons.push('Well documented');
    }

    if (reasons.length === 0 && input.view === FILTER_VIEWS.RECOMMENDATIONS) {
        reasons.push('Recommended for you');
    } else if (reasons.length === 0) {
        reasons.push('Popular workspace');
    }

    return reasons.slice(0, 2);
};

const fetchSnapshotCandidates = async (
    conditions: SQL<unknown>[],
    order: SQL<number>,
): Promise<CandidateProject[]> => db
    .select({
        id: workspaces.id,
        ownerId: workspaces.ownerId,
        title: workspaces.title,
        description: workspaces.description,
        shortDescription: workspaces.shortDescription,
        category: workspaces.category,
        skills: workspaces.skills,
        tags: workspaces.tags,
        coverImage: workspaces.coverImage,
        lifecycleStages: workspaces.lifecycleStages,
        viewCount: workspaces.viewCount,
        followersCount: workspaces.followersCount,
        updatedAt: workspaces.updatedAt,
        createdAt: workspaces.createdAt,
    })
    .from(workspaces)
    .where(and(...conditions))
    .orderBy(sql`${order} DESC`, desc(workspaces.id))
    .limit(DISCOVER_RANKING_WEIGHTS.candidateLimit);

const getFeedSnapshot = async (
    view: FilterView,
    viewerId: string | null,
    filters: DiscoverFilters,
    personalizationTerms: string[],
    now: number,
) => {
    const candidateConditions = buildBaseConditions(filters, view, viewerId);
    // For you picks its 280 by fit (skills, tags, follows) blended with momentum, so a well-matched quiet
    // project can make the list; Trending picks by momentum alone.
    const order = view === FILTER_VIEWS.RECOMMENDATIONS && personalizationTerms.length > 0
        ? sql<number>`(${buildRecommendationRelevanceExpr(personalizationTerms)} + ${trendingScoreSql(now)} * ${DISCOVER_RANKING_WEIGHTS.recommendation.trendBlend})`
        : trendingScoreSql(now);
    const candidates = await fetchSnapshotCandidates(candidateConditions, order);

    const scored = candidates.map((candidate) => {
        const trendScore = calculateTrendScore(candidate, now);
        const qualityScore = calculateQualityScore(candidate);

        if (view === FILTER_VIEWS.RECOMMENDATIONS) {
            const recommendation = calculateRecommendationScore(candidate, personalizationTerms, now);
            return {
                id: candidate.id,
                ownerId: candidate.ownerId,
                category: candidate.category,
                score: recommendation.score,
                reasons: buildReasonLabels({
                    view,
                    matchedTerms: recommendation.matchedTerms,
                    trendScore,
                    qualityScore,
                    updatedAt: candidate.updatedAt,
                    now,
                }),
            };
        }

        return {
            id: candidate.id,
            ownerId: candidate.ownerId,
            category: candidate.category,
            score: trendScore + qualityScore,
            reasons: buildReasonLabels({
                view,
                matchedTerms: 0,
                trendScore,
                qualityScore,
                updatedAt: candidate.updatedAt,
                now,
            }),
        };
    });

    const reranked = applyDiversityRerank(scored).map((entry) => ({
        id: entry.id,
        score: entry.score,
        reasons: entry.reasons,
    }));

    return { items: reranked } as SnapshotPayload;
};

const projectSelectFields = {
    id: workspaces.id,
    ownerId: workspaces.ownerId,
    title: workspaces.title,
    slug: workspaces.slug,
    // A card shows two lines: no whole READMEs in a feed (the shared feed does the same).
    description: sql<string | null>`left(${workspaces.description}, 280)`,
    shortDescription: workspaces.shortDescription,
    coverImage: workspaces.coverImage,
    category: workspaces.category,
    viewCount: workspaces.viewCount,
    followersCount: workspaces.followersCount,
    tags: workspaces.tags,
    skills: workspaces.skills,
    visibility: workspaces.visibility,
    status: workspaces.status,
    lifecycleStages: workspaces.lifecycleStages,
    leadFocus: sql<string | null>`${workspaces.importSource}->'metadata'->>'leadFocus'`,
    externalLinks: workspaces.externalLinks,
    githubRepoUrl: workspaces.githubRepoUrl,
    kind: workspaces.kind,
    orgType: workspaces.orgType,
    orgCard: sql<{ typeLabel?: string | null; partOf?: string | null } | null>`CASE WHEN ${workspaces.kind} = 'organization' THEN jsonb_build_object('typeLabel', ${workspaces.orgSettings}->>'typeLabel', 'partOf', ${workspaces.orgSettings}->>'partOf') END`,
    parentId: workspaces.parentId,
    createdAt: workspaces.createdAt,
    cursorAt: cursorAtSql,
    updatedAt: workspaces.updatedAt,
};

const fetchProjectsByIds = async (projectIds: string[], conditions: SQL<unknown>[] = []): Promise<RawProjectRow[]> => {
    if (projectIds.length === 0) return [];
    const rows = await db
        .select({ ...projectSelectFields, feedScore: sql<number>`0` })
        .from(workspaces)
        .where(and(inArray(workspaces.id, projectIds), ...conditions));
    const rank = new Map(projectIds.map((id, index) => [id, index]));
    rows.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
    return rows as RawProjectRow[];
};

const hydrateProjects = async (
    rawProjects: RawProjectRow[],
    rankingReasonMap?: Map<string, string[]>,
    viewerId: string | null = null,
    surface: 'full' | 'preview' = 'full',
): Promise<Workspace[]> => {
    if (rawProjects.length === 0) return [];

    const projectIds = rawProjects.map((project) => project.id);
    const ownerIds = Array.from(new Set(rawProjects.map((project) => project.ownerId)));

    const [owners, roles, members, connectedMembers, viewerMemberships] = await Promise.all([
        db.select({
                id: profiles.id,
                username: profiles.username,
                fullName: profiles.fullName,
                avatarUrl: profiles.avatarUrl,
            })
            .from(profiles)
            .where(inArray(profiles.id, ownerIds)),
        // A card shows open seats, not the roles themselves: one summed row per project.
        db
            .select({
                projectId: workspaceOpenRoles.projectId,
                open: sql<number>`coalesce(sum(greatest(${workspaceOpenRoles.count} - ${workspaceOpenRoles.filled}, 0)), 0)`.mapWith(Number),
            })
            .from(workspaceOpenRoles)
            .where(inArray(workspaceOpenRoles.projectId, projectIds))
            .groupBy(workspaceOpenRoles.projectId)
            .catch((error) => {
                const message = error instanceof Error ? error.message : String(error);
                if (message.toLowerCase().includes('workspace_open_roles') && message.toLowerCase().includes('does not exist')) {
                    return [];
                }
                throw error;
            }),
        // ponytail: a card shows 4 avatars + "+N": read at most 8 members per project (the visible ones fill
        // the stack) and the team size from SQL, not every member of every project.
        surface === 'preview'
            ? Promise.resolve([])
            : (() => {
                const ranked = db.select({
                    id: workspaceMembers.id,
                    projectId: workspaceMembers.projectId,
                    userId: workspaceMembers.userId,
                    role: workspaceMembers.role,
                    joinedAt: workspaceMembers.joinedAt,
                    username: profiles.username,
                    fullName: profiles.fullName,
                    avatarUrl: profiles.avatarUrl,
                    memberRank: sql<number>`row_number() over (partition by ${workspaceMembers.projectId} order by ${workspaceMembers.joinedAt}, ${workspaceMembers.userId})`.mapWith(Number).as('member_rank'),
                    teamSize: sql<number>`count(*) over (partition by ${workspaceMembers.projectId})`.mapWith(Number).as('team_size'),
                })
                    .from(workspaceMembers)
                    .innerJoin(profiles, and(eq(workspaceMembers.userId, profiles.id), isNull(profiles.deletedAt)))
                    // The team size counts only members a stranger may see (as the shared feed does), so a private
                    // member's existence isn't revealed by the number; a viewer always counts themselves.
                    .where(and(
                        inArray(workspaceMembers.projectId, projectIds),
                        sql`(coalesce(${profiles.visibility}, 'public') = 'public' OR ${workspaceMembers.userId} = ${viewerId})`,
                    ))
                    .as('ranked_members');
                return db.select().from(ranked).where(lte(ranked.memberRank, 8)).catch((error) => {
                    const message = error instanceof Error ? error.message : String(error);
                    if (message.toLowerCase().includes('workspace_members') && message.toLowerCase().includes('does not exist')) return [];
                    throw error;
                });
            })(),
        surface === 'preview' && viewerId
            ? (() => {
                const rankedConnectedMembers = db.select({
                    projectId: workspaceMembers.projectId,
                    userId: workspaceMembers.userId,
                    username: profiles.username,
                    fullName: profiles.fullName,
                    membershipRole: workspaceMembers.role,
                    isProjectOwner: sql<boolean>`${workspaceMembers.userId} = ${workspaces.ownerId}`.as('is_project_owner'),
                    acceptedRoleTitle: sql<string | null>`(
                        select coalesce(
                            nullif(${roleApplications.acceptedRoleTitle}, ''),
                            nullif(${workspaceOpenRoles.title}, ''),
                            nullif(${workspaceOpenRoles.role}, '')
                        )
                        from ${roleApplications}
                        left join ${workspaceOpenRoles}
                            on ${workspaceOpenRoles.id} = ${roleApplications.roleId}
                        where ${roleApplications.projectId} = ${workspaceMembers.projectId}
                          and ${roleApplications.applicantId} = ${workspaceMembers.userId}
                          and ${roleApplications.status} = 'accepted'
                        order by ${roleApplications.updatedAt} desc, ${roleApplications.id} desc
                        limit 1
                    )`.as('accepted_role_title'),
                    connectionRank: sql<number>`row_number() over (
                        partition by ${workspaceMembers.projectId}
                        order by
                            case when ${workspaceMembers.userId} = ${workspaces.ownerId} then 0 else 1 end,
                            ${workspaceMembers.joinedAt} desc,
                            ${workspaceMembers.userId}
                    )`.mapWith(Number).as('connection_rank'),
                    connectedCount: sql<number>`count(*) over (
                        partition by ${workspaceMembers.projectId}
                    )`.mapWith(Number).as('connected_count'),
                })
                    .from(workspaceMembers)
                    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.projectId))
                    .innerJoin(profiles, eq(workspaceMembers.userId, profiles.id))
                    .innerJoin(
                        connections,
                        and(
                            eq(connections.status, 'accepted'),
                            or(
                                and(eq(connections.requesterId, viewerId), eq(connections.addresseeId, workspaceMembers.userId)),
                                and(eq(connections.addresseeId, viewerId), eq(connections.requesterId, workspaceMembers.userId)),
                            ),
                        ),
                    )
                    .where(and(
                        inArray(workspaceMembers.projectId, projectIds),
                        ne(workspaceMembers.userId, viewerId),
                        isNull(profiles.deletedAt),
                    ))
                    .as('ranked_connected_members');

                return db.select().from(rankedConnectedMembers).where(lte(rankedConnectedMembers.connectionRank, 3));
            })()
            : Promise.resolve([]),
        // Members-only links show to the viewer's own projects (any size of team, not just the 8 read above).
        viewerId
            ? db.select({ projectId: workspaceMembers.projectId }).from(workspaceMembers)
                .where(and(eq(workspaceMembers.userId, viewerId), inArray(workspaceMembers.projectId, projectIds)))
            : Promise.resolve([] as Array<{ projectId: string }>),
    ]);

    // Org cards count their projects; child cards name their (public) org (report §24.1, §24.2).
    const orgIds = rawProjects.filter((project) => project.kind === 'organization').map((project) => project.id);
    const parentIds = Array.from(new Set(rawProjects.map((project) => project.parentId).filter((id): id is string => Boolean(id))));
    const [childCounts, parentOrgs] = await Promise.all([
        orgIds.length ? db.select({ parentId: workspaces.parentId, n: sql<number>`count(*)::int` }).from(workspaces)
            .where(and(inArray(workspaces.parentId, orgIds), isNull(workspaces.deletedAt))).groupBy(workspaces.parentId) : Promise.resolve([]),
        parentIds.length ? db.select({ id: workspaces.id, title: workspaces.title, slug: workspaces.slug }).from(workspaces)
            .where(and(inArray(workspaces.id, parentIds), eq(workspaces.kind, 'organization'), isNull(workspaces.deletedAt), inArray(workspaces.visibility, ['public', 'unlisted']))) : Promise.resolve([]),
    ]);
    const childCountMap = new Map(childCounts.map((row) => [row.parentId, row.n]));
    const parentOrgMap = new Map(parentOrgs.map((row) => [row.id, { title: row.title, slug: row.slug }]));
    const ownerMap = new Map(owners.map((owner) => [owner.id, owner]));
    // Collaborators show only to people allowed to see them (public, or connected for
    // connections-only), never across a block. One privacy lookup for owners and members together.
    const memberRelationshipMap = await resolvePrivacyRelationships(viewerId, [...ownerIds, ...members.map((member) => member.userId)]);
    const ownerRelationshipMap = memberRelationshipMap;
    const canShowMember = (userId: string) => {
        const relationship = memberRelationshipMap.get(userId);
        return Boolean(relationship && relationship.canViewProfile && !relationship.blockedByViewer && !relationship.blockedByTarget);
    };
    const leadFocusByProject = new Map(rawProjects.map((project) => {
        return [project.id, project.leadFocus?.trim() ?? ''] as const;
    }));
    const connectedMemberMap = new Map<string, {
        friends: Array<{ userId: string; name: string; role: string }>;
        totalCount: number;
        includesOwner: boolean;
    }>();
    connectedMembers.forEach((member) => {
        const name = member.fullName?.trim() || (member.username ? `@${member.username}` : '');
        if (!name) return;
        const membershipRoleLabel = getWorkspaceMemberRoleLabel(member.membershipRole);
        const leadFocus = leadFocusByProject.get(member.projectId) || '';
        const role = member.isProjectOwner
            ? leadFocus ? `${membershipRoleLabel} / ${leadFocus}` : membershipRoleLabel
            : member.acceptedRoleTitle?.trim()
                ? `${member.acceptedRoleTitle.trim()} · ${membershipRoleLabel}`
                : membershipRoleLabel;
        const cluster = connectedMemberMap.get(member.projectId) ?? {
            friends: [],
            totalCount: Number(member.connectedCount || 0),
            includesOwner: false,
        };
        cluster.friends.push({ userId: member.userId, name, role });
        cluster.totalCount = Math.max(cluster.totalCount, Number(member.connectedCount || 0));
        cluster.includesOwner ||= member.isProjectOwner;
        connectedMemberMap.set(member.projectId, cluster);
    });


    const viewerProjects = new Set(viewerMemberships.map((row) => row.projectId));
    const openSeats = new Map((roles as Array<{ projectId: string; open: number }>).map((row) => [row.projectId, row.open]));
    const teamSizes = new Map(members.map((member) => [member.projectId, member.teamSize]));

    const membersMap = new Map<
        string,
        Array<{
            member: { id: string; projectId: string; userId: string; role: string; joinedAt: Date };
            user: { id: string; username: string | null; fullName: string | null; avatarUrl: string | null };
        }>
    >();
    members.forEach((row) => {
        if (!canShowMember(row.userId)) return;
        if (!membersMap.has(row.projectId)) membersMap.set(row.projectId, []);
        membersMap.get(row.projectId)!.push({
            member: { id: row.id, projectId: row.projectId, userId: row.userId, role: row.role, joinedAt: row.joinedAt },
            user: { id: row.userId, username: row.username, fullName: row.fullName, avatarUrl: row.avatarUrl },
        });
    });

    return rawProjects.map((project) => {
        const owner = ownerMap.get(project.ownerId);
        const ownerPresentation = buildWorkspaceOwnerPresentation(
            owner
                ? {
                    id: owner.id,
                    username: owner.username,
                    fullName: owner.fullName,
                    avatarUrl: owner.avatarUrl,
                }
                : null,
            ownerRelationshipMap.get(project.ownerId) ?? null,
        );
        const ownerRelationship = ownerRelationshipMap.get(project.ownerId) ?? null;
        const connectedOwnerName = ownerRelationship?.isConnected
            ? owner?.fullName?.trim() || (owner?.username ? `@${owner.username}` : '')
            : '';
        const connectedCluster = connectedMemberMap.get(project.id);
        const leadFocus = leadFocusByProject.get(project.id) || '';
        const connectedFriends = connectedCluster?.friends.map(({ name, role }) => ({ name, role })) ?? [];
        let connectedFriendsCount = connectedCluster?.totalCount ?? 0;
        if (connectedOwnerName && !connectedCluster?.includesOwner) {
            connectedFriends.unshift({
                name: connectedOwnerName,
                role: leadFocus ? `Owner / ${leadFocus}` : 'Owner',
            });
            connectedFriendsCount += 1;
        }
        const visibleConnectedFriends = connectedFriends.slice(0, 3);
        if (ownerPresentation?.isMasked) {
            logger.metric('privacy.project.owner_masked', {
                surface: 'discover',
                viewerId: viewerId ?? 'anon',
                ownerId: project.ownerId,
                projectId: project.id,
            });
        }
        const projectMembersRows = membersMap.get(project.id) || [];

        const followersCount = project.followersCount || 0;


        const normalizedStatus: Workspace['status'] =
            project.status === 'draft' ||
                project.status === 'active' ||
                project.status === 'completed' ||
                project.status === 'archived'
                ? project.status
                : 'draft';

        return {
            id: project.id,
            title: project.title,
            description: project.description,
            shortDescription: project.shortDescription,
            slug: project.slug || project.id,
            status: normalizedStatus,
            category: project.category,
            coverImage: project.coverImage,
            tags: project.tags || [],
            skills: project.skills || [],
            visibility: project.visibility || 'public',
            externalLinks: filterWorkspaceLinksForAudience(
                project.externalLinks,
                project.ownerId === viewerId || viewerProjects.has(project.id),
            ),
            githubRepoUrl: project.githubRepoUrl,
            viewCount: project.viewCount || 0,
            followersCount,

            // A masked creator's id would let anyone link their "Private profile" workspaces together.
            ownerId: ownerPresentation?.isMasked ? '' : project.ownerId,
            rankingReasons: rankingReasonMap?.get(project.id) || [],
            connectedFriends: visibleConnectedFriends,
            additionalConnectedFriendsCount: Math.max(0, connectedFriendsCount - visibleConnectedFriends.length),
            owner: ownerPresentation?.isMasked ? { ...ownerPresentation, id: '' } : ownerPresentation,
            collaborators: projectMembersRows.map((member) => ({
                userId: member.member.userId,
                membershipRole: member.member.role,
                user: {
                    id: member.user.id,
                    username: member.user.username,
                    fullName: member.user.fullName,
                    avatarUrl: member.user.avatarUrl,
                },
            })) as Workspace['collaborators'],
            // Seats and team size as numbers: the card needs counts, not every role and member.
            openRoles: [],
            openRolesCount: openSeats.get(project.id) ?? 0,
            collaboratorsCount: teamSizes.get(project.id) ?? projectMembersRows.length,
            followers: [],
            kind: project.kind,
            orgType: project.orgType,
            orgTypeLabel: orgTypeLabel(project.orgType, project.orgCard),
            orgPartOf: project.orgCard?.partOf ?? null,
            childProjectCount: project.kind === 'organization' ? childCountMap.get(project.id) ?? 0 : undefined,
            cardOrg: project.parentId ? parentOrgMap.get(project.parentId) ?? null : null,
            createdAt: project.createdAt.toISOString(),
            updatedAt: project.updatedAt.toISOString(),
        };
    });
};

export const getDiscoverWorkspaces = async (
    filters: DiscoverFilters = DEFAULT_FILTERS,
    cursor?: string,
    pageSize: number = 24,
    options: DiscoverQueryOptions = {},
) => {
    const start = Date.now();
    const view = options.view ?? FILTER_VIEWS.ALL;
    const viewerId = options.viewerId ?? null;
    const surface = options.surface ?? 'full';

    if (view === FILTER_VIEWS.FOLLOWING && !viewerId) {
        return {
            projects: [],
            nextCursor: undefined,
            hasMore: false,
            schemaVersion: DISCOVER_RANKING_SCHEMA_VERSION,
        };
    }

    const parsedCursor = parseDiscoverCursor(cursor);
    const viewerType = viewerId ? 'user' : 'anon';
    const filtersFingerprint = buildDiscoverSnapshotKey({ view, filters, viewerId: viewerId ?? 'anon' }).slice(0, 12);
    if (parsedCursor && parsedCursor.fingerprint !== filtersFingerprint) {
        throw new InvalidDiscoverCursorError();
    }

    if (view === FILTER_VIEWS.TRENDING || view === FILTER_VIEWS.RECOMMENDATIONS) {
        if (parsedCursor && parsedCursor.kind !== 'snapshot') {
            throw new InvalidDiscoverCursorError();
        }
        // The ranked list is built once (at the first page's moment) and kept 10 minutes, so later pages
        // slice the same order: no re-ranking per page, and a follow made mid-scroll doesn't reshuffle it.
        // ponytail: without Redis each page rebuilds the list at the same pinned "now"; the position fallback covers drift.
        const now = parsedCursor?.kind === 'snapshot' ? parsedCursor.now : Date.now();
        const snapshotKey = `discover:snapshot:v${DISCOVER_RANKING_SCHEMA_VERSION}:${filtersFingerprint}:${now}`;
        let snapshot = parsedCursor ? await getCachedData<SnapshotPayload>(snapshotKey).catch(() => null) : null;
        if (!snapshot) {
            const personalizationTerms = view === FILTER_VIEWS.RECOMMENDATIONS ? await getViewerPersonalizationTerms(viewerId) : [];
            snapshot = await getFeedSnapshot(view, viewerId, filters, personalizationTerms, now);
            await cacheData(snapshotKey, snapshot, 600).catch(() => undefined);
        }
        let startIndex = 0;
        if (parsedCursor?.kind === 'snapshot') {
            const cursorIndex = snapshot.items.findIndex((item) => item.id === parsedCursor.id);
            if (cursorIndex >= 0) {
                startIndex = cursorIndex + 1;
            } else if (parsedCursor.index !== null && parsedCursor.index < snapshot.items.length) {
                startIndex = parsedCursor.index + 1;
            } else {
                logger.warn('discover.snapshot.cursor_not_found', {
                    view,
                    cursorId: parsedCursor.id,
                    snapshotItemsLength: snapshot.items.length,
                    schemaVersion: DISCOVER_RANKING_SCHEMA_VERSION,
                    filtersFingerprint,
                });
                throw new StaleDiscoverFeedError();
            }
        }

        const currentConditions = buildBaseConditions(filters, view, viewerId);
        const reasonsMap = new Map<string, string[]>();
        const pageRows: RawProjectRow[] = [];
        let consumedIndex = startIndex;

        while (pageRows.length < pageSize && consumedIndex < snapshot.items.length) {
            const pageItems = snapshot.items.slice(consumedIndex, consumedIndex + pageSize - pageRows.length);
            consumedIndex += pageItems.length;
            pageRows.push(...await fetchProjectsByIds(pageItems.map((item) => item.id), currentConditions));
            for (const item of pageItems) reasonsMap.set(item.id, item.reasons);
        }

        const mappedProjects = await hydrateProjects(pageRows, reasonsMap, viewerId, surface);
        const lastSnapshotItem = snapshot.items[consumedIndex - 1];
        const nextCursor =
            consumedIndex < snapshot.items.length && lastSnapshotItem
                ? buildSnapshotCursor(filtersFingerprint, now, lastSnapshotItem.id, consumedIndex - 1)
                : undefined;

        recordDiscoverMetric({
            view,
            viewerType,
            durationMs: Date.now() - start,
            projectCount: mappedProjects.length,
            hasMore: !!nextCursor,
            cacheHit: false,
            strategy: 'snapshot',
            filtersFingerprint,
        });

        return {
            projects: mappedProjects,
            nextCursor,
            hasMore: !!nextCursor,
            schemaVersion: DISCOVER_RANKING_SCHEMA_VERSION,
        };
    }

    const conditions = buildBaseConditions(filters, view, viewerId);

    const normalizedSort = filters.sort || SORT_OPTIONS.NEWEST;
    const activeSearchTerms = filters.search
        ? dedupeTerms(tokenizeSearchQuery(filters.search), MAX_SEARCH_TOKENS)
        : [];
    const now = parsedCursor?.kind === 'score' ? parsedCursor.now : Date.now();

    let scoreExpr: SQL<number> | null = null;
    // Count sorts order by the plain integer column (index order); the cursor compares it as an integer.
    let scoreType: 'float8' | 'integer' = 'float8';
    let isOldestSort = false;

    if (activeSearchTerms.length > 0 && normalizedSort === SORT_OPTIONS.NEWEST) {
        scoreExpr = buildSearchRelevanceExpr(activeSearchTerms);
    } else if (normalizedSort === SORT_OPTIONS.MOST_VIEWED) {
        scoreExpr = sql<number>`${workspaces.viewCount}`;
        scoreType = 'integer';
    } else if (normalizedSort === SORT_OPTIONS.MOST_FOLLOWED) {
        scoreExpr = sql<number>`${workspaces.followersCount}`;
        scoreType = 'integer';
    } else if (normalizedSort === SORT_OPTIONS.OLDEST) {
        isOldestSort = true;
    }

    if (parsedCursor && parsedCursor.kind !== (scoreExpr ? 'score' : 'time')) {
        throw new InvalidDiscoverCursorError();
    }

    if (scoreExpr && parsedCursor?.kind === 'score') {
        conditions.push(sql<boolean>`(
            (${scoreExpr}, ${workspaces.createdAt}, ${workspaces.id})
            < (${parsedCursor.score}::${sql.raw(scoreType)}, ${parsedCursor.createdAt}::timestamptz, ${parsedCursor.id}::uuid)
        )`);
    } else if (!scoreExpr && parsedCursor?.kind === 'time') {
        const operator = isOldestSort ? sql`>` : sql`<`;
        conditions.push(
            sql<boolean>`(
                (${workspaces.createdAt}, ${workspaces.id})
                ${operator}
                (${parsedCursor.createdAt}::timestamptz, ${parsedCursor.id}::uuid)
            )`,
        );
    }

    const orderByClauses: SQL<unknown>[] = scoreExpr
        ? [sql`${scoreExpr} DESC`, desc(workspaces.createdAt), desc(workspaces.id)]
        : isOldestSort
            ? [asc(workspaces.createdAt), asc(workspaces.id)]
            : [desc(workspaces.createdAt), desc(workspaces.id)];

    // The preview (global search) skips the heavy text columns it never shows.
    const selectFields = surface === 'preview'
        ? {
            ...projectSelectFields,
            description: sql<string | null>`null`,
            category: sql<string | null>`null`,
            tags: sql<string[] | null>`null`,
            visibility: sql<string | null>`null`,
            lifecycleStages: sql<string[] | null>`null`,
            leadFocus: sql<string | null>`null`,
            feedScore: scoreExpr ?? sql<number>`0`,
        }
        : { ...projectSelectFields, feedScore: scoreExpr ?? sql<number>`0` };

    const rawProjects = await db
        .select(selectFields)
        .from(workspaces)
        .where(and(...conditions))
        .orderBy(...orderByClauses)
        .limit(pageSize + 1) as RawProjectRow[];

    const hasMore = rawProjects.length > pageSize;
    const pageProjects = hasMore ? rawProjects.slice(0, pageSize) : rawProjects;
    const mappedProjects = await hydrateProjects(pageProjects, undefined, viewerId ?? null, surface);
    const lastProject = pageProjects.at(-1);
    const nextCursor = hasMore && lastProject
        ? scoreExpr
            ? buildScoreCursor(filtersFingerprint, Number(lastProject.feedScore || 0), lastProject.cursorAt, lastProject.id, now)
            : buildTimeCursor(filtersFingerprint, lastProject.cursorAt, lastProject.id)
        : undefined;

    recordDiscoverMetric({
        view,
        viewerType,
        durationMs: Date.now() - start,
        projectCount: mappedProjects.length,
        hasMore: !!nextCursor,
        cacheHit: false,
        strategy: 'direct',
        filtersFingerprint,
    });

    return {
        projects: mappedProjects,
        nextCursor,
        hasMore,
        schemaVersion: DISCOVER_RANKING_SCHEMA_VERSION,
    };
};

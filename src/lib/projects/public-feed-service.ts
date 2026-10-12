import { and, desc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm'

import { db } from '@/lib/db'
import { isMissingRelationError } from '@/lib/db/errors'
import { connections, profiles, projectOpenRoles, projects, projectMembers } from '@/lib/db/schema'
import { logger } from '@/lib/logger'
import { filterProjectLinksForAudience } from '@/lib/projects/social-links'
import { getCacheEnvelope, cacheStaleableData, isCacheStale, redis } from '@/lib/redis'
import {
    buildPublicProjectsCacheKey,
    encodePublicProjectsCursor,
    type PublicProjectsCursor,
    type PublicProjectsFeedItem,
} from '@/lib/projects/public-feed'

export const PUBLIC_PROJECTS_FEED_DEFAULT_LIMIT = 24
export const PUBLIC_PROJECTS_FEED_MAX_LIMIT = 100
export const PUBLIC_PROJECTS_FEED_FRESH_TTL_SECONDS = 60
export const PUBLIC_PROJECTS_FEED_STALE_TTL_SECONDS = 300

type PublicProjectRow = {
    id: string
    slug: string | null
    title: string
    description: string | null
    shortDescription: string | null
    category: string | null
    skills: string[] | null
    tags: string[] | null
    status: string | null
    visibility: string | null
    ownerId: string
    viewCount: number | null
    followersCount: number
    savesCount: number | null
    coverImage: string | null
    externalLinks: any | null
    githubRepoUrl: string | null
    createdAt: Date
    /** created_at as text with microseconds, for the cursor. */
    cursorAt: string
    updatedAt: Date
    profiles: {
        id: string
        username: string | null
        full_name: string | null
        avatar_url: string | null
        visibility: string | null
    }
}

type PublicProjectRoleRow = {
    id: string
    projectId: string
    role: string
    title: string | null
    count: number
    filled: number
}

export type PublicProjectsFeedPage = {
    projects: PublicProjectsFeedItem[]
    nextCursor: string | null
    source: 'redis' | 'redis-stale' | 'database'
    cacheState: 'fresh' | 'stale' | 'miss'
}

/**
 * The shared feed is one cached payload for every viewer, so it is shaped for the most restricted one
 * (signed out): a non-public owner is masked here, on the server, and members-only links never leave it.
 */
function mapProjectRow(row: PublicProjectRow, openRoles: PublicProjectRoleRow[], members: any[]): PublicProjectsFeedItem {
    const ownerIsPublic = (row.profiles.visibility || 'public') === 'public'
    return {
        id: row.id,
        slug: row.slug,
        title: row.title,
        description: row.description,
        short_description: row.shortDescription,
        category: row.category,
        skills: row.skills ?? [],
        tags: row.tags ?? [],
        status: row.status,
        visibility: row.visibility,
        owner_id: row.ownerId,
        view_count: row.viewCount ?? 0,
        followers_count: row.followersCount ?? 0,
        saves_count: row.savesCount ?? 0,
        cover_image: row.coverImage,
        external_links: filterProjectLinksForAudience(row.externalLinks, false),
        github_repo_url: row.githubRepoUrl,
        created_at: row.createdAt.toISOString(),
        updated_at: row.updatedAt.toISOString(),
        // The card counts open seats; role text and skills live on the project page.
        open_roles: openRoles.map((role) => ({
            id: role.id,
            project_id: role.projectId,
            role: role.role,
            title: role.title,
            description: null,
            count: role.count,
            filled: role.filled,
            skills: [],
        })),
        collaborators: members.map((m) => ({
            user_id: m.userId,
            membership_role: m.role,
            profiles: m.profiles,
        })),
        profiles: ownerIsPublic
            ? row.profiles
            : { id: row.profiles.id, username: null, full_name: null, avatar_url: null, visibility: row.profiles.visibility },
    }
}

export async function readPublicProjectsFeedCache(limit: number, cursor: PublicProjectsCursor | null) {
    const cacheKey = buildPublicProjectsCacheKey(limit, cursor)
    const cached = await getCacheEnvelope<{
        projects: PublicProjectsFeedItem[]
        nextCursor: string | null
    }>(cacheKey)

    return {
        cacheKey,
        fresh: cached && !isCacheStale(cached) ? cached : null,
        stale: cached && (!cached.expiresAt || cached.expiresAt > Date.now()) ? cached : null,
    }
}

export async function queryAndCachePublicProjectsFeed(limit: number, cursor: PublicProjectsCursor | null) {
    const rows = await db
        .select({
            id: projects.id,
            slug: projects.slug,
            title: projects.title,
            // The card shows two lines: no need to ship whole READMEs in a shared feed.
            description: sql<string | null>`left(${projects.description}, 280)`,
            shortDescription: projects.shortDescription,
            category: projects.category,
            skills: projects.skills,
            tags: projects.tags,
            status: projects.status,
            visibility: projects.visibility,
            ownerId: projects.ownerId,
            viewCount: projects.viewCount,
            followersCount: projects.followersCount,
            savesCount: projects.savesCount,
            coverImage: projects.coverImage,
            externalLinks: projects.externalLinks,
            githubRepoUrl: projects.githubRepoUrl,
            createdAt: projects.createdAt,
            cursorAt: sql<string>`to_char(${projects.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
            updatedAt: projects.updatedAt,
            profiles: {
                id: profiles.id,
                username: profiles.username,
                full_name: profiles.fullName,
                avatar_url: profiles.avatarUrl,
                visibility: profiles.visibility,
            },
        })
        .from(projects)
        .innerJoin(profiles, eq(projects.ownerId, profiles.id))
        .where(
            and(
                // Literal values, written exactly like the 0195 partial index's predicate, so the planner uses it.
                sql<boolean>`${projects.deletedAt} IS NULL AND ${projects.visibility} IN ('public', 'unlisted') AND ${projects.status} <> 'draft'`,
                // A deleted account's projects leave the feed with it.
                isNull(profiles.deletedAt),
                // Microsecond-exact: a millisecond cursor would skip rows created in the same millisecond.
                cursor
                    ? sql<boolean>`(${projects.createdAt}, ${projects.id}) < (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`
                    : undefined,
            ),
        )
        .orderBy(desc(projects.createdAt), desc(projects.id))
        .limit(limit + 1)

    const hasMore = rows.length > limit
    const pageRows = rows.slice(0, limit) as PublicProjectRow[]
    const projectIds = pageRows.map((row) => row.id)
    const roleRows = projectIds.length === 0
        ? []
        : await db
            .select({
                id: projectOpenRoles.id,
                projectId: projectOpenRoles.projectId,
                role: projectOpenRoles.role,
                title: projectOpenRoles.title,
                count: projectOpenRoles.count,
                filled: projectOpenRoles.filled,
            })
            .from(projectOpenRoles)
            .where(inArray(projectOpenRoles.projectId, projectIds))
            .catch((error) => {
                if (isMissingRelationError(error, 'project_open_roles')) {
                    logger.warn('public-feed.project_open_roles_missing', {
                        module: 'public-feed-service',
                        relation: 'project_open_roles',
                    })
                    return []
                }
                throw error
            })
    const rolesByProjectId = new Map<string, PublicProjectRoleRow[]>()
    for (const role of roleRows as PublicProjectRoleRow[]) {
        const existing = rolesByProjectId.get(role.projectId)
        if (existing) {
            existing.push(role)
        } else {
            rolesByProjectId.set(role.projectId, [role])
        }
    }

    const memberRows = projectIds.length === 0
        ? []
        : await db
            .select({
                projectId: projectMembers.projectId,
                userId: projectMembers.userId,
                role: projectMembers.role,
                profiles: {
                    id: profiles.id,
                    username: profiles.username,
                    full_name: profiles.fullName,
                    avatar_url: profiles.avatarUrl,
                },
            })
            .from(projectMembers)
            .innerJoin(profiles, eq(projectMembers.userId, profiles.id))
            // Only members anyone may see: public profiles that still exist.
            .where(and(inArray(projectMembers.projectId, projectIds), sql`coalesce(${profiles.visibility}, 'public') = 'public'`, isNull(profiles.deletedAt)))
            .catch(() => [])

    const membersByProjectId = new Map<string, any[]>()
    for (const member of memberRows) {
        const existing = membersByProjectId.get(member.projectId)
        if (existing) {
            existing.push(member)
        } else {
            membersByProjectId.set(member.projectId, [member])
        }
    }

    const lastRow = pageRows.at(-1) ?? null
    const nextCursor = hasMore && lastRow
        ? encodePublicProjectsCursor({
            createdAt: lastRow.cursorAt,
            id: lastRow.id,
        })
        : null
    const payload = {
        projects: pageRows.map((row) => mapProjectRow(row, rolesByProjectId.get(row.id) ?? [], membersByProjectId.get(row.id) ?? [])),
        nextCursor,
    }

    const cacheKey = buildPublicProjectsCacheKey(limit, cursor)
    await cacheStaleableData(
        cacheKey,
        payload,
        {
            freshTtlSeconds: PUBLIC_PROJECTS_FEED_FRESH_TTL_SECONDS,
            staleTtlSeconds: PUBLIC_PROJECTS_FEED_STALE_TTL_SECONDS,
        },
    )

    if (redis) {
        try {
            const pipe = redis.pipeline()
            pipe.sadd('projects:public:feed_keys', cacheKey)
            pipe.expire('projects:public:feed_keys', 86400)
            await pipe.exec()
        } catch (error) {
            logger.warn('public-feed.cache_key_tracking_failed', {
                module: 'public-feed-service',
                error: error instanceof Error ? error.message : String(error),
            })
        }
    }

    return payload
}

export async function invalidatePublicProjectsFeedCache(projectId?: string | null) {
    let redisDeleted = 0

    if (redis) {
        try {
            const setKey = 'projects:public:feed_keys'
            const keys = await redis.smembers(setKey)
            if (keys.length > 0) {
                const pipe = redis.pipeline()
                pipe.del(...keys)
                pipe.del(setKey)
                await pipe.exec()
                redisDeleted += keys.length
            } else {
                await redis.del(setKey)
            }
        } catch (error) {
            logger.warn('public-feed.cache_invalidation_failed', {
                module: 'public-feed-service',
                projectId: projectId ?? null,
                error: error instanceof Error ? error.message : String(error),
            })
        }
    }

    return { redisDeleted }
}

/**
 * The shared feed as one viewer may see it. The cached payload keeps real ids (blocks need them); this is
 * the last step before anything leaves the server: drop projects and collaborators across a block (either
 * direction), then blank a masked creator's id so their "Private creator" projects can't be linked.
 */
export async function forViewer(feed: PublicProjectsFeedItem[], viewerId: string | null): Promise<PublicProjectsFeedItem[]> {
    let visible = feed
    if (viewerId && feed.length > 0) {
        const rows = await db
            .select({ requesterId: connections.requesterId, addresseeId: connections.addresseeId })
            .from(connections)
            .where(and(eq(connections.status, 'blocked'), or(eq(connections.requesterId, viewerId), eq(connections.addresseeId, viewerId))))
        if (rows.length > 0) {
            const blocked = new Set(rows.map((row) => (row.requesterId === viewerId ? row.addresseeId : row.requesterId)))
            visible = feed
                .filter((project) => !blocked.has(project.owner_id))
                .map((project) => ({ ...project, collaborators: project.collaborators.filter((member) => !blocked.has(member.user_id)) }))
        }
    }
    return visible.map((project) => (project.profiles.visibility || 'public') === 'public'
        ? project
        : { ...project, owner_id: '', profiles: { ...project.profiles, id: '' } })
}

export async function getPublicProjectsFeedPage(limit: number, cursor: PublicProjectsCursor | null): Promise<PublicProjectsFeedPage> {
    const normalizedLimit = Math.min(
        Math.max(1, Math.trunc(limit || PUBLIC_PROJECTS_FEED_DEFAULT_LIMIT)),
        PUBLIC_PROJECTS_FEED_MAX_LIMIT,
    )
    const cached = await readPublicProjectsFeedCache(normalizedLimit, cursor)

    if (cached.fresh) {
        return {
            projects: cached.fresh.value.projects,
            nextCursor: cached.fresh.value.nextCursor,
            source: 'redis',
            cacheState: 'fresh',
        }
    }

    try {
        const payload = await queryAndCachePublicProjectsFeed(normalizedLimit, cursor)
        return {
            ...payload,
            source: 'database',
            cacheState: 'miss',
        }
    } catch (error) {
        if (cached.stale) {
            return {
                projects: cached.stale.value.projects,
                nextCursor: cached.stale.value.nextCursor,
                source: 'redis-stale',
                cacheState: 'stale',
            }
        }
        throw error
    }
}

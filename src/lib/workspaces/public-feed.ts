import type { Workspace } from '@/types/discover'

export type PublicWorkspacesCursor = {
    createdAt: string
    id: string
}

export type PublicWorkspacesFeedItem = {
    id: string
    slug: string | null
    title: string
    description: string | null
    short_description: string | null
    category: string | null
    skills: string[]
    tags: string[]
    status: string | null
    visibility: string | null
    owner_id: string
    view_count: number
    followers_count: number
    saves_count: number
    cover_image: string | null
    external_links?: any
    github_repo_url?: string | null
    created_at: string
    updated_at: string
    /** Open seats across the project's roles (the card's count; role text stays on the project page). */
    open_seats?: number
    /** Everyone on the team; `collaborators` lists at most 8 of them. */
    team_size?: number
    open_roles: Array<{
        id: string
        project_id: string
        role: string
        title: string | null
        description: string | null
        count: number
        filled: number
        skills: string[]
    }>
    collaborators: Array<{
        user_id: string
        membership_role: string
        profiles: {
            id: string
            username: string | null
            full_name: string | null
            avatar_url: string | null
        }
    }>
    profiles: {
        id: string
        username: string | null
        full_name: string | null
        avatar_url: string | null
        visibility?: string | null
    }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Only a real timestamp and a project id: anything else would mint cache keys or fail in SQL. */
function isValidCursor(value: unknown): value is PublicWorkspacesCursor {
    if (!value || typeof value !== 'object') return false
    const { createdAt, id } = value as PublicWorkspacesCursor
    return typeof createdAt === 'string'
        && createdAt.length <= 40
        && Number.isFinite(Date.parse(createdAt))
        && typeof id === 'string'
        && UUID.test(id)
}

export function encodePublicWorkspacesCursor(cursor: PublicWorkspacesCursor | null): string | null {
    if (!cursor) return null
    return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}

export function decodePublicWorkspacesCursor(cursor: string | null | undefined): PublicWorkspacesCursor | null {
    if (!cursor) return null

    try {
        const decoded = Buffer.from(cursor, 'base64url').toString('utf8')
        const parsed = JSON.parse(decoded) as unknown
        return isValidCursor(parsed) ? parsed : null
    } catch {
        return null
    }
}

export function buildPublicWorkspacesCacheKey(limit: number, cursor: PublicWorkspacesCursor | null) {
    const suffix = cursor ? `${cursor.createdAt}:${cursor.id}` : 'origin'
    // v5: owners masked and members-only links removed on the server.
    return `projects:public:v5:limit:${limit}:cursor:${suffix}`
}

function normalizeProjectStatus(status: string | null): Workspace['status'] {
    if (status === 'active' || status === 'completed' || status === 'archived') {
        return status
    }
    return 'draft'
}

export function mapPublicWorkspaceToDiscoverWorkspace(project: PublicWorkspacesFeedItem): Workspace {
    const ownerVisibility = project.profiles.visibility || 'public'
    const shouldMaskOwner = ownerVisibility !== 'public'
    return {
        id: project.id,
        slug: project.slug ?? undefined,
        title: project.title,
        description: project.description,
        shortDescription: project.short_description,
        category: project.category,
        skills: Array.isArray(project.skills) ? project.skills : [],
        tags: Array.isArray(project.tags) ? project.tags : [],
        status: normalizeProjectStatus(project.status),
        visibility: project.visibility || 'public',
        viewCount: project.view_count,
        followersCount: project.followers_count,
        savesCount: project.saves_count,
        externalLinks: project.external_links ?? null,
        githubRepoUrl: project.github_repo_url ?? null,
        coverImage: project.cover_image,
        ownerId: project.owner_id,
        owner: {
            id: project.profiles.id,
            username: shouldMaskOwner ? null : project.profiles.username,
            fullName: shouldMaskOwner ? null : project.profiles.full_name,
            avatarUrl: shouldMaskOwner ? null : project.profiles.avatar_url,
            displayName: shouldMaskOwner ? 'Private creator' : (project.profiles.full_name || project.profiles.username || 'Creator'),
            isMasked: shouldMaskOwner,
            canOpenProfile: !shouldMaskOwner,
            badgeText: shouldMaskOwner ? (ownerVisibility === 'connections' ? 'Connections only' : 'Private') : null,
        },
        createdAt: project.created_at,
        updatedAt: project.updated_at,
        collaborators: Array.isArray(project.collaborators)
            ? project.collaborators.map((c) => ({
                userId: c.user_id,
                membershipRole: c.membership_role,
                user: {
                    id: c.profiles.id,
                    username: c.profiles.username,
                    fullName: c.profiles.full_name,
                    avatarUrl: c.profiles.avatar_url,
                },
            })) as any[]
            : [],
        openRolesCount: project.open_seats ?? undefined,
        collaboratorsCount: project.team_size ?? undefined,
        openRoles: Array.isArray(project.open_roles)
            ? project.open_roles.map((role) => ({
                id: role.id,
                projectId: role.project_id,
                role: role.role,
                title: role.title,
                description: role.description,
                count: Number(role.count || 0),
                filled: Number(role.filled || 0),
                skills: Array.isArray(role.skills) ? role.skills : [],
            }))
            : [],
        followers: [],
    }
}

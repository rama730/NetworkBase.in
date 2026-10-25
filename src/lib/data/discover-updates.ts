import { and, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { profiles, projectMembers, projectUpdateLikes, projectUpdates, projects } from "@/lib/db/schema";
import { buildBaseConditions, buildSearchConditions, DEFAULT_FILTERS } from "@/lib/data/discover";
import { readableProfileIdentitySql } from "@/lib/privacy/resolver";
import { getProjectMemberRoleLabel, normalizeProjectMemberRole } from "@/lib/projects/settings-policies";
import { readProjectRoleTitles, roleTitleKey } from "@/lib/projects/update-roles";
import {
    normalizeProjectUpdateAuthorRoleSnapshot,
    normalizeProjectUpdateMediaItems,
    normalizeProjectUpdateType,
    resolveProjectUpdateAuthorRoleDisplay,
} from "@/lib/projects/updates";
import { containsLikePattern } from "@/lib/search/query";
import { FILTER_VIEWS, type FilterView } from "@/constants/discover";
import type { DiscoverFilters, DiscoverUpdateView, DiscoverUpdatesPage } from "@/types/discover";

export interface DiscoverUpdatesQueryOptions {
    filters?: DiscoverFilters;
    view?: FilterView;
    viewerId?: string | null;
    limit?: number;
    cursor?: string | null;
}

export class InvalidDiscoverUpdatesCursorError extends Error {
    constructor() {
        super("Invalid updates cursor");
        this.name = "InvalidDiscoverUpdatesCursorError";
    }
}

const MAX_PAGE = 12;
// Rows read per page: room to skip a project's second update or an author's third without a second round trip.
const SCAN_FACTOR = 3;
const PER_AUTHOR_PER_PAGE = 2;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:?\d{2})?)?$/;

type Cursor = { at: string; id: string };

function encodeCursor(cursor: Cursor) {
    return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function decodeCursor(value: string): Cursor {
    try {
        const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<Cursor>;
        if (typeof parsed.at === "string" && typeof parsed.id === "string" && TIMESTAMP.test(parsed.at) && UUID.test(parsed.id)) {
            return { at: parsed.at, id: parsed.id };
        }
    } catch {
        // falls through to the error below
    }
    throw new InvalidDiscoverUpdatesCursorError();
}

/**
 * Who may read a project's updates at all: the same rule as the project's Updates tab. The tab is on for the
 * public unless the owner turned it off (anything but an explicit `false` counts as on), and a project's own
 * team always sees it.
 */
function updatesTabVisible(viewerId: string | null): SQL<unknown> {
    const publicOn = sql`${projects.publicTabVisibility}->'updates' IS DISTINCT FROM 'false'::jsonb`;
    if (!viewerId) return publicOn;
    return sql`(${publicOn}
        OR ${projects.ownerId} = ${viewerId}
        OR EXISTS (SELECT 1 FROM project_members tab_member WHERE tab_member.project_id = ${projects.id} AND tab_member.user_id = ${viewerId}))`;
}

/** Everything that decides whether an update may appear: used by the list and by the single read alike. */
function visibilityConditions(filters: DiscoverFilters, view: FilterView, viewerId: string | null): SQL<unknown>[] {
    const conditions: SQL<unknown>[] = [
        eq(projectUpdates.visibility, "public"),
        isNull(projectUpdates.deletedAt),
        // The project's own rules: visibility, status, deleted owner, a block with the owner, status/type/skill/Following filters.
        ...buildBaseConditions({ ...filters, search: undefined }, view, viewerId),
        updatesTabVisible(viewerId),
    ];
    if (viewerId) {
        // Neither side of a block sees the other's posts.
        conditions.push(sql<boolean>`NOT EXISTS (
            SELECT 1 FROM connections blocked_author
            WHERE blocked_author.status = 'blocked'
              AND ((blocked_author.requester_id = ${viewerId} AND blocked_author.addressee_id = ${projectUpdates.authorId})
                OR (blocked_author.requester_id = ${projectUpdates.authorId} AND blocked_author.addressee_id = ${viewerId}))
        )`);
    }
    return conditions;
}

function searchCondition(search: string | undefined): SQL<unknown> | null {
    const text = search?.trim();
    if (!text) return null;
    const projectMatch = buildSearchConditions(text);
    const inUpdate = ilike(projectUpdates.content, containsLikePattern(text));
    return projectMatch.length > 0 ? or(and(...projectMatch), inUpdate)! : inUpdate;
}

function selectUpdateRows(viewerId: string | null) {
    return db
        .select({
            id: projectUpdates.id,
            projectId: projectUpdates.projectId,
            authorId: projectUpdates.authorId,
            content: projectUpdates.content,
            updateType: projectUpdates.updateType,
            replyPolicy: projectUpdates.replyPolicy,
            media: projectUpdates.media,
            metadata: projectUpdates.metadata,
            isPinned: projectUpdates.isPinned,
            likeCount: projectUpdates.likeCount,
            commentCount: projectUpdates.commentCount,
            editedAt: projectUpdates.editedAt,
            createdAt: projectUpdates.createdAt,
            // Microseconds as Postgres stores them: the cursor must name the exact row.
            cursorAt: sql<string>`${projectUpdates.createdAt}::text`,
            projectTitle: projects.title,
            projectSlug: projects.slug,
            projectCoverImage: projects.coverImage,
            projectOwnerId: projects.ownerId,
            authorFullName: profiles.fullName,
            authorUsername: profiles.username,
            authorAvatarUrl: profiles.avatarUrl,
            authorMembershipRole: projectMembers.role,
            authorReadable: sql<boolean>`coalesce(${readableProfileIdentitySql(viewerId)}, false)`,
            viewerIsTeam: viewerId
                ? sql<boolean>`(${projects.ownerId} = ${viewerId} OR EXISTS (SELECT 1 FROM project_members viewer_member WHERE viewer_member.project_id = ${projects.id} AND viewer_member.user_id = ${viewerId}))`
                : sql<boolean>`false`,
        })
        .from(projectUpdates)
        .innerJoin(projects, eq(projects.id, projectUpdates.projectId))
        .leftJoin(profiles, eq(profiles.id, projectUpdates.authorId))
        .leftJoin(
            projectMembers,
            and(eq(projectMembers.projectId, projectUpdates.projectId), eq(projectMembers.userId, projectUpdates.authorId)),
        );
}

type Row = Awaited<ReturnType<typeof selectUpdateRows>>[number];

async function hydrate(rows: Row[], viewerId: string | null): Promise<DiscoverUpdateView[]> {
    if (rows.length === 0) return [];
    const [likedRows, roleTitles] = await Promise.all([
        viewerId
            ? db
                .select({ updateId: projectUpdateLikes.updateId })
                .from(projectUpdateLikes)
                .where(and(eq(projectUpdateLikes.userId, viewerId), inArray(projectUpdateLikes.updateId, rows.map((row) => row.id))))
            : Promise.resolve([] as Array<{ updateId: string }>),
        // A masked author's role is not looked up at all.
        readProjectRoleTitles(rows.filter((row) => row.authorReadable).map((row) => ({ projectId: row.projectId, userId: row.authorId }))),
    ]);
    const liked = new Set(likedRows.map((row) => row.updateId));

    return rows.map((row) => {
        const isAuthor = Boolean(viewerId && row.authorId === viewerId);
        const memberRole = row.authorId === row.projectOwnerId ? "owner" : normalizeProjectMemberRole(row.authorMembershipRole, "member");
        const display = row.authorReadable && row.authorId
            ? resolveProjectUpdateAuthorRoleDisplay({
                snapshot: normalizeProjectUpdateAuthorRoleSnapshot((row.metadata as { authorRoleSnapshot?: unknown } | null)?.authorRoleSnapshot),
                projectRoleTitle: roleTitles.get(roleTitleKey(row.projectId, row.authorId)),
                membershipRoleLabel: getProjectMemberRoleLabel(memberRole),
            })
            : null;
        // A card says what someone does, so a bare "Member" or "Viewer" says nothing and is left out.
        const roleLabel = display?.roleLabel && display.roleLabel !== "Member" && display.roleLabel !== "Viewer" ? display.roleLabel : null;
        const masked = !row.authorReadable;
        return {
            id: row.id,
            projectId: row.projectId,
            projectName: row.projectTitle,
            projectSlug: row.projectSlug,
            projectCoverImage: row.projectCoverImage,
            author: row.authorId
                ? {
                    id: row.authorId,
                    fullName: masked ? null : row.authorFullName,
                    username: masked ? null : row.authorUsername,
                    avatarUrl: masked ? null : row.authorAvatarUrl,
                    roleLabel: masked ? null : roleLabel,
                    masked,
                }
                : null,
            content: row.content,
            updateType: normalizeProjectUpdateType(row.updateType),
            // Only what the card draws. The bucket, storage key and asset id never leave the server.
            media: normalizeProjectUpdateMediaItems(row.media).map((item) => ({
                type: item.type,
                url: item.url ?? null,
                label: item.label ?? null,
                altText: item.altText ?? null,
                mimeType: item.mimeType ?? null,
                size: item.size ?? null,
                width: item.width ?? null,
                height: item.height ?? null,
            })),
            isPinned: Boolean(row.isPinned),
            likeCount: Math.max(0, row.likeCount ?? 0),
            commentCount: Math.max(0, row.commentCount ?? 0),
            likedByViewer: liked.has(row.id),
            replyPolicy: row.replyPolicy === "members" ? "members" : "logged_in",
            // The server re-checks every write; this only decides what the panel offers.
            canComment: Boolean(viewerId) && (row.replyPolicy !== "members" || row.viewerIsTeam),
            canEdit: isAuthor,
            canDelete: isAuthor || Boolean(viewerId && viewerId === row.projectOwnerId),
            editedAt: row.editedAt ? row.editedAt.toISOString() : null,
            createdAt: row.createdAt.toISOString(),
        };
    });
}

/**
 * One page of public project updates for the Discover feed, newest first. It shows only what the project page
 * would show the same viewer, follows the card feed's filters, and takes at most one update per project and
 * two per author so one busy team can't fill a page. A failure throws: "no updates" and "couldn't read" differ.
 */
export async function getDiscoverUpdatesPage(options: DiscoverUpdatesQueryOptions = {}): Promise<DiscoverUpdatesPage> {
    const { filters = DEFAULT_FILTERS, view = FILTER_VIEWS.ALL, cursor = null } = options;
    const viewerId = options.viewerId ?? null;
    const limit = Math.min(Math.max(1, Math.trunc(options.limit ?? MAX_PAGE)), MAX_PAGE);
    // Following needs someone to follow as.
    if (view === FILTER_VIEWS.FOLLOWING && !viewerId) return { updates: [], nextCursor: null };

    const conditions = visibilityConditions(filters, view, viewerId);
    const search = searchCondition(filters.search);
    if (search) conditions.push(search);
    if (cursor) {
        const after = decodeCursor(cursor);
        conditions.push(sql<boolean>`(${projectUpdates.createdAt}, ${projectUpdates.id}) < (${after.at}::timestamptz, ${after.id}::uuid)`);
    }

    const scan = limit * SCAN_FACTOR;
    const rows = await selectUpdateRows(viewerId)
        .where(and(...conditions))
        .orderBy(desc(projectUpdates.createdAt), desc(projectUpdates.id))
        .limit(scan);

    const taken: Row[] = [];
    const projectsSeen = new Set<string>();
    const authorCounts = new Map<string, number>();
    let lastScanned: Row | undefined;
    for (const row of rows) {
        lastScanned = row;
        const authorKey = row.authorId ?? "";
        if (projectsSeen.has(row.projectId) || (authorCounts.get(authorKey) ?? 0) >= PER_AUTHOR_PER_PAGE) continue;
        projectsSeen.add(row.projectId);
        authorCounts.set(authorKey, (authorCounts.get(authorKey) ?? 0) + 1);
        taken.push(row);
        if (taken.length === limit) break;
    }
    // More to read if this page filled, or the scan ran the whole window without filling it.
    const more = taken.length === limit || rows.length === scan;
    return {
        updates: await hydrate(taken, viewerId),
        nextCursor: more && lastScanned ? encodeCursor({ at: lastScanned.cursorAt, id: lastScanned.id }) : null,
    };
}

/** One update by id, under exactly the list's rules (a link to a private project's update finds nothing). */
export async function getDiscoverUpdate(updateId: string, viewerId: string | null = null): Promise<DiscoverUpdateView | null> {
    if (!UUID.test(updateId)) return null;
    // A single update is reachable even when the viewer's filters wouldn't list it, so only the visibility rules apply.
    const rows = await selectUpdateRows(viewerId)
        .where(and(...visibilityConditions(DEFAULT_FILTERS, FILTER_VIEWS.ALL, viewerId), eq(projectUpdates.id, updateId)))
        .limit(1);
    return (await hydrate(rows, viewerId))[0] ?? null;
}

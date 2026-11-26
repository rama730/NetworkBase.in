import "server-only";

import { sql, type SQL } from "drizzle-orm";

import { db } from "@/lib/db";
import { DEFAULT_FILTERS, buildSearchConditions } from "@/lib/data/discover";
import { getDiscoverUpdatesPage } from "@/lib/data/discover-updates";
import { discoverListedSql, orgQualifiesSql } from "@/lib/discover/listed-sql";
import { searchMessagesAs } from "@/lib/messaging/search-messages";
import { messageHref } from "@/lib/messaging/routes";
import { profileHref } from "@/lib/routing/identifiers";
import { buildWorkspaceDocPlainText } from "@/lib/workspaces/doc-plain-text";
import { containsLikePattern, escapeLikePattern, normalizeSearchQuery, tokenizeSearchQuery } from "@/lib/search/query";

import { peopleFindableSql } from "./people-rule";
import { matchScore } from "./rank";
import type { SearchHit } from "./types";

const DAY = 86_400_000;
const isNew = (at: string | Date | null) => Boolean(at && Date.now() - new Date(at).getTime() < 7 * DAY);
const iso = (at: unknown) => (at ? new Date(at as string).toISOString() : null);
const firstToken = (q: string) => tokenizeSearchQuery(q)[0] ?? q;
const and = (parts: SQL[]) => (parts.length ? sql.join(parts, sql` AND `) : sql`true`);
const rows = <T>(result: unknown) => result as unknown as T[];

/** Every kind gives up after 3 s, like message search (LOAD-06), so a broad word can't hold a pool connection. */
async function timed(query: SQL): Promise<unknown> {
    return db.transaction(async (tx) => {
        await tx.execute(sql.raw("SET LOCAL statement_timeout = '3s'"));
        return tx.execute(query);
    });
}

/** exact 0 · prefix 1 · a word starts with it 2 · contains 3 · else 4, in SQL so ranking happens before the LIMIT. */
function nameRank(column: SQL, q: string): SQL {
    const value = normalizeSearchQuery(q).toLowerCase();
    const escaped = escapeLikePattern(value);
    return sql`(CASE WHEN lower(${column}) = ${value} THEN 0
        WHEN lower(${column}) LIKE ${`${escaped}%`} THEN 1
        WHEN ' ' || lower(${column}) LIKE ${`% ${escaped}%`} THEN 2
        WHEN lower(${column}) LIKE ${`%${escaped}%`} THEN 3 ELSE 4 END)`;
}

/** `profiles.skills` is jsonb: some rows hold a string or an object, never trust it to be a list (live check 2026-11-27). */
const skillList = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);

type PlaceRow = {
    id: string; title: string; slug: string | null; kind: "workspace" | "organization"; short_description: string | null;
    description: string | null; org_type: string | null; created_at: string; followers_count: number; open_roles_count: number;
    looking_for_collaborators: boolean | null; last_update_at: string | null; updated_by: string | null; mine: boolean;
    matched_skill: string | null; skills: string[] | null; cover_image: string | null;
};

/** Organizations or workspaces: public ones Discover lists, and any you're in (never unlisted from search, decision 1). */
export async function searchPlaces(viewerId: string, q: string, kind: "workspace" | "organization", limit: number): Promise<SearchHit[]> {
    const match = buildSearchConditions(q);
    if (!match.length) return [];
    const mine = sql`(workspaces.owner_id = ${viewerId}::uuid OR EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = workspaces.id AND m.user_id = ${viewerId}::uuid))`;
    const inParent = sql`(workspaces.visibility = 'org' AND workspaces.parent_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM workspaces o WHERE o.id = workspaces.parent_id AND (o.owner_id = ${viewerId}::uuid
            OR EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = o.id AND m.user_id = ${viewerId}::uuid))))`;
    const pattern = containsLikePattern(firstToken(q));
    const result = await timed(sql`
        SELECT workspaces.id, workspaces.title, workspaces.slug, workspaces.kind, workspaces.short_description, workspaces.description,
               workspaces.org_type, workspaces.created_at, workspaces.followers_count, workspaces.open_roles_count,
               workspaces.looking_for_collaborators, workspaces.last_update_at, workspaces.cover_image,
               (SELECT coalesce(u.full_name, u.username) FROM profiles u WHERE u.id = coalesce(workspaces.last_update_by, workspaces.owner_id)) AS updated_by,
               ${mine} AS mine,
               (SELECT s.name FROM workspace_skills ps JOIN skills s ON s.id = ps.skill_id WHERE ps.workspace_id = workspaces.id AND s.name ILIKE ${pattern} LIMIT 1) AS matched_skill,
               -- The skill that matched comes first, so "Only things tagged X" keeps this card (live check).
               to_jsonb(ARRAY(SELECT s.name FROM workspace_skills ps JOIN skills s ON s.id = ps.skill_id WHERE ps.workspace_id = workspaces.id
                   ORDER BY (s.name ILIKE ${pattern}) DESC, s.name LIMIT 4)) AS skills
        FROM workspaces
        WHERE workspaces.kind = ${kind} AND workspaces.deleted_at IS NULL AND workspaces.status <> 'draft'
          AND ${discoverListedSql()}
          AND EXISTS (SELECT 1 FROM profiles owner WHERE owner.id = workspaces.owner_id AND owner.deleted_at IS NULL)
          AND NOT app_private.blocked_between(${viewerId}::uuid, workspaces.owner_id)
          AND ((workspaces.visibility = 'public' AND ${orgQualifiesSql()}) OR ${mine} OR ${inParent})
          AND ${and(match as SQL[])}
        ORDER BY ${nameRank(sql`workspaces.title`, q)}, workspaces.followers_count DESC, workspaces.created_at DESC
        LIMIT ${limit}`);
    return rows<PlaceRow>(result).map((row) => {
        const isOrg = row.kind === "organization";
        const titleMatches = matchScore(row.title, q) < 4;
        const description = row.short_description || row.description || "";
        const why = titleMatches ? null
            : row.matched_skill ? `Skill · ${row.matched_skill}`
                : description.toLocaleLowerCase().includes(firstToken(q).toLocaleLowerCase()) ? "In the description"
                    : row.updated_by?.toLocaleLowerCase().includes(firstToken(q).toLocaleLowerCase()) ? `Updated by ${row.updated_by}` : null;
        return {
            id: `${isOrg ? "org" : "ws"}:${row.id}`,
            kind: isOrg ? "orgs" : "workspaces",
            title: row.title,
            sub: isOrg ? description || "Organization" : description || "Workspace",
            href: isOrg ? `/org/${encodeURIComponent(row.slug ?? row.id)}` : `/workspaces/${encodeURIComponent(row.slug ?? row.id)}`,
            why,
            score: matchScore(row.title, q),
            createdAt: iso(row.created_at),
            avatarUrl: row.cover_image,
            tags: skillList(row.skills),
            act: row.mine ? "Open" : "Follow",
            meta: {
                orgType: row.org_type, followers: Number(row.followers_count) || 0, openRoles: Number(row.open_roles_count) || 0,
                openToCollaborate: Boolean(row.looking_for_collaborators), isNew: isNew(row.created_at), mine: Boolean(row.mine),
                updatedBy: row.updated_by, updatedAt: iso(row.last_update_at), entityId: row.id,
            },
        } satisfies SearchHit;
    }).sort((a, b) => a.score - b.score);
}

/** Posts (workspace updates) with Discover's own rules; search never reaches unlisted workspaces' posts. */
export async function searchPosts(viewerId: string, q: string, limit: number): Promise<SearchHit[]> {
    const page = await getDiscoverUpdatesPage({ filters: { ...DEFAULT_FILTERS, search: q }, viewerId, limit });
    // ponytail: posts are capped at the updates feed's page (12). Upgrade: a cursor loop if people want more.
    return page.updates.map((update) => {
        const author = update.author?.fullName || update.author?.username || update.projectName;
        return {
            id: `post:${update.id}`,
            kind: "posts",
            title: author,
            // Plain text: embedded task, file and project references ({% ref.… %}) are not for reading (live check).
            sub: buildWorkspaceDocPlainText(update.content, { maxLength: 220 }) || update.content.replace(/\s+/g, " ").slice(0, 220),
            href: `/discover?updateId=${encodeURIComponent(update.id)}`,
            why: null,
            score: 3,
            createdAt: update.createdAt,
            avatarUrl: update.author?.avatarUrl ?? null,
            tags: [],
            act: null,
            meta: { place: update.projectName, likes: update.likeCount, isNew: isNew(update.createdAt), entityId: update.id },
        } satisfies SearchHit;
    });
}

type PersonRow = {
    id: string; username: string | null; full_name: string | null; headline: string | null; location: string | null; avatar_url: string | null;
    skills: string[] | null; created_at: string; open_to_collaborate: boolean | null; connected: boolean; pending: boolean;
    mutual: number; mutual_names: string[] | null; shared_place: string | null;
};

/** The words matched against a person: name, username, headline, location, skills and interests (as Network's search). */
function personMatch(q: string): SQL {
    const words = tokenizeSearchQuery(q);
    return and(words.map((word) => {
        const pattern = containsLikePattern(word);
        return sql`(p.full_name ILIKE ${pattern} OR p.username ILIKE ${pattern} OR p.headline ILIKE ${pattern} OR p.location ILIKE ${pattern}
            OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(p.skills) = 'array' THEN p.skills ELSE '[]'::jsonb END) AS s(v) WHERE s.v ILIKE ${pattern})
            OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(p.interests) = 'array' THEN p.interests ELSE '[]'::jsonb END) AS i(v) WHERE i.v ILIKE ${pattern}))`;
    }));
}

const personSelect = (viewerId: string) => sql`
    p.id, p.username, p.full_name, p.headline, p.location, p.avatar_url, p.skills, p.created_at, p.open_to_collaborate,
    EXISTS (SELECT 1 FROM connections c WHERE c.status = 'accepted' AND ((c.requester_id = ${viewerId}::uuid AND c.addressee_id = p.id) OR (c.requester_id = p.id AND c.addressee_id = ${viewerId}::uuid))) AS connected,
    EXISTS (SELECT 1 FROM connections c WHERE c.status = 'pending' AND ((c.requester_id = ${viewerId}::uuid AND c.addressee_id = p.id) OR (c.requester_id = p.id AND c.addressee_id = ${viewerId}::uuid))) AS pending,
    (SELECT count(*)::int FROM friends vf JOIN connections pc ON pc.status = 'accepted'
        AND ((pc.requester_id = p.id AND pc.addressee_id = vf.id) OR (pc.addressee_id = p.id AND pc.requester_id = vf.id))) AS mutual,
    to_jsonb(ARRAY(SELECT coalesce(fp.full_name, fp.username) FROM friends vf JOIN connections pc ON pc.status = 'accepted'
        AND ((pc.requester_id = p.id AND pc.addressee_id = vf.id) OR (pc.addressee_id = p.id AND pc.requester_id = vf.id))
        JOIN profiles fp ON fp.id = vf.id LIMIT 2)) AS mutual_names,
    (SELECT w.title FROM app_private.search_places(p.id) a JOIN viewer_places b ON b.id = a
        JOIN workspaces w ON w.id = a WHERE w.deleted_at IS NULL ORDER BY w.kind DESC, w.title LIMIT 1) AS shared_place`;

/** The viewer's connections and places, worked out once per query. */
const friendsCte = (viewerId: string) => sql`friends AS (
    SELECT CASE WHEN c.requester_id = ${viewerId}::uuid THEN c.addressee_id ELSE c.requester_id END AS id
    FROM connections c WHERE c.status = 'accepted' AND (c.requester_id = ${viewerId}::uuid OR c.addressee_id = ${viewerId}::uuid)),
    viewer_places AS MATERIALIZED (SELECT app_private.search_places(${viewerId}::uuid) AS id)`;

function toPersonHit(row: PersonRow, q: string): SearchHit {
    const name = row.full_name || row.username || "Person";
    const skills = skillList(row.skills);
    const word = firstToken(q).toLocaleLowerCase();
    const skill = skills.find((value) => value.toLocaleLowerCase().includes(word));
    const nameMatches = matchScore(name, q) < 4 || Boolean(row.username?.toLocaleLowerCase().includes(word));
    const mutual = Number(row.mutual) || 0;
    const relation = row.connected ? "Your connection"
        : row.shared_place ? `Works with you in ${row.shared_place}`
            : mutual ? `${mutual} mutual · ${skillList(row.mutual_names).join(", ")}` : null;
    return {
        id: `person:${row.id}`,
        kind: "people",
        title: name,
        sub: [row.headline, row.location].filter(Boolean).join(" · ") || "NetworkBase member",
        href: profileHref({ id: row.id, username: row.username }),
        why: nameMatches ? null : skill ? `Skill · ${skill}` : row.location?.toLocaleLowerCase().includes(word) ? `Location · ${row.location}` : null,
        score: Math.min(matchScore(name, q), row.username?.toLocaleLowerCase() === word ? 0 : 4),
        createdAt: iso(row.created_at),
        avatarUrl: row.avatar_url,
        tags: [...skills.filter((value) => value.toLocaleLowerCase().includes(word)), ...skills.filter((value) => !value.toLocaleLowerCase().includes(word))].slice(0, 4),
        act: row.connected ? "Message" : row.pending ? "Pending" : "Connect",
        meta: {
            userId: row.id, username: row.username, location: row.location, mutual, relation,
            relKey: row.connected ? "conn" : mutual ? "second" : "any", openCollab: Boolean(row.open_to_collaborate), headline: row.headline,
        },
    };
}

/** People the viewer may find (0165 rule), connections and strangers alike. */
export async function searchPeople(viewerId: string, q: string, limit: number): Promise<SearchHit[]> {
    if (!tokenizeSearchQuery(q).length) return [];
    // Matches first (cheap), then the privacy rule on those only, then each row's mutuals and shared place for the
    // rows shown. ponytail: the rule sees the best 400 matches; a hidden 401st can't be replaced. Upgrade if counts matter.
    const result = await timed(sql`
        WITH ${friendsCte(viewerId)},
        candidates AS MATERIALIZED (
            SELECT p.id, LEAST(${nameRank(sql`p.full_name`, q)}, CASE WHEN lower(p.username) = ${normalizeSearchQuery(q).toLowerCase()} THEN 0 ELSE 4 END) AS rank,
                   p.followers_count AS followers, p.created_at AS created
            FROM profiles p
            WHERE ${personMatch(q)} AND p.deleted_at IS NULL AND p.onboarding_status = 'completed'
            ORDER BY rank, followers DESC NULLS LAST, created DESC
            LIMIT 400
        ),
        shown AS MATERIALIZED (
            SELECT c.* FROM candidates c JOIN profiles p ON p.id = c.id
            WHERE ${peopleFindableSql(viewerId)}
            ORDER BY c.rank, c.followers DESC NULLS LAST, c.created DESC
            LIMIT ${limit}
        )
        SELECT ${personSelect(viewerId)}
        FROM shown JOIN profiles p ON p.id = shown.id
        ORDER BY shown.rank, shown.followers DESC NULLS LAST, shown.created DESC`);
    return rows<PersonRow>(result).map((row) => toPersonHit(row, q)).sort((a, b) => a.score - b.score);
}

/** "Find me by email address" (Settings › Privacy): only a person who turned it on; anything else is an invite row. */
export async function searchEmail(viewerId: string, address: string): Promise<SearchHit | null> {
    const result = await timed(sql`
        WITH ${friendsCte(viewerId)}
        SELECT ${personSelect(viewerId)}
        FROM profiles p
        WHERE lower(p.email) = lower(${address}) AND p.findable_by_email AND ${peopleFindableSql(viewerId)}
        LIMIT 1`);
    const row = rows<PersonRow>(result)[0];
    return row ? toPersonHit(row, row.full_name ?? address) : null;
}

/** Messages from conversations you're in, newest first. */
export async function searchMessageHits(viewerId: string, q: string, limit: number): Promise<SearchHit[]> {
    if (q.trim().length < 2) return [];
    const hits = await searchMessagesAs(viewerId, { query: q, limit });
    return hits.map((hit) => {
        const place = hit.channel_name ? `#${hit.channel_name}` : hit.people_name || "Direct message";
        const who = hit.author?.full_name || hit.author?.username || "Someone";
        return {
            id: `msg:${hit.channel_id}:${hit.seq}`,
            kind: "messages",
            title: who,
            sub: hit.body.replace(/\s+/g, " ").slice(0, 220),
            href: messageHref(hit.channel_id, hit.seq, hit.thread_root_seq),
            why: null,
            score: 3,
            createdAt: iso(hit.created_at),
            avatarUrl: hit.author?.avatar_url ?? null,
            tags: [],
            act: null,
            meta: { channelId: hit.channel_id, channelName: hit.channel_name ?? hit.people_name ?? null, place, author: who, hasFile: hit.has_file, project: hit.project_title },
        } satisfies SearchHit;
    });
}

/** `#` in the box: channels you're in. */
export async function searchChannels(viewerId: string, q: string, limit: number): Promise<SearchHit[]> {
    const result = await timed(sql`
        SELECT c.id, c.name, w.title AS project_title
        FROM chat_channel_members mem JOIN chat_channels c ON c.id = mem.channel_id LEFT JOIN workspaces w ON w.id = c.workspace_id
        WHERE mem.user_id = ${viewerId}::uuid AND c.name IS NOT NULL AND c.name ILIKE ${containsLikePattern(q || "")}
        ORDER BY (c.name ILIKE ${`${escapeLikePattern(q)}%`}) DESC, c.name LIMIT ${limit}`);
    return rows<{ id: string; name: string; project_title: string | null }>(result).map((row) => ({
        id: `channel:${row.id}`, kind: "channels", title: `#${row.name}`, sub: row.project_title ?? "Channel",
        href: `/messages/${row.id}`, why: null, score: matchScore(row.name, q), createdAt: null, avatarUrl: null, tags: [], act: null,
        meta: { channelId: row.id },
    }));
}

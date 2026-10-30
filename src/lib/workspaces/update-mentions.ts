import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { readableProfileIdentitySql } from "@/lib/privacy/resolver";

const MAX_MENTIONS = 5;
const MENTION = /(?:^|[^a-zA-Z0-9_@./])@([a-zA-Z0-9_]+)/g;

/** The usernames a comment names, the same `@username` the comment text links. A comment reaches five people at most. */
export function parseMentionUsernames(content: string) {
    return [...new Set([...content.matchAll(MENTION)].map((match) => match[1]!.toLowerCase()))].slice(0, MAX_MENTIONS);
}

export type MentionablePerson = { id: string; username: string; fullName: string | null; avatarUrl: string | null };

/**
 * Who can be mentioned on a post: the team, its author, people in the thread and your connections, so a stranger can't
 * ping anyone by guessing a username. They must also be able to open the post, and you must be able to see them.
 */
function mentionablePeople(updateId: string, actorId: string, match: ReturnType<typeof sql>, limit: number) {
    const onTeam = sql`(profiles.id = w.owner_id OR EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = w.id AND m.user_id = profiles.id))`;
    const isAdmin = sql`(profiles.id = w.owner_id OR EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = w.id AND m.user_id = profiles.id AND m.role IN ('owner', 'admin')))`;
    return db.execute(sql`
        SELECT profiles.id, profiles.username, profiles.full_name AS "fullName", profiles.avatar_url AS "avatarUrl"
        FROM workspace_updates u
        JOIN workspaces w ON w.id = u.workspace_id
        JOIN profiles ON true
        WHERE u.id = ${updateId}::uuid AND profiles.username IS NOT NULL AND profiles.id <> ${actorId}::uuid
          AND ${readableProfileIdentitySql(actorId)}
          AND (${onTeam} OR profiles.id = u.author_id
            OR EXISTS (SELECT 1 FROM workspace_update_comments c WHERE c.update_id = u.id AND c.user_id = profiles.id AND c.deleted_at IS NULL)
            OR EXISTS (SELECT 1 FROM connections c WHERE c.status = 'accepted'
                AND ((c.requester_id = ${actorId}::uuid AND c.addressee_id = profiles.id) OR (c.addressee_id = ${actorId}::uuid AND c.requester_id = profiles.id))))
          AND CASE
            WHEN coalesce(u.audience, '{}'::jsonb) <> '{}'::jsonb THEN ${isAdmin}
            WHEN u.visibility = 'public' AND w.visibility = 'public' AND w.public_tab_visibility->'updates' IS DISTINCT FROM 'false'::jsonb THEN true
            ELSE ${onTeam}
          END
          AND ${match}
        ORDER BY ${onTeam} DESC, profiles.username
        LIMIT ${limit}`) as unknown as Promise<MentionablePerson[]>;
}

export async function resolveMentionedIds(updateId: string, actorId: string, content: string) {
    const usernames = parseMentionUsernames(content);
    if (usernames.length === 0) return [];
    const rows = await mentionablePeople(updateId, actorId,
        sql`lower(profiles.username) IN (SELECT value FROM jsonb_array_elements_text(${JSON.stringify(usernames)}::jsonb))`, MAX_MENTIONS);
    return rows.map((row) => row.id);
}

export function searchMentionablePeople(updateId: string, actorId: string, query: string) {
    const like = `${query.toLowerCase().replace(/[\\%_]/g, "\\$&")}%`;
    return mentionablePeople(updateId, actorId,
        sql`(lower(profiles.username) LIKE ${like} OR lower(coalesce(profiles.full_name, '')) LIKE ${like} OR lower(coalesce(profiles.full_name, '')) LIKE ${`% ${like}`})`, 8);
}

import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { readableProfileIdentitySql } from "@/lib/privacy/resolver";

export type UpdateCommentPreview = { id: string; authorName: string; authorUsername: string | null; content: string; likeCount: number };
export type UpdatePreview = { likedByName: string | null; comments: UpdateCommentPreview[] };

/** What a post card shows under the text, in one query for the whole page: who liked it and two comments (UP9). */
export async function readUpdatePreviews(updateIds: string[], viewerId: string | null) {
    const previews = new Map<string, UpdatePreview>();
    if (updateIds.length === 0) return previews;
    const readable = readableProfileIdentitySql(viewerId);
    // Not from someone in a block with you, or someone you muted.
    const notHidden = viewerId
        ? sql`NOT app_private.blocked_between(${viewerId}::uuid, c.user_id)
            AND NOT EXISTS (SELECT 1 FROM user_mutes m WHERE m.muter_id = ${viewerId}::uuid AND m.muted_id = c.user_id)`
        : sql`true`;
    const rows = await db.execute(sql`
        SELECT u.id,
            (SELECT coalesce(profiles.full_name, profiles.username) FROM workspace_update_likes l JOIN profiles ON profiles.id = l.user_id
                WHERE l.update_id = u.id AND l.user_id IS DISTINCT FROM ${viewerId}::uuid AND ${readable}
                ORDER BY l.created_at DESC, l.id DESC LIMIT 1) AS liked_by_name,
            (SELECT coalesce(jsonb_agg(x), '[]'::jsonb) FROM (
                SELECT c.id, c.content, 0 AS "likeCount",
                    CASE WHEN ${readable} THEN coalesce(profiles.full_name, profiles.username, 'Member') ELSE 'Private member' END AS "authorName",
                    CASE WHEN ${readable} THEN profiles.username END AS "authorUsername"
                FROM workspace_update_comments c JOIN profiles ON profiles.id = c.user_id
                WHERE c.update_id = u.id AND c.deleted_at IS NULL AND c.parent_id IS NULL AND ${notHidden}
                ORDER BY c.created_at DESC, c.id DESC LIMIT 2
            ) x) AS comments
        FROM workspace_updates u
        WHERE u.id IN (SELECT value::uuid FROM jsonb_array_elements_text(${JSON.stringify(updateIds)}::jsonb))`) as unknown as Array<{ id: string; liked_by_name: string | null; comments: UpdateCommentPreview[] }>;
    for (const row of rows) previews.set(row.id, { likedByName: row.liked_by_name, comments: row.comments });
    return previews;
}

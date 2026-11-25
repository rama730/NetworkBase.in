import { sql, type SQL } from "drizzle-orm";

import { CHAT_PAGE_SIZE } from "@/lib/messaging/constants";
import { chatRows } from "@/lib/messaging/server";
import type { ChatMessageView } from "@/lib/messaging/types";

/**
 * Message rows with attachments, grouped reactions, card ref, pin flag and
 * author, for one channel. Every lookup is a partition-pruned PK prefix scan.
 * The caller supplies the filter and order; access (member, or project member
 * previewing a public channel) is checked here.
 */
export async function selectMessages(viewerId: string, channelId: string, filter: SQL, order: SQL, limit: number) {
  const rows = await chatRows<ChatMessageView>(sql`
    SELECT m.channel_id, m.channel_seq::int AS seq, m.author_id, m.kind, m.body, m.thread_root_seq::int AS thread_root_seq,
           m.reply_count, m.last_reply_seq::int AS last_reply_seq, m.last_reply_at, m.edited_at, m.deleted_at, m.link_preview_hidden,
           m.created_at, m.client_message_id,
           -- The thread link's faces: up to 3 people who replied most recently (the thread index serves it). No block
           -- filter here: their replies show in the thread, so leaving them out would hint at who blocked you; the row
           -- hides only people you blocked.
           CASE WHEN m.reply_count > 0 THEN (
             SELECT jsonb_agg(x.author_id ORDER BY x.last_seq DESC) FROM (
               SELECT r.author_id, max(r.channel_seq) AS last_seq FROM chat_messages r
               WHERE r.channel_id = m.channel_id AND r.thread_root_seq = m.channel_seq AND r.deleted_at IS NULL AND r.author_id IS NOT NULL
               GROUP BY r.author_id ORDER BY last_seq DESC LIMIT 3
             ) x
           ) END AS last_repliers,
           CASE WHEN pr.id IS NULL THEN NULL ELSE jsonb_build_object(
             'id', pr.id, 'username', pr.username, 'full_name', pr.full_name, 'avatar_url', pr.avatar_url,
             'project_membership_role', pm.role,
             'project_role_title', coalesce(ra.accepted_role_title, pr.headline)
           ) END AS author,
           coalesce((
             SELECT jsonb_agg(jsonb_build_object('idx', a.idx, 'asset_id', a.asset_id, 'name', a.name, 'mime', a.mime,
                                                 'size', a.size, 'width', a.width, 'height', a.height,
                                                 'thumb_asset_id', a.thumb_asset_id, 'preview', a.preview, 'duration_ms', a.duration_ms, 'peaks', a.peaks) ORDER BY a.idx)
             FROM chat_attachments a WHERE a.channel_id = m.channel_id AND a.message_seq = m.channel_seq
           ), '[]'::jsonb) AS attachments,
           coalesce((
             SELECT jsonb_agg(jsonb_build_object('emoji', r.emoji, 'count', r.n, 'me', r.me,
                    -- Poll votes carry their voters (newest first, never someone blocked), so the card can count people.
                    'user_ids', CASE WHEN m.body LIKE '📊 **Poll: %' THEN (
                      SELECT jsonb_agg(w.user_id) FROM (
                        SELECT v.user_id FROM chat_reactions v
                        WHERE v.channel_id = m.channel_id AND v.message_seq = m.channel_seq AND v.emoji = r.emoji
                          AND NOT app_private.chat_is_blocked(${viewerId}::uuid, v.user_id)
                        ORDER BY v.created_at DESC LIMIT 200
                      ) w
                    ) END) ORDER BY r.first_at)
             FROM (
               SELECT emoji, count(*)::int AS n, bool_or(user_id = ${viewerId}::uuid) AS me, min(created_at) AS first_at
               FROM chat_reactions WHERE channel_id = m.channel_id AND message_seq = m.channel_seq
               GROUP BY emoji
             ) r
           ), '[]'::jsonb) AS reactions,
           (SELECT jsonb_build_object('kind', c.kind, 'ref_id', c.ref_id)
              FROM chat_message_cards c WHERE c.channel_id = m.channel_id AND c.message_seq = m.channel_seq) AS card,
           EXISTS (SELECT 1 FROM chat_pins p WHERE p.channel_id = m.channel_id AND p.message_seq = m.channel_seq) AS pinned
    FROM chat_messages m
    JOIN chat_channels ch ON ch.id = m.channel_id
    LEFT JOIN profiles pr ON pr.id = m.author_id
    LEFT JOIN workspace_members pm ON pm.workspace_id = ch.workspace_id AND pm.user_id = m.author_id
    LEFT JOIN role_applications ra ON ra.workspace_id = ch.workspace_id AND ra.applicant_id = m.author_id AND ra.status = 'accepted'
    WHERE m.channel_id = ${channelId}::uuid
      AND (
        app_private.chat_is_member(${channelId}::uuid, ${viewerId}::uuid)
        -- Project members may read a public channel before joining it (Slack preview).
        OR EXISTS (
          SELECT 1 FROM chat_channels pc
          WHERE pc.id = ${channelId}::uuid AND pc.kind = 'public' AND pc.archived_at IS NULL
            AND app_private.chat_is_workspace_member(pc.workspace_id, ${viewerId}::uuid)
        )
      )
      AND ${filter}
    ORDER BY ${order}
    LIMIT ${limit}
  `);
  // Driver timestamps may be Dates or SQL text; actions and Broadcast use canonical ISO strings.
  const timestamp = (value: string | Date | null) => value === null ? null : new Date(value instanceof Date ? value.getTime() : value).toISOString();
  return rows.map((row) => ({ ...row, created_at: timestamp(row.created_at)!, edited_at: timestamp(row.edited_at), deleted_at: timestamp(row.deleted_at), last_reply_at: timestamp(row.last_reply_at) }));
}

/** A page of top-level messages: the newest, before a seq, or around a seq (deep links). */
export async function listTopLevel(viewerId: string, channelId: string, cursor: { before?: number; around?: number }) {
  const top = sql`m.thread_root_seq IS NULL`;
  if (cursor.around !== undefined) {
    const half = Math.floor(CHAT_PAGE_SIZE / 2);
    const [older, newer] = await Promise.all([
      selectMessages(viewerId, channelId, sql`${top} AND m.channel_seq <= ${cursor.around}`, sql`m.channel_seq DESC`, half),
      selectMessages(viewerId, channelId, sql`${top} AND m.channel_seq > ${cursor.around}`, sql`m.channel_seq ASC`, half),
    ]);
    return [...older.reverse(), ...newer];
  }
  const filter = cursor.before !== undefined ? sql`${top} AND m.channel_seq < ${cursor.before}` : top;
  const rows = await selectMessages(viewerId, channelId, filter, sql`m.channel_seq DESC`, CHAT_PAGE_SIZE);
  return rows.reverse();
}

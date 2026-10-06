import "server-only";

import { sql } from "drizzle-orm";

import { chatRows } from "@/lib/messaging/server";

/**
 * The Inbox counts: unread mentions and thread replies (the badge), mentions alone, and
 * followed threads with new replies. Muted conversations: mentions still count, threads don't.
 */
export async function inboxCounts(userId: string) {
  const [counts] = await chatRows<{ inbox_unread: number; inbox_mentions: number; threads_unread: number }>(sql`
    SELECT
      (SELECT count(*)::int FROM chat_mentions mn
        JOIN chat_channel_members mem ON mem.channel_id = mn.channel_id AND mem.user_id = mn.user_id
        JOIN chat_messages msg ON msg.channel_id = mn.channel_id AND msg.channel_seq = mn.message_seq
        WHERE mn.user_id = ${userId}::uuid AND mn.read_at IS NULL AND msg.deleted_at IS NULL
          AND (mn.kind <> 'thread_reply' OR mem.notify <> 'mute')) AS inbox_unread,
      (SELECT count(*)::int FROM chat_mentions mn
        JOIN chat_messages msg ON msg.channel_id = mn.channel_id AND msg.channel_seq = mn.message_seq
        WHERE mn.user_id = ${userId}::uuid AND mn.read_at IS NULL AND msg.deleted_at IS NULL AND mn.kind <> 'thread_reply'
          AND app_private.chat_is_member(mn.channel_id, ${userId}::uuid)) AS inbox_mentions,
      (SELECT count(*)::int FROM chat_thread_follows f
        JOIN chat_channel_members mem ON mem.channel_id = f.channel_id AND mem.user_id = f.user_id
        JOIN chat_messages msg ON msg.channel_id = f.channel_id AND msg.channel_seq = f.root_seq
        WHERE f.user_id = ${userId}::uuid AND coalesce(msg.last_reply_seq, 0) > f.last_read_seq AND mem.notify <> 'mute') AS threads_unread
  `);
  return counts ?? { inbox_unread: 0, inbox_mentions: 0, threads_unread: 0 };
}

/** For the read events only: a failed count must not fail a read that already happened (the poll catches up). */
export const countsOrNothing = (userId: string) => inboxCounts(userId).catch(() => ({}));

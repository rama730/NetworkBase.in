"use server";

import { sql } from "drizzle-orm";

import { publishUser } from "@/lib/messaging/publish";
import { chatFailure, chatRows, invalidInput, isUuid, jsonParam, requireChatUser, unauthorized } from "@/lib/messaging/server";
import type { ChatChannelSummary, ChatPerson } from "@/lib/messaging/types";

export type InboxFilter = "all" | "mentions" | "reactions";

export type InboxItem = {
  channel_id: string;
  channel_name: string | null;
  channel_kind: string;
  channel_title: string | null;
  project_title: string | null;
  seq: number;
  kind: "user" | "channel" | "here" | "thread_reply" | "reaction";
  created_at: string;
  body: string;
  thread_root_seq: number | null;
  read: boolean;
  emoji: string | null;
  author: ChatPerson | null;
};

const author = sql`CASE WHEN pr.id IS NULL THEN NULL ELSE jsonb_build_object(
  'id', pr.id, 'username', pr.username, 'full_name', pr.full_name, 'avatar_url', pr.avatar_url
) END AS author`;

/**
 * The Inbox (report 7.8, Activity and Threads in one place): mentions and
 * thread replies with their read state, or reactions to your messages.
 * Read = marked read, or behind the channel's (or the thread's) read cursor.
 */
export async function listInbox(input: { filter?: InboxFilter; before?: string | null } = {}) {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  const filter: InboxFilter = input.filter === "mentions" || input.filter === "reactions" ? input.filter : "all";
  const before = typeof input.before === "string" && !Number.isNaN(Date.parse(input.before)) ? input.before : null;
  try {
    if (filter === "reactions") {
      // ponytail: reactions to your last 500 messages in 30 days (L-10). ceiling:
      // older messages' reactions don't show. upgrade: a reactions feed table.
      const items = await chatRows<InboxItem>(sql`
        SELECT r.channel_id, c.name AS channel_name, c.kind AS channel_kind, c.title AS channel_title, p.title AS project_title,
               r.message_seq::int AS seq, 'reaction' AS kind, r.created_at, msg.body, msg.thread_root_seq::int AS thread_root_seq,
               true AS read, r.emoji, ${author}
        FROM (
          SELECT channel_id, channel_seq FROM chat_messages
          WHERE author_id = ${user.id}::uuid AND kind = 'user' AND deleted_at IS NULL AND created_at > now() - interval '30 days'
          ORDER BY created_at DESC LIMIT 500
        ) mine
        JOIN chat_messages msg ON msg.channel_id = mine.channel_id AND msg.channel_seq = mine.channel_seq
        JOIN chat_reactions r ON r.channel_id = mine.channel_id AND r.message_seq = mine.channel_seq AND r.user_id <> ${user.id}::uuid
        JOIN chat_channels c ON c.id = r.channel_id
        LEFT JOIN projects p ON p.id = c.project_id
        LEFT JOIN profiles pr ON pr.id = r.user_id
        WHERE app_private.chat_is_member(r.channel_id, ${user.id}::uuid)
          AND (${before}::timestamptz IS NULL OR r.created_at < ${before}::timestamptz)
        ORDER BY r.created_at DESC
        LIMIT 50
      `);
      return { success: true as const, items };
    }
    const items = await chatRows<InboxItem>(sql`
      SELECT mn.channel_id, c.name AS channel_name, c.kind AS channel_kind, c.title AS channel_title, p.title AS project_title,
             mn.message_seq::int AS seq, mn.kind, mn.created_at, msg.body, msg.thread_root_seq::int AS thread_root_seq,
             (mn.read_at IS NOT NULL OR CASE WHEN msg.thread_root_seq IS NULL THEN mn.message_seq <= mem.last_read_seq
                                             ELSE coalesce(f.last_read_seq, 0) >= mn.message_seq END) AS read,
             NULL::text AS emoji, ${author}
      FROM chat_mentions mn
      JOIN chat_channel_members mem ON mem.channel_id = mn.channel_id AND mem.user_id = mn.user_id
      JOIN chat_channels c ON c.id = mn.channel_id
      JOIN chat_messages msg ON msg.channel_id = mn.channel_id AND msg.channel_seq = mn.message_seq
      LEFT JOIN chat_thread_follows f ON f.user_id = mn.user_id AND f.channel_id = mn.channel_id AND f.root_seq = msg.thread_root_seq
      LEFT JOIN projects p ON p.id = c.project_id
      LEFT JOIN profiles pr ON pr.id = msg.author_id
      WHERE mn.user_id = ${user.id}::uuid
        AND (${filter} = 'all' OR mn.kind <> 'thread_reply')
        AND (${before}::timestamptz IS NULL OR mn.created_at < ${before}::timestamptz)
        AND msg.deleted_at IS NULL
      ORDER BY mn.created_at DESC
      LIMIT 50
    `);
    return { success: true as const, items };
  } catch (error) {
    return chatFailure(error, "inbox");
  }
}

/** Mark Inbox items read: some (opened from the Inbox) or all of them. */
export async function markInboxRead(input: { items?: { channelId: string; seq: number }[]; all?: boolean }) {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  const items = (input?.items ?? []).filter((item) => isUuid(item?.channelId) && Number.isInteger(item.seq)).slice(0, 200);
  if (!input?.all && !items.length) return invalidInput;
  try {
    if (input.all) {
      await chatRows(sql`UPDATE chat_mentions SET read_at = now() WHERE user_id = ${user.id}::uuid AND read_at IS NULL`);
    } else {
      await chatRows(sql`
        UPDATE chat_mentions mn SET read_at = now()
        FROM jsonb_to_recordset(${jsonParam(items.map((item) => ({ channel_id: item.channelId, seq: item.seq })))}) AS x(channel_id uuid, seq bigint)
        WHERE mn.user_id = ${user.id}::uuid AND mn.channel_id = x.channel_id AND mn.message_seq = x.seq AND mn.read_at IS NULL
      `);
    }
    publishUser(user.id, "membership.changed", {});
    return { success: true as const };
  } catch (error) {
    return chatFailure(error, "inbox_read");
  }
}

export type ThreadItem = {
  channel_id: string;
  channel_name: string | null;
  channel_kind: string;
  channel_title: string | null;
  project_title: string | null;
  participants: ChatPerson[] | null;
  root_seq: number;
  body: string;
  reply_count: number;
  last_reply_at: string | null;
  unread: boolean;
  author: ChatPerson | null;
};

/** Threads the user follows, most recent reply first. */
export async function listThreads() {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  try {
    const threads = await chatRows<ThreadItem>(sql`
      SELECT f.channel_id, c.name AS channel_name, c.kind AS channel_kind, c.title AS channel_title, p.title AS project_title,
             f.root_seq::int AS root_seq,
             (SELECT jsonb_agg(jsonb_build_object('id', x.id, 'username', x.username, 'full_name', x.full_name, 'avatar_url', x.avatar_url))
                FROM (SELECT DISTINCT ON (rp.author_id) pp.id, pp.username, pp.full_name, pp.avatar_url
                      FROM chat_messages rp JOIN profiles pp ON pp.id = rp.author_id
                      WHERE rp.channel_id = f.channel_id AND rp.thread_root_seq = f.root_seq AND rp.deleted_at IS NULL
                      LIMIT 5) x) AS participants,
             msg.body, msg.reply_count, msg.last_reply_at,
             coalesce(msg.last_reply_seq, 0) > f.last_read_seq AS unread,
             CASE WHEN pr.id IS NULL THEN NULL ELSE jsonb_build_object(
               'id', pr.id, 'username', pr.username, 'full_name', pr.full_name, 'avatar_url', pr.avatar_url
             ) END AS author
      FROM chat_thread_follows f
      JOIN chat_channels c ON c.id = f.channel_id
      JOIN chat_messages msg ON msg.channel_id = f.channel_id AND msg.channel_seq = f.root_seq
      LEFT JOIN projects p ON p.id = c.project_id
      LEFT JOIN profiles pr ON pr.id = msg.author_id
      WHERE f.user_id = ${user.id}::uuid AND app_private.chat_is_member(f.channel_id, ${user.id}::uuid)
      ORDER BY msg.last_reply_at DESC NULLS LAST
      LIMIT 50
    `);
    return { success: true as const, threads };
  } catch (error) {
    return chatFailure(error, "threads");
  }
}

/** The full DM and group-chat list with previews (beyond the 100 in the entry payload). */
export async function listDirectMessages(input: { before?: string | null } = {}) {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  const before = typeof input.before === "string" && !Number.isNaN(Date.parse(input.before)) ? input.before : null;
  try {
    const channels = await chatRows<ChatChannelSummary>(sql`
      SELECT c.id, c.kind, c.name, c.title, c.topic, c.project_id, c.application_id, c.is_default, c.last_seq, c.last_top_seq,
             m.last_read_seq, m.mention_count, m.notify, m.starred, m.archived_at, c.archived_at AS channel_archived_at,
             c.last_message_at, c.last_preview, c.last_author_id, c.member_count, m.role,
             CASE WHEN c.kind = 'dm' THEN (
               SELECT jsonb_build_object('id', pr.id, 'username', pr.username, 'full_name', pr.full_name, 'avatar_url', pr.avatar_url)
               FROM chat_channel_members o JOIN profiles pr ON pr.id = o.user_id
               WHERE o.channel_id = c.id ORDER BY (o.user_id = ${user.id}::uuid) LIMIT 1
             ) END AS dm_user,
             CASE WHEN c.kind = 'private' AND c.name IS NULL THEN (
               SELECT jsonb_agg(jsonb_build_object('id', x.id, 'username', x.username, 'full_name', x.full_name, 'avatar_url', x.avatar_url))
               FROM (SELECT pr.id, pr.username, pr.full_name, pr.avatar_url FROM chat_channel_members o JOIN profiles pr ON pr.id = o.user_id
                     WHERE o.channel_id = c.id AND o.user_id <> ${user.id}::uuid ORDER BY o.joined_at LIMIT 3) x
             ) END AS members_preview
      FROM chat_channel_members m
      JOIN chat_channels c ON c.id = m.channel_id
      WHERE m.user_id = ${user.id}::uuid
        AND (c.kind = 'dm' OR (c.kind = 'private' AND c.project_id IS NULL))
        AND (${before}::timestamptz IS NULL OR c.last_message_at < ${before}::timestamptz)
      ORDER BY c.last_message_at DESC NULLS LAST
      LIMIT 50
    `);
    return { success: true as const, channels };
  } catch (error) {
    return chatFailure(error, "direct_messages");
  }
}

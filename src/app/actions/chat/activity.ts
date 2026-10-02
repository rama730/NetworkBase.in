"use server";

import { sql } from "drizzle-orm";

import { chatFailure, chatRows, requireChatUser, unauthorized } from "@/lib/messaging/server";
import type { ChatChannelSummary, ChatPerson } from "@/lib/messaging/types";

export type ActivityItem = {
  channel_id: string;
  channel_name: string | null;
  channel_kind: string;
  seq: number;
  kind: "user" | "channel" | "here" | "thread_reply";
  created_at: string;
  body: string;
  thread_root_seq: number | null;
  author: ChatPerson | null;
};

/** Mentions and thread replies, newest first (report 7.8 Activity). */
export async function listActivity(input: { before?: string | null } = {}) {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  const before = typeof input.before === "string" && !Number.isNaN(Date.parse(input.before)) ? input.before : null;
  try {
    const items = await chatRows<ActivityItem>(sql`
      SELECT mn.channel_id, c.name AS channel_name, c.kind AS channel_kind, mn.message_seq::int AS seq, mn.kind, mn.created_at,
             msg.body, msg.thread_root_seq::int AS thread_root_seq,
             CASE WHEN pr.id IS NULL THEN NULL ELSE jsonb_build_object(
               'id', pr.id, 'username', pr.username, 'full_name', pr.full_name, 'avatar_url', pr.avatar_url
             ) END AS author
      FROM chat_mentions mn
      JOIN chat_channels c ON c.id = mn.channel_id
      JOIN chat_messages msg ON msg.channel_id = mn.channel_id AND msg.channel_seq = mn.message_seq
      LEFT JOIN profiles pr ON pr.id = msg.author_id
      WHERE mn.user_id = ${user.id}::uuid
        AND (${before}::timestamptz IS NULL OR mn.created_at < ${before}::timestamptz)
        AND msg.deleted_at IS NULL
      ORDER BY mn.created_at DESC
      LIMIT 50
    `);
    return { success: true as const, items };
  } catch (error) {
    return chatFailure(error, "activity");
  }
}

export type ThreadItem = {
  channel_id: string;
  channel_name: string | null;
  channel_kind: string;
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
      SELECT f.channel_id, c.name AS channel_name, c.kind AS channel_kind, f.root_seq::int AS root_seq,
             msg.body, msg.reply_count, msg.last_reply_at,
             coalesce(msg.last_reply_seq, 0) > f.last_read_seq AS unread,
             CASE WHEN pr.id IS NULL THEN NULL ELSE jsonb_build_object(
               'id', pr.id, 'username', pr.username, 'full_name', pr.full_name, 'avatar_url', pr.avatar_url
             ) END AS author
      FROM chat_thread_follows f
      JOIN chat_channels c ON c.id = f.channel_id
      JOIN chat_messages msg ON msg.channel_id = f.channel_id AND msg.channel_seq = f.root_seq
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
      SELECT c.id, c.kind, c.name, c.topic, c.project_id, c.application_id, c.is_default, c.last_seq, c.last_top_seq,
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

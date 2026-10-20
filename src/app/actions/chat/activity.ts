"use server";

import { sql, type SQL } from "drizzle-orm";

import { publishUser } from "@/lib/messaging/publish";
import { chatFailure, chatRows, invalidInput, isUuid, jsonParam, requireChatUser, unauthorized } from "@/lib/messaging/server";
import { CHAT_LIST_PAGE } from "@/lib/messaging/constants";
import { mergeByTime, parseFeedCursor, type FeedCursor } from "@/lib/messaging/inbox";
import type { ChatPerson } from "@/lib/messaging/types";

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
  /** Opaque position of this row; pass it back as `cursor` to read the rows after it. */
  cursor: string;
};

const author = sql`CASE WHEN pr.id IS NULL THEN NULL ELSE jsonb_build_object(
  'id', pr.id, 'username', pr.username, 'full_name', pr.full_name, 'avatar_url', pr.avatar_url
) END AS author`;

/**
 * A DM shows the other person's name (like Saved), never "a direct message". An application thread is named for the other
 * side, like in the sidebar: the applicant and role for a reviewer, the role for the applicant.
 */
const channelTitle = (userId: string) => sql`CASE WHEN c.kind = 'dm' THEN (
  SELECT coalesce(op.full_name, op.username) FROM chat_channel_members o JOIN profiles op ON op.id = o.user_id
  WHERE o.channel_id = c.id ORDER BY (o.user_id = ${userId}::uuid) LIMIT 1
) WHEN c.application_id IS NOT NULL THEN (
  SELECT CASE WHEN a.applicant_id = ${userId}::uuid THEN coalesce(r.title, r.role, 'Application')
              ELSE coalesce(ap.full_name, ap.username, 'Applicant') || ' · ' || coalesce(r.title, r.role, 'Role') END
  FROM role_applications a JOIN profiles ap ON ap.id = a.applicant_id LEFT JOIN project_open_roles r ON r.id = a.role_id
  WHERE a.id = c.application_id
) ELSE c.title END AS channel_title`;

/** The cursor text for a row: time at microsecond precision, then the keys that break ties. */
const feedCursor = (at: SQL, channel: SQL, seq: SQL, rank: number, tie: SQL, scope: string) => sql`jsonb_build_array(
  coalesce(to_char(${at} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), '-infinity'), ${channel}, ${seq}, ${rank}::int, ${tie}, ${scope}::text
)::text AS cursor`;

/** Rows strictly after `cursor` in (time, channel, seq, rank, tie) descending order. */
const afterCursor = (cursor: FeedCursor | null, at: SQL, channel: SQL, seq: SQL, rank: number, tie: SQL) => cursor === null ? sql`` : sql`
  AND (${at}, ${channel}, ${seq}, ${rank}::int, ${tie} COLLATE "C")
    < (${cursor[0]}::timestamptz, ${cursor[1]}::uuid, ${cursor[2]}::bigint, ${cursor[3]}::int, ${cursor[4]}::text COLLATE "C")`;

/** Reactions to your messages, newest first (always "read": they never count in the badge). */
// ponytail: reactions to your last 500 messages in 30 days (L-10). ceiling:
// older messages' reactions don't show. upgrade: a reactions feed table.
function reactionItems(userId: string, cursor: FeedCursor | null, scope: string, limit: number) {
  return chatRows<InboxItem>(sql`
    SELECT r.channel_id, c.name AS channel_name, c.kind AS channel_kind, ${channelTitle(userId)}, p.title AS project_title,
           r.message_seq::int AS seq, 'reaction' AS kind, r.created_at, msg.body, msg.thread_root_seq::int AS thread_root_seq,
           true AS read, r.emoji, ${author},
           ${feedCursor(sql`r.created_at`, sql`r.channel_id`, sql`r.message_seq`, 1, sql`r.user_id::text || ':' || r.emoji`, scope)}
    FROM (
      SELECT channel_id, channel_seq FROM chat_messages
      WHERE author_id = ${userId}::uuid AND kind = 'user' AND deleted_at IS NULL AND created_at > now() - interval '30 days'
      ORDER BY created_at DESC LIMIT 500
    ) mine
    JOIN chat_messages msg ON msg.channel_id = mine.channel_id AND msg.channel_seq = mine.channel_seq
    JOIN chat_reactions r ON r.channel_id = mine.channel_id AND r.message_seq = mine.channel_seq AND r.user_id <> ${userId}::uuid
    JOIN chat_channels c ON c.id = r.channel_id
    LEFT JOIN projects p ON p.id = c.project_id
    LEFT JOIN profiles pr ON pr.id = r.user_id
    WHERE app_private.chat_is_member(r.channel_id, ${userId}::uuid)
      ${afterCursor(cursor, sql`r.created_at`, sql`r.channel_id`, sql`r.message_seq`, 1, sql`r.user_id::text || ':' || r.emoji`)}
    ORDER BY r.created_at DESC, r.channel_id DESC, r.message_seq DESC, (r.user_id::text || ':' || r.emoji) COLLATE "C" DESC
    LIMIT ${limit}
  `);
}

/** Mentions and (unless `mentionsOnly`) thread replies, with their read state. */
function mentionItems(userId: string, mentionsOnly: boolean, cursor: FeedCursor | null, scope: string, limit: number) {
  return chatRows<InboxItem>(sql`
    SELECT mn.channel_id, c.name AS channel_name, c.kind AS channel_kind, ${channelTitle(userId)}, p.title AS project_title,
           mn.message_seq::int AS seq, mn.kind, mn.created_at, msg.body, msg.thread_root_seq::int AS thread_root_seq,
           (mn.read_at IS NOT NULL OR CASE WHEN msg.thread_root_seq IS NULL THEN mn.message_seq <= mem.last_read_seq
                                           ELSE coalesce(f.last_read_seq, 0) >= mn.message_seq END) AS read,
           NULL::text AS emoji, ${author},
           ${feedCursor(sql`mn.created_at`, sql`mn.channel_id`, sql`mn.message_seq`, 0, sql`''::text`, scope)}
    FROM chat_mentions mn
    JOIN chat_channel_members mem ON mem.channel_id = mn.channel_id AND mem.user_id = mn.user_id
    JOIN chat_channels c ON c.id = mn.channel_id
    JOIN chat_messages msg ON msg.channel_id = mn.channel_id AND msg.channel_seq = mn.message_seq
    LEFT JOIN chat_thread_follows f ON f.user_id = mn.user_id AND f.channel_id = mn.channel_id AND f.root_seq = msg.thread_root_seq
    LEFT JOIN projects p ON p.id = c.project_id
    LEFT JOIN profiles pr ON pr.id = msg.author_id
    WHERE mn.user_id = ${userId}::uuid
      AND (${!mentionsOnly} OR mn.kind <> 'thread_reply')
      -- Same rule as the Inbox badge: in muted conversations mentions still show, thread replies don't.
      AND (mn.kind <> 'thread_reply' OR mem.notify <> 'mute')
      ${afterCursor(cursor, sql`mn.created_at`, sql`mn.channel_id`, sql`mn.message_seq`, 0, sql`''::text`)}
      AND msg.deleted_at IS NULL
    ORDER BY mn.created_at DESC, mn.channel_id DESC, mn.message_seq DESC
    LIMIT ${limit}
  `);
}

/**
 * The Inbox (report 7.8, Activity and Threads in one place). All = mentions, thread
 * replies and reactions (reactions as already-read rows, like Slack Activity);
 * Mentions; Reactions. Read = marked read, or behind the channel's (or thread's) cursor.
 */
export async function listInbox(input: { filter?: InboxFilter; cursor?: string | null; limit?: number } = {}) {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  const filter: InboxFilter = input.filter === "mentions" || input.filter === "reactions" ? input.filter : "all";
  const cursor = parseFeedCursor(input.cursor, filter);
  if (cursor === "invalid") return invalidInput;
  const limit = Number.isInteger(input.limit) ? Math.min(Math.max(input.limit!, 1), CHAT_LIST_PAGE) : CHAT_LIST_PAGE;
  try {
    if (filter === "reactions") return { success: true as const, items: await reactionItems(user.id, cursor, filter, limit) };
    if (filter === "mentions") return { success: true as const, items: await mentionItems(user.id, true, cursor, filter, limit) };
    const [mentions, reactions] = await Promise.all([
      mentionItems(user.id, false, cursor, filter, limit),
      reactionItems(user.id, cursor, filter, limit),
    ]);
    return { success: true as const, items: mergeByTime(mentions, reactions, limit) };
  } catch (error) {
    return chatFailure(error, "inbox");
  }
}

/**
 * Put one Inbox item back to unread, like Slack: the item, and the read point of its
 * conversation (or thread) moves back to just before it, so it really reads as new.
 */
export async function markInboxUnread(input: { channelId: string; seq: number }) {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  if (!isUuid(input?.channelId) || !Number.isInteger(input.seq) || input.seq < 1) return invalidInput;
  try {
    const [message] = await chatRows<{ thread_root_seq: number | null }>(sql`
      SELECT thread_root_seq::int FROM chat_messages
      WHERE channel_id = ${input.channelId}::uuid AND channel_seq = ${input.seq}
        AND app_private.chat_is_member(${input.channelId}::uuid, ${user.id}::uuid)
    `);
    if (!message) return { success: false as const, error: "chat_message_not_found" };
    await chatRows(sql`
      UPDATE chat_mentions SET read_at = NULL
      WHERE user_id = ${user.id}::uuid AND channel_id = ${input.channelId}::uuid AND message_seq = ${input.seq}
    `);
    if (message.thread_root_seq) {
      await chatRows(sql`
        UPDATE chat_thread_follows SET last_read_seq = least(last_read_seq, ${input.seq - 1})
        WHERE user_id = ${user.id}::uuid AND channel_id = ${input.channelId}::uuid AND root_seq = ${message.thread_root_seq}
      `);
    } else {
      await chatRows(sql`SELECT app_private.chat_mark_unread(${input.channelId}::uuid, ${user.id}::uuid, ${input.seq}::bigint)`);
    }
    publishUser(user.id, "membership.changed", { channel_id: input.channelId });
    return { success: true as const };
  } catch (error) {
    return chatFailure(error, "inbox_unread");
  }
}

export type InboxScope = "all" | "mentions" | "threads";

/**
 * Mark Inbox items read: some (opened from the Inbox) or everything in one tab.
 * All = mentions and thread replies; Mentions = mentions only; Threads = followed
 * threads (their read cursor moves to the latest reply) and their reply items.
 */
export async function markInboxRead(input: { items?: { channelId: string; seq: number }[]; all?: boolean; scope?: InboxScope }) {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  const items = (input?.items ?? []).filter((item) => isUuid(item?.channelId) && Number.isInteger(item.seq)).slice(0, 200);
  if (!input?.all && !items.length) return invalidInput;
  try {
    if (input.all) {
      const scope: InboxScope = input.scope === "mentions" || input.scope === "threads" ? input.scope : "all";
      await chatRows(sql`
        UPDATE chat_mentions SET read_at = now()
        WHERE user_id = ${user.id}::uuid AND read_at IS NULL
          AND (${scope} = 'all' OR (${scope} = 'mentions') = (kind <> 'thread_reply'))
      `);
      if (scope !== "mentions") {
        await chatRows(sql`
          UPDATE chat_thread_follows f SET last_read_seq = msg.last_reply_seq
          FROM chat_messages msg
          WHERE f.user_id = ${user.id}::uuid AND msg.channel_id = f.channel_id AND msg.channel_seq = f.root_seq
            AND coalesce(msg.last_reply_seq, 0) > f.last_read_seq
        `);
      }
    } else {
      const picked = jsonParam(items.map((item) => ({ channel_id: item.channelId, seq: item.seq })));
      await chatRows(sql`
        UPDATE chat_mentions mn SET read_at = now()
        FROM jsonb_to_recordset(${picked}) AS x(channel_id uuid, seq bigint)
        WHERE mn.user_id = ${user.id}::uuid AND mn.channel_id = x.channel_id AND mn.message_seq = x.seq AND mn.read_at IS NULL
      `);
      // A thread reply read here reads the thread up to it, like opening it: the follow cursor
      // moves and older replies are stamped read, so the list and the badge agree.
      await chatRows(sql`
        SELECT app_private.chat_mark_thread_read(x.channel_id, ${user.id}::uuid, msg.thread_root_seq, x.seq)
        FROM jsonb_to_recordset(${picked}) AS x(channel_id uuid, seq bigint)
        JOIN chat_messages msg ON msg.channel_id = x.channel_id AND msg.channel_seq = x.seq
        WHERE msg.thread_root_seq IS NOT NULL AND app_private.chat_is_member(x.channel_id, ${user.id}::uuid)
      `);
    }
    // The sidebar's @ counts follow: what's left unread after each channel's cursor (same as chat_mark_unread).
    await chatRows(sql`
      UPDATE chat_channel_members m SET mention_count = (
        SELECT count(*)::int FROM chat_mentions mn
        WHERE mn.user_id = m.user_id AND mn.channel_id = m.channel_id AND mn.read_at IS NULL
          AND mn.kind <> 'thread_reply' AND mn.message_seq > m.last_read_seq
      )
      WHERE m.user_id = ${user.id}::uuid AND m.mention_count > 0
    `);
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
  /** Up to 5 repliers, most recent first; participant_count is all of them. */
  participants: ChatPerson[] | null;
  participant_count: number;
  root_seq: number;
  body: string;
  /** The thread's first message was deleted (its replies stay). */
  root_deleted: boolean;
  reply_count: number;
  last_reply_seq: number | null;
  last_reply_at: string | null;
  unread: boolean;
  author: ChatPerson | null;
  /** Opaque position of this row; pass it back as `cursor` to read the threads after it. */
  cursor: string;
};

/**
 * Threads the user follows, most recent reply first; never-replied threads come last. `cursor` (the
 * last thread's) pages older ones: the key is (last reply time, channel, root), so equal times keep a
 * stable order and a thread with no reply yet has a position too.
 */
export async function listThreads(input: { cursor?: string | null; limit?: number } = {}) {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  const cursor = parseFeedCursor(input?.cursor, "threads");
  if (cursor === "invalid") return invalidInput;
  const limit = Number.isInteger(input?.limit) ? Math.min(Math.max(input.limit!, 1), CHAT_LIST_PAGE) : CHAT_LIST_PAGE;
  try {
    const threads = await chatRows<ThreadItem>(sql`
      SELECT f.channel_id, c.name AS channel_name, c.kind AS channel_kind, ${channelTitle(user.id)}, p.title AS project_title,
             f.root_seq::int AS root_seq,
             (SELECT jsonb_agg(jsonb_build_object('id', pp.id, 'username', pp.username, 'full_name', pp.full_name, 'avatar_url', pp.avatar_url) ORDER BY x.last DESC)
                FROM (SELECT rp.author_id, max(rp.channel_seq) AS last
                      FROM chat_messages rp
                      WHERE rp.channel_id = f.channel_id AND rp.thread_root_seq = f.root_seq AND rp.deleted_at IS NULL
                      GROUP BY rp.author_id ORDER BY last DESC LIMIT 5) x
                JOIN profiles pp ON pp.id = x.author_id) AS participants,
             (SELECT count(DISTINCT rp.author_id)::int FROM chat_messages rp
                WHERE rp.channel_id = f.channel_id AND rp.thread_root_seq = f.root_seq AND rp.deleted_at IS NULL) AS participant_count,
             msg.body, msg.deleted_at IS NOT NULL AS root_deleted, msg.reply_count, msg.last_reply_seq::int AS last_reply_seq, msg.last_reply_at,
             -- Muted conversations' threads never read as new (same rule as the badge).
             coalesce(msg.last_reply_seq, 0) > f.last_read_seq AND mem.notify <> 'mute' AS unread,
             CASE WHEN pr.id IS NULL THEN NULL ELSE jsonb_build_object(
               'id', pr.id, 'username', pr.username, 'full_name', pr.full_name, 'avatar_url', pr.avatar_url
             ) END AS author,
             ${feedCursor(sql`msg.last_reply_at`, sql`f.channel_id`, sql`f.root_seq`, 0, sql`''::text`, "threads")}
      FROM chat_thread_follows f
      JOIN chat_channel_members mem ON mem.channel_id = f.channel_id AND mem.user_id = f.user_id
      JOIN chat_channels c ON c.id = f.channel_id
      JOIN chat_messages msg ON msg.channel_id = f.channel_id AND msg.channel_seq = f.root_seq
      LEFT JOIN projects p ON p.id = c.project_id
      LEFT JOIN profiles pr ON pr.id = msg.author_id
      WHERE f.user_id = ${user.id}::uuid
        ${afterCursor(cursor, sql`coalesce(msg.last_reply_at, '-infinity'::timestamptz)`, sql`f.channel_id`, sql`f.root_seq`, 0, sql`''::text`)}
      ORDER BY coalesce(msg.last_reply_at, '-infinity'::timestamptz) DESC, f.channel_id DESC, f.root_seq DESC
      LIMIT ${limit}
    `);
    return { success: true as const, threads };
  } catch (error) {
    return chatFailure(error, "threads");
  }
}

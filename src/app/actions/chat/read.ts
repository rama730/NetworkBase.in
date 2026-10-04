"use server";

import { sql } from "drizzle-orm";

import { publishUser, publishUserEvents } from "@/lib/messaging/publish";
import { chatFailure, chatRows, chatValue, invalidInput, isUuid, jsonParam, requireChatUser, unauthorized } from "@/lib/messaging/server";
import type { ChatBootstrap } from "@/lib/messaging/types";

/**
 * App entry and the background poll: every joined channel with its unread
 * state, the user's projects (first load only), and the pending invitation and
 * application counts from their real tables.
 */
export async function bootstrap(input: { since?: string | null } = {}) {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  const since = typeof input.since === "string" && !Number.isNaN(Date.parse(input.since)) ? input.since : null;
  try {
    // Invites and applications don't change on chat sends: count them on full loads only (LOAD-03).
    const [data, [counts], savedDue, inbox] = await Promise.all([
      chatValue<ChatBootstrap>(sql`SELECT app_private.chat_bootstrap(${user.id}::uuid, ${since}::timestamptz) AS value`),
      since ? Promise.resolve([undefined]) : chatRows<{ invites: number; applications: number }>(sql`
        SELECT
          (SELECT count(*)::int FROM project_invitations
            WHERE candidate_id = ${user.id}::uuid AND status = 'pending' AND expires_at > now()) AS invites,
          (SELECT count(*)::int FROM role_applications
            WHERE creator_id = ${user.id}::uuid AND status = 'pending') AS applications
      `),
      // The Saved row's badge: reminders whose time has come (cleared or Done removes them).
      chatValue<number>(sql`
        SELECT count(*)::int AS value FROM chat_saved WHERE user_id = ${user.id}::uuid AND remind_at <= now()
      `),
      inboxCounts(user.id),
    ]);
    return { success: true as const, data: { ...data, ...inbox, saved_due: savedDue }, pending: since ? null : counts ?? { invites: 0, applications: 0 } };
  } catch (error) {
    return chatFailure(error, "bootstrap");
  }
}

/**
 * The Inbox counts: unread mentions and thread replies (the badge), mentions alone, and
 * followed threads with new replies. Muted conversations: mentions still count, threads don't.
 */
async function inboxCounts(userId: string) {
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

/** Move the read cursor forward (only-if-newer) and tell the user's other tabs. */
export async function markRead(input: { channelId: string; seq: number }) {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  if (!isUuid(input?.channelId) || !Number.isInteger(input.seq) || input.seq < 1) return invalidInput;
  try {
    const moved = await chatValue<boolean>(sql`
      SELECT app_private.chat_mark_read(${input.channelId}::uuid, ${user.id}::uuid, ${input.seq}::bigint) AS value
    `);
    // The Inbox count moves too (reading a channel reads its mentions): every badge updates at once.
    if (moved) publishUser(user.id, "read.moved", { channel_id: input.channelId, seq: input.seq, ...(await inboxCounts(user.id)) });
    return { success: true as const, moved };
  } catch (error) {
    return chatFailure(error, "mark_read");
  }
}

/** Mark several conversations read in one roundtrip (Home, a project, Shift+Esc). */
export async function markReadMany(input: { items: { channelId: string; seq: number }[] }) {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  const items = (input?.items ?? []).filter((item) => isUuid(item?.channelId) && Number.isInteger(item.seq) && item.seq > 0).slice(0, 500);
  if (!items.length) return { success: true as const, moved: 0 };
  try {
    const moved = await chatRows<{ channel_id: string; seq: number }>(sql`
      SELECT x.channel_id, x.seq::int AS seq
      FROM jsonb_to_recordset(${jsonParam(items.map((item) => ({ channel_id: item.channelId, seq: item.seq })))}) AS x(channel_id uuid, seq bigint)
      WHERE app_private.chat_mark_read(x.channel_id, ${user.id}::uuid, x.seq)
    `);
    const counts = moved.length ? await inboxCounts(user.id) : null;
    publishUserEvents(user.id, moved.map((row) => ({ event: "read.moved", payload: { channel_id: row.channel_id, seq: row.seq, ...counts } })));
    return { success: true as const, moved: moved.length };
  } catch (error) {
    return chatFailure(error, "mark_read_many");
  }
}

export async function markThreadRead(input: { channelId: string; rootSeq: number; seq: number }) {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  if (!isUuid(input?.channelId) || !Number.isInteger(input.rootSeq) || !Number.isInteger(input.seq)) return invalidInput;
  try {
    const moved = await chatValue<boolean>(sql`
      SELECT app_private.chat_mark_thread_read(${input.channelId}::uuid, ${user.id}::uuid, ${input.rootSeq}::bigint, ${input.seq}::bigint) AS value
    `);
    // Badges everywhere drop now, not at the next poll (the thread's mentions were read too).
    publishUser(user.id, "inbox.count", await inboxCounts(user.id));
    return { success: true as const, moved };
  } catch (error) {
    return chatFailure(error, "mark_thread_read");
  }
}

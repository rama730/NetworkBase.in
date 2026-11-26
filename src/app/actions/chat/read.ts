"use server";

import { isMessageSeq } from "@/lib/messaging/routes";

import { sql } from "drizzle-orm";

import { withApplicationMeta } from "@/lib/messaging/application-meta";
import { publishUser, publishUserEvents } from "@/lib/messaging/publish";
import { chatFailure, chatRows, chatValue, invalidInput, isUuid, jsonParam, requireChatUser, unauthorized } from "@/lib/messaging/server";
import { countsOrNothing, inboxCounts } from "@/lib/messaging/inbox-counts";
import { withBlockState } from "@/lib/messaging/shell-state";
import { withReadablePreviews, withUnreadCounts } from "@/lib/messaging/list-extras";
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
    const [data, savedDue, inbox, blocks, mutes] = await Promise.all([
      chatValue<ChatBootstrap>(sql`SELECT app_private.chat_bootstrap(${user.id}::uuid, ${since}::timestamptz) AS value`),
      // The Saved row's badge: reminders whose time has come (cleared or Done removes them).
      chatValue<number>(sql`
        SELECT count(*)::int AS value FROM chat_saved WHERE user_id = ${user.id}::uuid AND remind_at <= now()
      `),
      inboxCounts(user.id),
      chatRows<{ blocker_id: string; blocked_id: string }>(sql`
        SELECT blocker_id, blocked_id FROM user_blocks WHERE blocker_id = ${user.id}::uuid OR blocked_id = ${user.id}::uuid
      `),
      chatRows<{ muted_id: string }>(sql`SELECT muted_id FROM user_mutes WHERE muter_id = ${user.id}::uuid`),
    ]);
    const listed = await withApplicationMeta(data.channels, user.id);
    const [named, counted] = await Promise.all([withReadablePreviews(listed), withUnreadCounts(listed)]);
    const counts = new Map(counted.map((c) => [c.id, c.unread_count]));
    const channels = withBlockState(named.map((c) => (counts.get(c.id) === undefined ? c : { ...c, unread_count: counts.get(c.id) })), user.id, blocks);
    const blockedIds = blocks.filter((b) => b.blocker_id === user.id).map((b) => b.blocked_id);
    return { success: true as const, data: { ...data, channels, ...inbox, saved_due: savedDue, blocked_ids: blockedIds, muted_ids: mutes.map((m) => m.muted_id) } };
  } catch (error) {
    return chatFailure(error, "bootstrap");
  }
}

/** Move the read cursor forward (only-if-newer) and tell the user's other tabs. */
export async function markRead(input: { channelId: string; seq: number }) {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  if (!isUuid(input?.channelId) || !isMessageSeq(input.seq) || input.seq < 1) return invalidInput;
  try {
    const moved = await chatValue<boolean>(sql`
      SELECT app_private.chat_mark_read(${input.channelId}::uuid, ${user.id}::uuid, ${input.seq}::bigint) AS value
    `);
    // The Inbox count moves too (reading a channel reads its mentions): every badge updates at once.
    if (moved) publishUser(user.id, "read.moved", { channel_id: input.channelId, seq: input.seq, ...(await countsOrNothing(user.id)) });
    // "Seen" (0150): the other person in a 1:1 DM learns it live, under the same rules as getChannel's peer_seen.
    if (moved) {
      const [peer] = await chatRows<{ user_id: string }>(sql`
        SELECT o.user_id FROM chat_channels c
        JOIN chat_channel_members o ON o.channel_id = c.id AND o.user_id <> ${user.id}::uuid
        JOIN profiles op ON op.id = o.user_id JOIN profiles mp ON mp.id = ${user.id}::uuid
        WHERE c.id = ${input.channelId}::uuid AND c.kind = 'dm' AND c.member_count = 2 AND c.application_id IS NULL
          AND op.read_receipts AND mp.read_receipts AND NOT app_private.chat_is_blocked(${user.id}::uuid, o.user_id)
      `).catch(() => []);
      if (peer) publishUser(peer.user_id, "read.seen", { channel_id: input.channelId, seq: input.seq, at: new Date().toISOString() });
    }
    return { success: true as const, moved };
  } catch (error) {
    return chatFailure(error, "mark_read");
  }
}

/** Mark several conversations read in one roundtrip (Home, a project, Shift+Esc). */
export async function markReadMany(input: { items: { channelId: string; seq: number }[] }) {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  const items = (input?.items ?? []).filter((item) => isUuid(item?.channelId) && isMessageSeq(item.seq)).slice(0, 500);
  if (!items.length) return { success: true as const, moved: 0 };
  try {
    const moved = await chatRows<{ channel_id: string; seq: number }>(sql`
      SELECT x.channel_id, x.seq::int AS seq
      FROM jsonb_to_recordset(${jsonParam(items.map((item) => ({ channel_id: item.channelId, seq: item.seq })))}) AS x(channel_id uuid, seq bigint)
      WHERE app_private.chat_mark_read(x.channel_id, ${user.id}::uuid, x.seq)
    `);
    const counts = moved.length ? await countsOrNothing(user.id) : null;
    publishUserEvents(user.id, moved.map((row) => ({ event: "read.moved", payload: { channel_id: row.channel_id, seq: row.seq, ...counts } })));
    return { success: true as const, moved: moved.length };
  } catch (error) {
    return chatFailure(error, "mark_read_many");
  }
}

export async function markThreadRead(input: { channelId: string; rootSeq: number; seq: number }) {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  if (!isUuid(input?.channelId) || !isMessageSeq(input.rootSeq) || !isMessageSeq(input.seq)) return invalidInput;
  try {
    const moved = await chatValue<boolean>(sql`
      SELECT app_private.chat_mark_thread_read(${input.channelId}::uuid, ${user.id}::uuid, ${input.rootSeq}::bigint, ${input.seq}::bigint) AS value
    `);
    // Badges everywhere drop now, not at the next poll (the thread's mentions were read too),
    // and so does the conversation's @ count in the sidebar (0193 recounts it).
    const [counts, mentionCount] = await Promise.all([
      countsOrNothing(user.id),
      chatValue<number | null>(sql`
        SELECT mention_count AS value FROM chat_channel_members WHERE channel_id = ${input.channelId}::uuid AND user_id = ${user.id}::uuid
      `).catch(() => null),
    ]);
    publishUser(user.id, "inbox.count", { ...counts, channel_id: input.channelId, mention_count: mentionCount });
    return { success: true as const, moved };
  } catch (error) {
    return chatFailure(error, "mark_thread_read");
  }
}

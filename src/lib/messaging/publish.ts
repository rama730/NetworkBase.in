import { after } from "next/server";
import { sql } from "drizzle-orm";

import { logger } from "@/lib/logger";
import { channelTopic, userTopic } from "@/lib/messaging/constants";
import { chatPushTopic, createPushSuppressor } from "@/lib/messaging/push-policy";
import { messageHref } from "@/lib/messaging/routes";
import { chatRows, uuidArray } from "@/lib/messaging/server";
import { previewText } from "@/lib/messaging/tokens";
import type { ChatMessageView } from "@/lib/messaging/types";
import {
  isNotificationPauseActive,
  isQuietHoursActive,
  normalizeNotificationPreferences,
} from "@/lib/notifications/preferences";
import { sendPushToUser } from "@/lib/notifications/web-push";
import { getRedisClient } from "@/lib/redis";
import { broadcast, type ServerBroadcast } from "@/lib/realtime/server-broadcast";

const allowPush = createPushSuppressor(30_000);

/** Publish one channel event after the response is sent (never blocks the action). */
export function publishChannel(channelId: string, event: string, payload: Record<string, unknown>) {
  after(() => broadcast([{ topic: channelTopic(channelId), event, payload }]));
}

/** Publish one event to a user's own topic (multi-tab sync, membership changes). */
export function publishUser(userId: string, event: string, payload: Record<string, unknown>) {
  after(() => broadcast([{ topic: userTopic(userId), event, payload }]));
}

/** The same event to several users' topics in one REST batch. */
export function publishUsers(userIds: readonly string[], event: string, payload: Record<string, unknown>) {
  if (!userIds.length) return;
  after(() => broadcast(userIds.map((userId) => ({ topic: userTopic(userId), event, payload }))));
}

/** Several events to one user's topic in one REST batch. */
export function publishUserEvents(userId: string, events: { event: string; payload: Record<string, unknown> }[]) {
  if (!events.length) return;
  after(() => broadcast(events.map(({ event, payload }) => ({ topic: userTopic(userId), event, payload }))));
}

/**
 * A system line or a new card landed in a conversation: open viewers refetch the timeline, and the
 * other members get the unread hint (a thread they don't know yet appears in their list).
 * Application threads use it for every status change; the lines are written by SQL, not the send path.
 */
export function publishChannelActivity(channelId: string, actorId: string | null) {
  after(async () => {
    const [state] = await chatRows<{ last_seq: string | number; members: string[] | string | null }>(sql`
      SELECT c.last_seq,
             (SELECT coalesce(jsonb_agg(m.user_id), '[]'::jsonb) FROM chat_channel_members m WHERE m.channel_id = c.id) AS members
      FROM chat_channels c WHERE c.id = ${channelId}::uuid
    `);
    if (!state) return;
    const seq = Number(state.last_seq);
    const rawMembers = state.members;
    const members: string[] = Array.isArray(rawMembers)
      ? rawMembers
      : typeof rawMembers === "string"
      ? rawMembers.startsWith("[")
        ? JSON.parse(rawMembers)
        : rawMembers.replace(/^\{|\}$/g, "").split(",").filter(Boolean)
      : [];
    await broadcast([
      { topic: channelTopic(channelId), event: "message.system", payload: { seq } },
      ...members.filter((userId) => userId !== actorId).map((userId) => ({
        topic: userTopic(userId),
        event: "hint",
        payload: { channel_id: channelId, seq, mention: false, thread_root_seq: null, follows: false },
      })),
    ]);
  });
}

// Push fan-out runs in after(); 10 at a time keeps sockets and DB connections bounded.
// ponytail: one push_subscriptions lookup per recipient (ACT-06). ceiling: 10 concurrent
// indexed lookups. upgrade: batch the lookup (or move fan-out to Inngest) past ~100 recipients.
const PUSH_CONCURRENCY = 10;

/**
 * After a send: one REST batch with message.new for open viewers plus a hint
 * for every user to notify (DM partners, mentions, thread followers), then web
 * push for the ones whose preferences allow it. Muted members only get the hint.
 */
export function publishSentMessage(input: {
  message: ChatMessageView;
  notify: string[];
  mentioned: string[];
  /** Mentioned but muted: a hint for the badge, never a push. */
  muted?: string[];
  /** Thread followers among `notify` (a reply counts in the Inbox only for them). */
  follows?: string[];
  /** "#design", a group chat's name, or null for a DM. */
  channelLabel: string | null;
}) {
  const { message, notify, mentioned } = input;
  const muted = new Set(input.muted ?? []);
  const follows = new Set(input.follows ?? []);
  after(async () => {
    const events: ServerBroadcast[] = [
      { topic: channelTopic(message.channel_id), event: "message.new", payload: message as unknown as Record<string, unknown> },
      ...notify.map((userId) => ({
        topic: userTopic(userId),
        event: "hint",
        payload: {
          channel_id: message.channel_id,
          seq: message.seq,
          mention: mentioned.includes(userId),
          thread_root_seq: message.thread_root_seq,
          follows: follows.has(userId),
        },
      })),
    ];
    await broadcast(events);
    const pushable = notify.filter((userId) => !muted.has(userId));
    if (pushable.length === 0) return;

    try {
      const recipients = await chatRows<{ id: string; notification_preferences: unknown }>(sql`
        SELECT id, notification_preferences FROM profiles WHERE id = ANY(${uuidArray(pushable)})
      `);
      const authorName = message.author?.full_name || message.author?.username || "Someone";
      // A thread reply says so ("replied in a thread in #design"), so it isn't read as a channel message.
      const title = message.thread_root_seq
        ? `${authorName} replied in a thread${input.channelLabel ? ` in ${input.channelLabel}` : ""}`
        : input.channelLabel ? `${authorName} in ${input.channelLabel}` : authorName;
      const body = previewText(message.body).slice(0, 240) || (message.attachments.length ? "Sent an attachment" : "New message");
      const now = new Date();
      const pushOne = async (recipient: (typeof recipients)[number]) => {
        const prefs = normalizeNotificationPreferences(recipient.notification_preferences);
        const isMention = mentioned.includes(recipient.id);
        if (!prefs.delivery.push || isNotificationPauseActive(prefs, now)) return;
        // Quiet hours on the recipient's clock: their saved zone, else where their browser last reported.
        const zone = prefs.quietHours.enabled && !prefs.quietHours.timeZone
          ? await getRedisClient()?.get<string>(`presence:tz:${recipient.id}`).catch(() => null) ?? null
          : null;
        if (isQuietHoursActive(prefs, now, zone)) return;
        // A thread reply (not a mention) pushes only if they want thread replies.
        if (message.thread_root_seq && !isMention && !prefs.chat.threadReplies) return;
        // Channel notify settings already shaped `notify`; the global switch left is mentions.
        if (isMention && !prefs.mentions) return;
        // One push per conversation per 30 s, but an @mention always gets through.
        if (!allowPush(recipient.id, message.channel_id) && !isMention) return;
        await sendPushToUser(recipient.id, {
          id: `${message.channel_id}:${message.seq}`,
          title,
          // Lock-screen privacy: who and where, without what.
          body: prefs.chat.showPreview ? body : "New message",
          href: messageHref(message.channel_id, message.seq, message.thread_root_seq),
          icon: message.author?.avatar_url ?? null,
          tag: `chat:${message.channel_id}`,
        }, { notificationId: null, topic: chatPushTopic(message.channel_id), recordDeliveries: false });
      };
      for (let i = 0; i < recipients.length; i += PUSH_CONCURRENCY) {
        await Promise.all(recipients.slice(i, i + PUSH_CONCURRENCY).map(pushOne));
      }
    } catch (error) {
      logger.warn("chat.push_failed", { module: "chat", error: error instanceof Error ? error.message : String(error) });
    }
  });
}

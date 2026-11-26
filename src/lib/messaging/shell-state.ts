import { isUnread } from "@/lib/messaging/channel-view";
import type { ChatBootstrap, ChatChannelSummary } from "@/lib/messaging/types";

// Pure updates to the cached bootstrap, shared by the shell provider and tests.

/** `follows`: the reply is in a thread this user follows (only then does it count in the Inbox). */
export type ChatHint = {
  channel_id: string; seq: number; mention: boolean; thread_root_seq: number | null; follows?: boolean;
  /** A top-level message: the row's new preview (names, not codes), its time and author. */
  preview?: string | null; at?: string; author_id?: string;
};

/** DMs and unnamed group chats: each counts once when unread. */
export function isDirect(channel: Pick<ChatChannelSummary, "kind" | "name">) {
  return channel.kind === "dm" || (channel.kind === "private" && channel.name === null);
}

/**
 * One badge rule (app nav, launcher, tab title): unread DMs and group chats + the Inbox count.
 * A DM or group with a mention is already in the Inbox, so it isn't counted twice; muted ones never count.
 */
export function chatBadge(data: ChatBootstrap | undefined) {
  if (!data) return 0;
  let count = data.inbox_unread ?? 0;
  for (const channel of data.channels) {
    if (channel.notify === "mute" || !isDirect(channel)) continue;
    if (isUnread(channel) && channel.mention_count === 0) count += 1;
  }
  return count;
}

/** Poll results carry only changed channels and no projects. */
export function mergeDelta(current: ChatBootstrap, delta: ChatBootstrap): ChatBootstrap {
  const changed = new Set(delta.channels.map((channel) => channel.id));
  return {
    ...delta,
    projects: delta.projects ?? current.projects,
    channels: [...delta.channels, ...current.channels.filter((channel) => !changed.has(channel.id))],
  };
}

function patchChannel(data: ChatBootstrap, channelId: string, patch: (channel: ChatChannelSummary) => ChatChannelSummary | null) {
  const index = data.channels.findIndex((channel) => channel.id === channelId);
  const channel = data.channels[index];
  if (!channel) return null;
  const next = patch(channel);
  if (!next) return data;
  const channels = data.channels.slice();
  channels[index] = next;
  return { ...data, channels };
}

export type InboxCounts = { inbox_unread?: number; inbox_mentions?: number; threads_unread?: number };

/** The server's fresh Inbox counts (sent after reads), applied as they are. */
export function applyInboxCounts(data: ChatBootstrap, counts: InboxCounts) {
  const next = { ...data };
  for (const key of ["inbox_unread", "inbox_mentions", "threads_unread"] as const) {
    if (typeof counts[key] === "number") next[key] = counts[key];
  }
  return next;
}

/**
 * Returns null when the channel is not cached yet (caller refetches). A mention or a
 * reply in a followed thread also bumps the Inbox badge. Muted conversations: mentions
 * still count, thread replies don't (same rule as the server).
 */
export function applyHint(data: ChatBootstrap, hint: ChatHint) {
  const next = patchChannel(data, hint.channel_id, (channel) => {
    if (hint.seq <= channel.last_seq) return null;
    return {
      ...channel,
      last_seq: hint.seq,
      last_top_seq: hint.thread_root_seq === null ? hint.seq : channel.last_top_seq,
      mention_count: channel.mention_count + (hint.mention ? 1 : 0),
      // Hints come from other people: a top-level one is one more to read.
      ...(hint.thread_root_seq === null ? { unread_count: (channel.unread_count ?? 0) + 1 } : {}),
      ...(hint.thread_root_seq === null && hint.preview !== undefined
        ? { last_preview: hint.preview, last_message_at: hint.at ?? channel.last_message_at, last_author_id: hint.author_id ?? channel.last_author_id }
        : {}),
    };
  });
  if (!next || next === data) return next;
  const muted = data.channels.find((channel) => channel.id === hint.channel_id)?.notify === "mute";
  const inbox = hint.mention || (!muted && hint.thread_root_seq !== null && hint.follows === true);
  if (!inbox) return next;
  return { ...next, inbox_unread: (next.inbox_unread ?? 0) + 1, inbox_mentions: (next.inbox_mentions ?? 0) + (hint.mention ? 1 : 0) };
}

/** A thread read recounts its conversation's @ count on the server; this applies it. */
export function applyMentionCount(data: ChatBootstrap, channelId: string, count: number) {
  return patchChannel(data, channelId, (channel) => (channel.mention_count === count ? null : { ...channel, mention_count: count })) ?? data;
}

export function applyReadMoved(data: ChatBootstrap, channelId: string, seq: number) {
  return patchChannel(data, channelId, (channel) =>
    seq > channel.last_read_seq ? { ...channel, last_read_seq: seq, mention_count: 0, ...(seq >= channel.last_top_seq ? { unread_count: 0 } : {}) } : null,
  ) ?? data;
}

/**
 * A DM, or a group down to two outside any project, across a block in either direction takes no replies (Blocking
 * B44, the same rule as app_private.chat_contact_cut). Only the viewer's own block is named; the other way reads as
 * "can't reply".
 */
export function withBlockState(channels: ChatChannelSummary[], userId: string, blocks: { blocker_id: string; blocked_id: string }[]) {
  if (!blocks.length) return channels;
  const mine = new Set(blocks.filter((b) => b.blocker_id === userId).map((b) => b.blocked_id));
  const either = new Set(blocks.map((b) => (b.blocker_id === userId ? b.blocked_id : b.blocker_id)));
  return channels.map((channel) => {
    const pairGroup = channel.kind === "private" && !channel.project_id && !channel.application_id && channel.member_count === 2;
    const other = channel.kind === "dm" ? channel.dm_user?.id : pairGroup ? channel.members_preview?.[0]?.id : undefined;
    if (!other || !either.has(other)) return channel;
    return { ...channel, reply_closed: true, blocked_by_me: mine.has(other) };
  });
}

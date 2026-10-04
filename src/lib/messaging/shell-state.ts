import type { ChatBootstrap, ChatChannelSummary } from "@/lib/messaging/types";

// Pure updates to the cached bootstrap, shared by the shell provider and tests.

export type ChatHint = { channel_id: string; seq: number; mention: boolean; thread_root_seq: number | null };

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
    if (channel.last_top_seq > channel.last_read_seq && channel.mention_count === 0) count += 1;
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
 * thread reply also bumps the Inbox badge. Muted conversations: mentions still count,
 * thread replies don't (same rule as the server).
 */
export function applyHint(data: ChatBootstrap, hint: ChatHint) {
  const next = patchChannel(data, hint.channel_id, (channel) => {
    if (hint.seq <= channel.last_seq) return null;
    return {
      ...channel,
      last_seq: hint.seq,
      last_top_seq: hint.thread_root_seq === null ? hint.seq : channel.last_top_seq,
      mention_count: channel.mention_count + (hint.mention ? 1 : 0),
    };
  });
  if (!next || next === data) return next;
  const muted = data.channels.find((channel) => channel.id === hint.channel_id)?.notify === "mute";
  const inbox = hint.mention || (!muted && hint.thread_root_seq !== null);
  if (!inbox) return next;
  return { ...next, inbox_unread: (next.inbox_unread ?? 0) + 1, inbox_mentions: (next.inbox_mentions ?? 0) + (hint.mention ? 1 : 0) };
}

export function applyReadMoved(data: ChatBootstrap, channelId: string, seq: number) {
  return patchChannel(data, channelId, (channel) =>
    seq > channel.last_read_seq ? { ...channel, last_read_seq: seq, mention_count: 0 } : null,
  ) ?? data;
}

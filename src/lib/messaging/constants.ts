// Mirrors of the limits enforced in drizzle/0014_messaging.sql.
// The database is authoritative; these exist for client-side validation and copy.
export const CHAT_MAX_BODY = 4000;
export const CHAT_MAX_ATTACHMENTS = 10;
export const CHAT_MAX_DESCRIPTION = 250;
export const CHAT_MAX_GROUP_OTHERS = 8;
export const CHAT_CHANNEL_NAME_PATTERN = /^[a-z0-9-]{1,80}$/;
// ponytail: @channel/@here only up to 100 members (L-13). ceiling: inline
// fan-out. upgrade: async batches for larger channels.
export const CHAT_BROADCAST_MENTION_MAX_MEMBERS = 100;
// ponytail: typing only in channels of 50 or fewer, throttled 3.5 s (L-7).
// ceiling: 50 typers per room. upgrade: server-side aggregation.
export const CHAT_TYPING_MAX_MEMBERS = 50;
export const CHAT_TYPING_THROTTLE_MS = 3_500;
/** A typer disappears this long after their last signal. */
export const CHAT_TYPING_TTL_MS = 5_000;
export const CHAT_PAGE_SIZE = 50;
/** One page size for the lists: Inbox, Threads, Saved and Search (each has "Load more"). */
export const CHAT_LIST_PAGE = 50;
export const CHAT_READ_DEBOUNCE_MS = 3_000;
// ponytail: background unread by poll (L-2), not per-channel live topics.
// ceiling: up to ~2 min staleness. upgrade: tick topics for the top-N channels.
export const CHAT_POLL_BASE_MS = 90_000;
export const CHAT_POLL_JITTER_MS = 30_000;

export function channelTopic(channelId: string) {
  return `chat:channel:${channelId}`;
}

/** Typing on/off; the only topic browsers may send on (0183). */
export function typingTopic(channelId: string) {
  return `chat:typing:${channelId}`;
}

export function userTopic(userId: string) {
  return `chat:user:${userId}`;
}

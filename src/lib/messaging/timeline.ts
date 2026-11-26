import { formatMessageCalendarLabel, getMessageCalendarDay } from "@/lib/messaging/date-buckets";
import type { ChatMessageView, ChatReactionView } from "@/lib/messaging/types";

// Pure timeline helpers: render items, live-event reducers over the paged
// cache (pages[0] is the newest page, each page oldest → newest), and the Aa
// toolbar's markdown insertion.

const GROUP_WINDOW_MS = 5 * 60_000;

export type TimelineItem =
  | { type: "day"; key: string; label: string }
  | { type: "new"; key: string }
  | { type: "message"; key: string; message: ChatMessageView; grouped: boolean; others?: ChatMessageView[] };

const COLLAPSIBLE_SYSTEM = new Set(["joined", "left"]);

export function buildTimeline(
  messages: ChatMessageView[],
  options: { lastReadSeq: number; meId: string | null; timeZone?: string | null; now?: Date },
): TimelineItem[] {
  const items: TimelineItem[] = [];
  let day = "";
  let previous: ChatMessageView | null = null;
  let newPlaced = false;
  for (const message of messages) {
    // A deleted message nobody replied to just goes (like Slack); one with replies keeps its line.
    if (message.deleted_at && !message.reply_count) continue;
    const calendar = getMessageCalendarDay(message.created_at, options.timeZone);
    let dayBreak = false;
    if (calendar.key !== day) {
      day = calendar.key;
      dayBreak = true;
      items.push({ type: "day", key: `day:${day}`, label: formatMessageCalendarLabel(day, { now: options.now, timeZone: options.timeZone }) });
    }
    let divider = false;
    if (!newPlaced && message.seq > options.lastReadSeq && message.seq > 0 && message.author_id !== options.meId) {
      newPlaced = true;
      divider = true;
      items.push({ type: "new", key: "new" });
    }
    // "Ana and 4 others joined": a run of the same join/leave line becomes one row.
    const last = items[items.length - 1];
    if (
      !dayBreak && !divider && message.kind === "system" && COLLAPSIBLE_SYSTEM.has(message.body)
      && last?.type === "message" && last.message.kind === "system" && last.message.body === message.body
    ) {
      last.others = [...(last.others ?? []), message];
      previous = message;
      continue;
    }
    const grouped = Boolean(
      previous && !dayBreak && !divider && message.kind === "user" && previous.kind === "user"
        && previous.author_id === message.author_id && !previous.deleted_at
        && Date.parse(message.created_at) - Date.parse(previous.created_at) < GROUP_WINDOW_MS,
    );
    items.push({ type: "message", key: message.client_message_id ? `c:${message.client_message_id}` : `s:${message.seq}`, message, grouped });
    previous = message;
  }
  return items;
}

export type MessagePages = ChatMessageView[][];

export function patchPages(pages: MessagePages, seq: number, patch: (message: ChatMessageView) => ChatMessageView): MessagePages {
  let changed = false;
  const next = pages.map((page) => page.map((message) => {
    if (message.seq !== seq) return message;
    changed = true;
    return patch(message);
  }));
  return changed ? next : pages;
}

/**
 * The server's copy of your message keeps the on-device previews of its files (same asset),
 * so a photo you just sent doesn't flash while the uploaded copy loads.
 * ponytail: the preview's blob URL lives until the page closes. ceiling: a few MB for a heavy
 * photo session. upgrade: revoke once the server image has loaded.
 */
export function keepLocalPreviews(server: ChatMessageView, optimistic: ChatMessageView | undefined): ChatMessageView {
  if (!optimistic?.attachments.some((a) => a.local_url)) return server;
  return {
    ...server,
    attachments: server.attachments.map((a) => {
      const local = optimistic.attachments.find((o) => o.asset_id === a.asset_id);
      return local?.local_url ? { ...a, local_url: local.local_url, width: a.width ?? local.width, height: a.height ?? local.height } : a;
    }),
  };
}

/**
 * A new or confirmed message. Top-level messages append to the newest page (an
 * optimistic copy with the same client id is replaced); replies only update
 * their root's reply line.
 */
export function upsertMessage(pages: MessagePages, message: ChatMessageView): MessagePages {
  if (message.thread_root_seq !== null) {
    return patchPages(pages, message.thread_root_seq, (root) =>
      root.last_reply_seq !== null && root.last_reply_seq >= message.seq
        ? root
        : {
            ...root, reply_count: root.reply_count + 1, last_reply_seq: message.seq, last_reply_at: message.created_at,
            // The thread link's faces: this reply's author first, no repeats, three at most.
            last_repliers: message.author_id ? [message.author_id, ...(root.last_repliers ?? []).filter((id) => id !== message.author_id)].slice(0, 3) : root.last_repliers,
          },
    );
  }
  const [newest = [], ...older] = pages;
  const index = newest.findIndex((m) => m.seq === message.seq || (message.client_message_id !== null && m.client_message_id === message.client_message_id));
  if (index >= 0) {
    const page = newest.slice();
    page[index] = keepLocalPreviews({ ...newest[index]!, ...message }, newest[index]);
    return [page, ...older];
  }
  if (pages.some((page) => page.some((m) => m.seq === message.seq))) return pages;
  return [[...newest, message], ...older];
}

/** `userId` keeps a poll's voter list in step when the message has one (never made up for one that doesn't); `poll` starts one on a fresh poll. */
export function applyReaction(reactions: ChatReactionView[], emoji: string, on: boolean, mine: boolean, userId?: string, poll = false): ChatReactionView[] {
  const existing = reactions.find((r) => r.emoji === emoji);
  const voters = (r: ChatReactionView) => (r.user_ids && userId ? { user_ids: on ? [userId, ...r.user_ids.filter((id) => id !== userId)] : r.user_ids.filter((id) => id !== userId) } : {});
  const tracked = poll || reactions.some((r) => Array.isArray(r.user_ids));
  if (on) {
    if (existing) return reactions.map((r) => (r.emoji === emoji ? { ...r, count: r.count + 1, me: r.me || mine, ...voters(r) } : r));
    return [...reactions, { emoji, count: 1, me: mine, ...(tracked && userId ? { user_ids: [userId] } : {}) }];
  }
  if (!existing) return reactions;
  if (existing.count <= 1) return reactions.filter((r) => r.emoji !== emoji);
  return reactions.map((r) => (r.emoji === emoji ? { ...r, count: r.count - 1, me: mine ? false : r.me, ...voters(r) } : r));
}

/** "N new" on the jump pill: messages newer than `seq` from someone else (older pages don't count). */
export function newFromOthers(messages: readonly ChatMessageView[], seq: number, meId: string | null) {
  return messages.filter((m) => m.seq > seq && m.author_id !== meId).length;
}

import assert from "node:assert/strict";
import test from "node:test";

import { applyReaction, buildTimeline, insertMarkdown, patchPages, upsertMessage } from "@/lib/messaging/timeline";
import type { ChatMessageView } from "@/lib/messaging/types";

function msg(seq: number, patch: Partial<ChatMessageView> = {}): ChatMessageView {
  return {
    channel_id: "c1", seq, author_id: "u1", author: null, kind: "user", body: `m${seq}`, thread_root_seq: null,
    reply_count: 0, last_reply_seq: null, last_reply_at: null, edited_at: null, deleted_at: null,
    created_at: new Date(2026, 9, 1, 9, seq).toISOString(), client_message_id: null, attachments: [], reactions: [], card: null, pinned: false,
    ...patch,
  };
}

test("timeline adds day labels, groups an author within 5 minutes, and puts New before the first unread", () => {
  const items = buildTimeline(
    [msg(1), msg(2), msg(3, { author_id: "u2" }), msg(4, { author_id: "u2", created_at: new Date(2026, 9, 2, 9, 0).toISOString() })],
    { lastReadSeq: 2, meId: "u1", now: new Date(2026, 9, 2, 12, 0) },
  );
  assert.deepEqual(
    items.map((item) => (item.type === "message" ? `${item.message.seq}${item.grouped ? "g" : ""}` : item.type === "day" ? `day:${item.label}` : item.type)),
    ["day:Yesterday", "1", "2g", "new", "3", "day:Today", "4"],
  );
});

test("own messages never open the New divider", () => {
  const items = buildTimeline([msg(1), msg(2)], { lastReadSeq: 0, meId: "u1" });
  assert.equal(items.some((item) => item.type === "new"), false);
});

test("upsert appends new messages, replaces optimistic ones by client id, and bumps thread roots", () => {
  const pages = [[msg(1), msg(2)]];
  const pending = upsertMessage(pages, msg(-1, { client_message_id: "tmp-1", body: "hi" }));
  assert.deepEqual(pending[0]!.map((m) => m.seq), [1, 2, -1]);
  const confirmed = upsertMessage(pending, msg(3, { client_message_id: "tmp-1", body: "hi" }));
  assert.deepEqual(confirmed[0]!.map((m) => m.seq), [1, 2, 3]);
  const reply = upsertMessage(confirmed, msg(4, { thread_root_seq: 2, created_at: new Date(2026, 9, 1, 10, 0).toISOString() }));
  assert.deepEqual(reply[0]!.map((m) => m.seq), [1, 2, 3], "replies stay out of the main timeline");
  assert.equal(reply[0]![1]!.reply_count, 1);
  assert.equal(reply[0]![1]!.last_reply_seq, 4);
  assert.equal(upsertMessage(reply, msg(4, { thread_root_seq: 2 }))[0]![1]!.reply_count, 1, "a repeated reply is counted once");
});

test("patchPages and reactions update in place", () => {
  const pages = [[msg(1, { reactions: [{ emoji: "👍", count: 1, me: false }] })]];
  const reacted = patchPages(pages, 1, (m) => ({ ...m, reactions: applyReaction(m.reactions, "👍", true, true) }));
  assert.deepEqual(reacted[0]![0]!.reactions, [{ emoji: "👍", count: 2, me: true }]);
  const removed = patchPages(reacted, 1, (m) => ({ ...m, reactions: applyReaction(m.reactions, "👍", false, false) }));
  assert.deepEqual(removed[0]![0]!.reactions, [{ emoji: "👍", count: 1, me: true }]);
  const gone = patchPages(pages, 1, (m) => ({ ...m, reactions: applyReaction(m.reactions, "👍", false, false) }));
  assert.deepEqual(gone[0]![0]!.reactions, []);
});

test("markdown insertion wraps the selection or inserts a placeholder", () => {
  assert.deepEqual(insertMarkdown("hello world", 6, 11, "bold"), { value: "hello **world**", start: 8, end: 13 });
  assert.deepEqual(insertMarkdown("", 0, 0, "code"), { value: "`code`", start: 1, end: 5 });
  assert.deepEqual(insertMarkdown("a\nb", 0, 3, "bullet"), { value: "- a\n- b", start: 0, end: 7 });
  assert.deepEqual(insertMarkdown("x", 0, 1, "link"), { value: "[x](https://)", start: 4, end: 12 });
  assert.deepEqual(insertMarkdown("one", 0, 3, "codeblock"), { value: "```\none\n```", start: 4, end: 7 });
});

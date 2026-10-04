import assert from "node:assert/strict";
import test from "node:test";

import { rowCount } from "@/lib/messaging/channel-view";
import { applyHint } from "@/lib/messaging/shell-state";
import type { ChatBootstrap, ChatChannelSummary } from "@/lib/messaging/types";

function channel(id: string, patch: Partial<ChatChannelSummary> = {}): ChatChannelSummary {
  return {
    id, kind: "public", name: id, topic: null, project_id: "p1", application_id: null, is_default: false,
    last_seq: 5, last_top_seq: 5, last_read_seq: 5, mention_count: 0, notify: "all", starred: false,
    archived_at: null, channel_archived_at: null, last_message_at: null, last_preview: null, last_author_id: null,
    member_count: 2, role: "member", dm_user: null, members_preview: null, ...patch,
  };
}
const data = (channels: ChatChannelSummary[]): ChatBootstrap => ({ server_time: "", activity_latest_at: null, inbox_unread: 2, channels, projects: [] });

test("a mention or thread-reply hint bumps the Inbox badge; a plain DM message doesn't", () => {
  const base = data([channel("c1"), channel("dm", { kind: "dm", name: null, project_id: null })]);
  assert.equal(applyHint(base, { channel_id: "c1", seq: 6, mention: true, thread_root_seq: null })?.inbox_unread, 3);
  assert.equal(applyHint(base, { channel_id: "c1", seq: 6, mention: false, thread_root_seq: 2 })?.inbox_unread, 3);
  assert.equal(applyHint(base, { channel_id: "dm", seq: 6, mention: false, thread_root_seq: null })?.inbox_unread, 2);
});

test("a muted conversation's hint never bumps the Inbox badge", () => {
  const base = data([channel("c1", { notify: "mute" })]);
  assert.equal(applyHint(base, { channel_id: "c1", seq: 6, mention: true, thread_root_seq: null })?.inbox_unread, 2);
});

test("DM count is top-level messages only, like bold", () => {
  const dm = channel("dm", { kind: "dm", name: null, project_id: null, last_seq: 9, last_top_seq: 6, last_read_seq: 4 });
  assert.equal(rowCount(dm), 2);
});

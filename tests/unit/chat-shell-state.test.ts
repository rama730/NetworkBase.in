import assert from "node:assert/strict";
import test from "node:test";

import { applyHint, applyReadMoved, chatBadge, mergeDelta } from "@/lib/messaging/shell-state";
import type { ChatBootstrap, ChatChannelSummary } from "@/lib/messaging/types";

function channel(id: string, patch: Partial<ChatChannelSummary> = {}): ChatChannelSummary {
  return {
    id, kind: "public", name: id, topic: null, project_id: null, application_id: null, is_default: false,
    last_seq: 0, last_top_seq: 0, last_read_seq: 0, mention_count: 0, notify: "all", starred: false,
    archived_at: null, channel_archived_at: null, last_message_at: null, last_preview: null, last_author_id: null,
    member_count: 2, role: "member", dm_user: null, members_preview: null, ...patch,
  };
}

function boot(channels: ChatChannelSummary[]): ChatBootstrap {
  return { server_time: "2026-10-02T00:00:00Z", activity_latest_at: null, channels, projects: [] };
}

test("badge counts mentions plus unread DMs and group chats, never muted ones", () => {
  const data = boot([
    channel("general", { mention_count: 2, last_top_seq: 9 }),
    channel("dm", { kind: "dm", name: null, last_top_seq: 3, last_read_seq: 1 }),
    channel("group", { kind: "private", name: null, last_top_seq: 4, last_read_seq: 2, mention_count: 1 }),
    channel("muted-dm", { kind: "dm", name: null, last_top_seq: 5, notify: "mute" }),
    channel("read-dm", { kind: "dm", name: null, last_top_seq: 5, last_read_seq: 5 }),
  ]);
  assert.equal(chatBadge(data), 2 + 1 + 1, "general mentions, dm, group (its mention is the same unread)");
});

test("a delta replaces changed channels and keeps projects from the full load", () => {
  const full = boot([channel("a"), channel("b")]);
  const delta = { ...boot([channel("b", { last_top_seq: 7 }), channel("c")]), projects: null, server_time: "2026-10-02T00:01:30Z" };
  const merged = mergeDelta(full, delta);
  assert.deepEqual(merged.channels.map((c) => [c.id, c.last_top_seq]), [["b", 7], ["c", 0], ["a", 0]]);
  assert.equal(merged.projects, full.projects);
  assert.equal(merged.server_time, delta.server_time);
});

test("hints patch known channels and report unknown ones", () => {
  const data = boot([channel("dm", { kind: "dm", last_seq: 3, last_top_seq: 3 })]);
  const top = applyHint(data, { channel_id: "dm", seq: 4, mention: false, thread_root_seq: null });
  assert.equal(top?.channels[0].last_top_seq, 4);
  const reply = applyHint(data, { channel_id: "dm", seq: 5, mention: true, thread_root_seq: 2 });
  assert.equal(reply?.channels[0].last_top_seq, 3, "thread replies never raise top-level unread");
  assert.equal(reply?.channels[0].mention_count, 1);
  assert.equal(applyHint(data, { channel_id: "dm", seq: 2, mention: false, thread_root_seq: null }), data, "stale hint is a no-op");
  assert.equal(applyHint(data, { channel_id: "new", seq: 1, mention: false, thread_root_seq: null }), null);
});

test("read.moved only moves the cursor forward and clears mentions", () => {
  const data = boot([channel("a", { last_top_seq: 9, last_read_seq: 4, mention_count: 3 })]);
  assert.deepEqual(
    [applyReadMoved(data, "a", 9).channels[0].last_read_seq, applyReadMoved(data, "a", 9).channels[0].mention_count],
    [9, 0],
  );
  assert.equal(applyReadMoved(data, "a", 2), data);
});

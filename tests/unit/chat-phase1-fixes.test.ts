import assert from "node:assert/strict";
import test from "node:test";

import { matchMentions } from "@/components/messages/parts/MentionDropdown";
import { sidebarOrder } from "@/lib/messaging/channel-view";
import { messageHref } from "@/lib/messaging/routes";
import { newFromOthers } from "@/lib/messaging/timeline";
import type { ChatBootstrap, ChatChannelSummary, ChatMessageView } from "@/lib/messaging/types";

function channel(id: string, patch: Partial<ChatChannelSummary> = {}): ChatChannelSummary {
  return {
    id, kind: "public", name: id, topic: null, project_id: "p1", application_id: null, is_default: false,
    last_seq: 0, last_top_seq: 0, last_read_seq: 0, mention_count: 0, notify: "all", starred: false,
    archived_at: null, channel_archived_at: null, last_message_at: null, last_preview: null, last_author_id: null,
    member_count: 2, role: "member", dm_user: null, members_preview: null, ...patch,
  };
}

const priya = { id: "u2", username: "priya", full_name: "Priya Shah", avatar_url: null };
const data: ChatBootstrap = {
  server_time: "2026-10-02T00:00:00Z",
  activity_latest_at: null,
  projects: [
    { id: "p1", title: "Payments", slug: null, cover_image: null, role: "owner" },
    { id: "p2", title: "Atlas", slug: null, cover_image: null, role: "member" },
  ],
  channels: [
    channel("general", { is_default: true, last_message_at: "2026-10-01T09:00:00Z" }),
    channel("design", { starred: true }),
    channel("atlas-general", { project_id: "p2", last_message_at: "2026-10-01T10:00:00Z" }),
    channel("dm", { kind: "dm", name: null, project_id: null, dm_user: priya, last_message_at: "2026-10-01T08:00:00Z" }),
    channel("app-mine", { kind: "private", name: null, project_id: "p9", application_id: "a2" }),
  ],
};

test("sidebarOrder follows the sidebar: applications, starred once, then channels, DMs", () => {
  assert.deepEqual(sidebarOrder(data, "p1").map((c) => c.id), ["app-mine", "design", "general", "dm"]);
  // All projects: groups by latest activity (Atlas first), each #general first.
  assert.deepEqual(sidebarOrder(data, null).map((c) => c.id), ["app-mine", "design", "atlas-general", "general", "dm"]);
});

test("a thread reply's link opens its thread; a channel message links by seq", () => {
  assert.equal(messageHref("c1", 9, 4), "/messages/c1?m=9&thread=4");
  assert.equal(messageHref("c1", 9, null), "/messages/c1?m=9");
});

test("an @query with no match shows nothing, so Enter can send", () => {
  const people = [{ id: "1", username: "priya", fullName: "Priya Shah", avatarUrl: null }];
  assert.equal(matchMentions(people, "zz").length, 0);
  assert.equal(matchMentions(people, "pri").length, 1);
});

test('"N new" counts newer messages from others, not older pages or your own', () => {
  const m = (seq: number, author: string) => ({ seq, author_id: author }) as ChatMessageView;
  const timeline = [m(1, "u2"), m(2, "u2"), m(10, "u2"), m(11, "me"), m(12, "u2")];
  assert.equal(newFromOthers(timeline, 10, "me"), 1);
  assert.equal(newFromOthers([m(1, "u2"), m(2, "u2")], 10, "me"), 0);
});

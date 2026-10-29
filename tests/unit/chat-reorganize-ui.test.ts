import assert from "node:assert/strict";
import test from "node:test";

import { conversationTabs } from "@/lib/messaging/channel-tabs";
import { channelTitle, channelsByProject, needsAttention, sectionsFor } from "@/lib/messaging/channel-view";
import { asDetailsTab, conversationHref, threadHref } from "@/lib/messaging/routes";
import type { ChatBootstrap, ChatChannelSummary } from "@/lib/messaging/types";

function channel(id: string, patch: Partial<ChatChannelSummary> = {}): ChatChannelSummary {
  return {
    id, kind: "public", name: id, title: null, topic: null, project_id: "p1", application_id: null, is_default: false,
    last_seq: 1, last_top_seq: 1, last_read_seq: 1, mention_count: 0, notify: "all", starred: false, archived_at: null,
    channel_archived_at: null, last_message_at: "2026-10-01T09:00:00Z", last_preview: null, last_author_id: null,
    member_count: 2, role: "member", dm_user: null, members_preview: null, ...patch,
  };
}

const ids = (tabs: { id: string }[]) => tabs.map((t) => t.id);

test("tabs: Messages always; Pins once pinned (or open); canvas unless hidden; Files and Tasks only when added", () => {
  const base = { pinCount: 0, canvasTitle: null, canvasHidden: false, active: "messages", shared: [], projectId: "p1" };
  assert.deepEqual(ids(conversationTabs(base)), ["messages"], "Files isn't open by default");
  assert.deepEqual(ids(conversationTabs({ ...base, active: "files" })), ["messages"], "Files is one shared tab, added from +");
  assert.deepEqual(ids(conversationTabs({ ...base, pinCount: 2 })), ["messages", "pins"]);
  assert.deepEqual(ids(conversationTabs({ ...base, active: "pins" })), ["messages", "pins"], "an open Pins tab stays while empty");
  assert.deepEqual(ids(conversationTabs({ ...base, canvasTitle: "Plan" })), ["messages", "canvas"]);
  assert.deepEqual(ids(conversationTabs({ ...base, canvasTitle: "Plan", canvasHidden: true })), ["messages"], "hidden for you");
  assert.deepEqual(ids(conversationTabs({ ...base, canvasTitle: "Plan", canvasHidden: true, active: "canvas" })), ["messages", "canvas"]);
  const shared = [
    { id: "f", kind: "files" as const, title: "Files", url: null },
    { id: "t", kind: "tasks" as const, title: "Tasks", url: null },
    { id: "b", kind: "link" as const, title: "Spec", url: "https://x.test" },
  ];
  assert.deepEqual(ids(conversationTabs({ ...base, shared })), ["messages", "f", "t", "b"]);
  assert.deepEqual(ids(conversationTabs({ ...base, shared, active: "f" })), ["messages", "f", "t", "b"], "no duplicate Files tab");
  assert.deepEqual(ids(conversationTabs({ ...base, shared, projectId: null })), ["messages", "f", "b"], "no Tasks without a project");
  assert.ok(conversationTabs({ ...base, shared }).filter((t) => t.shared).every((t) => ["f", "t", "b"].includes(t.id)));
});

test("conversation URLs carry the drawers and the jump target", () => {
  assert.equal(conversationHref("c1"), "/messages/c1");
  assert.equal(conversationHref("c1", { m: 40, thread: 12, details: "members" }), "/messages/c1?m=40&thread=12&details=members");
  assert.equal(threadHref("c1", 7), "/messages/c1?thread=7");
  assert.equal(asDetailsTab("members"), "members");
  assert.equal(asDetailsTab("pins"), "about", "old ?tab=pins|settings opens About");
  assert.equal(asDetailsTab(null), null);
});

test("sidebar: starred by recent activity, All workspaces grouping, unread attention", () => {
  const data: ChatBootstrap = {
    server_time: "", activity_latest_at: null,
    projects: [{ id: "p1", title: "One", slug: null, cover_image: null, role: "member" }, { id: "p2", title: "Two", slug: null, cover_image: null, role: "member" }],
    channels: [
      channel("a", { starred: true, last_message_at: "2026-10-01T08:00:00Z" }),
      channel("b", { starred: true, last_message_at: "2026-10-01T10:00:00Z" }),
      channel("c", { project_id: "p2", is_default: true }),
      channel("d", { project_id: "p2", application_id: "app" }),
      channel("muted", { project_id: "p2", notify: "mute", last_top_seq: 5 }),
    ],
  };
  assert.deepEqual(sectionsFor(data, null).starred.map((c) => c.id), ["b", "a"]);
  const groups = channelsByProject(data);
  assert.deepEqual(groups.get("p1")?.map((c) => c.id), ["a", "b"]);
  assert.deepEqual(groups.get("p2")?.map((c) => c.id), ["c", "muted"], "default first; application threads live in their own section");
  assert.deepEqual(sectionsFor(data, null).applications.map((c) => c.id), ["d"]);
  assert.equal(needsAttention(channel("x", { last_top_seq: 3 })), true);
  assert.equal(needsAttention(channel("x", { mention_count: 1 })), true);
  assert.equal(needsAttention(channel("x", { last_top_seq: 3, notify: "mute" })), false, "muted never counts");
});

test("group chats show their name, else member first names", () => {
  const group = channel("g", { kind: "private", name: null, project_id: null, members_preview: [{ id: "u", username: null, full_name: "Ana Lima", avatar_url: null }] });
  assert.equal(channelTitle(group, "me"), "Ana");
  assert.equal(channelTitle({ ...group, title: "Crew" }, "me"), "Crew");
});

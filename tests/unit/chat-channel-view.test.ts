import assert from "node:assert/strict";
import test from "node:test";

import { channelTitle, projectsByActivity, railBadges, rowCount, sectionsFor } from "@/lib/messaging/channel-view";
import type { ChatBootstrap, ChatChannelSummary } from "@/lib/messaging/types";

function channel(id: string, patch: Partial<ChatChannelSummary> = {}): ChatChannelSummary {
  return {
    id, kind: "public", name: id, topic: null, project_id: "p1", application_id: null, is_default: false,
    last_seq: 0, last_top_seq: 0, last_read_seq: 0, mention_count: 0, notify: "all", starred: false,
    archived_at: null, channel_archived_at: null, last_message_at: null, last_preview: null, last_author_id: null,
    member_count: 2, role: "member", dm_user: null, members_preview: null, ...patch,
  };
}

const me = { id: "me", username: "me", full_name: "Me Person", avatar_url: null };
const priya = { id: "u2", username: "priya", full_name: "Priya Shah", avatar_url: null };

const data: ChatBootstrap = {
  server_time: "2026-10-02T00:00:00Z",
  activity_latest_at: null,
  projects: [
    { id: "p1", title: "Payments", slug: null, cover_image: null, role: "owner" },
    { id: "p2", title: "Atlas", slug: null, cover_image: null, role: "member" },
  ],
  channels: [
    channel("general", { is_default: true, mention_count: 2, last_top_seq: 5, last_message_at: "2026-10-01T09:00:00Z" }),
    channel("design", { starred: true }),
    channel("old", { channel_archived_at: "2026-09-01T00:00:00Z" }),
    channel("atlas-general", { project_id: "p2", last_message_at: "2026-10-01T10:00:00Z" }),
    channel("app-review", { kind: "private", name: null, application_id: "a1", last_seq: 3, last_top_seq: 3, last_read_seq: 1 }),
    channel("app-mine", { kind: "private", name: null, project_id: "p9", application_id: "a2" }),
    channel("dm", { kind: "dm", name: null, project_id: null, dm_user: priya, last_seq: 4, last_top_seq: 4, last_read_seq: 1, last_message_at: "2026-10-01T08:00:00Z" }),
    channel("self", { kind: "dm", name: null, project_id: null, dm_user: me }),
    channel("closed", { kind: "dm", name: null, project_id: null, dm_user: priya, archived_at: "2026-09-30T00:00:00Z" }),
    channel("muted", { mention_count: 4, notify: "mute" }),
  ],
};

test("project sections split channels, applications and DMs, hiding archived rows", () => {
  const sections = sectionsFor(data, "p1");
  assert.deepEqual(sections.channels.map((c) => c.id), ["design", "general", "muted"]);
  assert.deepEqual(sections.applications.map((c) => c.id), ["app-review"]);
  assert.deepEqual(sections.dms.map((c) => c.id), ["dm", "self"]);
  assert.deepEqual(sections.starred.map((c) => c.id), ["design"]);
});

test("home shows every DM plus applications to projects you are not in", () => {
  const sections = sectionsFor(data, null);
  assert.deepEqual(sections.channels, []);
  assert.deepEqual(sections.applications.map((c) => c.id), ["app-mine"]);
  assert.deepEqual(sections.dms.map((c) => c.id), ["dm", "self"]);
});

test("titles, counts and rail badges follow the report rules", () => {
  const byId = new Map(data.channels.map((c) => [c.id, c]));
  assert.equal(channelTitle(byId.get("dm")!, "me"), "Priya Shah");
  assert.equal(channelTitle(byId.get("self")!, "me"), "You");
  assert.equal(channelTitle(channel("g", { kind: "private", name: null, members_preview: [priya, me] }), "me"), "Priya, Me");
  assert.equal(rowCount(byId.get("dm")!), 3, "DMs count unread messages");
  assert.equal(rowCount(byId.get("general")!), 2, "channels count mentions only");
  assert.equal(rowCount(byId.get("muted")!), 0);
  const badges = railBadges(data);
  assert.equal(badges.get("p1"), 2 + 1, "general mentions + unread application");
  assert.equal(badges.get(null), 1, "unread DM");
  assert.equal(badges.get("p2"), undefined);
});

test("projects order by latest activity", () => {
  assert.deepEqual(projectsByActivity(data).map((p) => p.id), ["p2", "p1"]);
});

test("formatChatTime: clock, relative, and today-vs-older auto", async () => {
  const { formatChatTime } = await import("@/lib/messaging/channel-view");
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60_000).toISOString();
  assert.equal(formatChatTime(fiveMinutesAgo, "ago"), "5m ago");
  assert.equal(formatChatTime(new Date().toISOString(), "ago"), "just now");
  const today = new Date();
  assert.equal(formatChatTime(today.toISOString()), today.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }));
  const older = new Date(2026, 0, 15, 9, 0);
  assert.equal(formatChatTime(older.toISOString()), older.toLocaleDateString(undefined, { month: "short", day: "numeric" }));
  assert.equal(formatChatTime(older.toISOString(), "clock"), older.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }));
});

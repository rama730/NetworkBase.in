import assert from "node:assert/strict";
import test from "node:test";

import { channelTitle, counterpart, projectBadges, projectsByActivity, rowCount, sectionsFor, sidebarOrder } from "@/lib/messaging/channel-view";
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

test("an open project shows its channels (#general first); applications and DMs always show", () => {
  const sections = sectionsFor(data, "p1");
  // Starred #design sits in Starred only (not repeated under Channels).
  assert.deepEqual(sections.channels.map((c) => c.id), ["general", "muted"]);
  // Every application thread is in one section: the ones you review and the ones you sent, whatever workspace is open.
  assert.deepEqual(sections.applications.map((c) => c.id).sort(), ["app-mine", "app-review"]);
  assert.deepEqual(sections.dms.map((c) => c.id), ["dm", "self"]);
  assert.deepEqual(sections.starred.map((c) => c.id), ["design"]);
});

test("with no project open there are no channels, but DMs, starred and applications remain", () => {
  const sections = sectionsFor(data, null);
  assert.deepEqual(sections.channels, []);
  assert.deepEqual(sections.applications.map((c) => c.id).sort(), ["app-mine", "app-review"]);
  assert.deepEqual(sections.dms.map((c) => c.id), ["dm", "self"]);
  assert.deepEqual(sections.starred.map((c) => c.id), ["design"]);
});

test("the sidebar order starts with Applications, the way the list is drawn", () => {
  const order = sidebarOrder(data, "p1").map((c) => c.id);
  assert.deepEqual(order.slice(0, 2).sort(), ["app-mine", "app-review"]);
  assert.equal(order[2], "design", "then Starred");
});

test("an application thread shows the other side: the applicant to a reviewer, the lead to the applicant", () => {
  const lead = { id: "u9", username: "lead", full_name: "Lena Lead", avatar_url: null };
  const meta = (isApplicant: boolean) => ({
    status: "pending" as const, role_title: "Designer", role_removed: false, project_title: "Payments", project_slug: null,
    decision_at: null, created_at: "2026-10-01T00:00:00Z", is_applicant: isApplicant, applicant: priya, lead,
  });
  assert.equal(counterpart({ application: meta(false) })?.id, "u2");
  assert.equal(counterpart({ application: meta(true) })?.id, "u9");
  assert.equal(counterpart({ application: null }), null);
  assert.equal(channelTitle(channel("a", { kind: "private", name: null, application_id: "x", application: meta(false) }), "me"), "Priya Shah · Designer");
  assert.equal(channelTitle(channel("a", { kind: "private", name: null, application_id: "x", application: meta(true) }), "me"), "Designer · Payments");
});

test("titles, counts and project badges follow the report rules", () => {
  const byId = new Map(data.channels.map((c) => [c.id, c]));
  assert.equal(channelTitle(byId.get("dm")!, "me"), "Priya Shah");
  assert.equal(channelTitle(byId.get("self")!, "me"), "You");
  assert.equal(channelTitle(channel("g", { kind: "private", name: null, members_preview: [priya, me] }), "me"), "Priya and Me");
  assert.equal(rowCount(byId.get("dm")!), 3, "DMs count unread messages");
  assert.equal(rowCount(byId.get("general")!), 2, "channels count mentions only");
  assert.equal(rowCount(byId.get("muted")!), byId.get("muted")!.mention_count, "muted channels still show their mentions (#157)");
  const badges = projectBadges(data);
  assert.equal(badges.get("p1"), 2 + 4, "general mentions + the muted channel's mentions; application threads count in their own section");
  assert.equal(badges.get("p2"), undefined);
  assert.equal(badges.size, 1, "DMs never count toward a project");
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

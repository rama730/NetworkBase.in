import type { ChatBootstrap, ChatChannelSummary, ChatPerson } from "@/lib/messaging/types";

// Pure grouping of the bootstrap into the rail and sidebar (report 7.10).
// Switching projects re-runs this in memory; it never fetches.

// ponytail: tiles by recent activity, 8 DMs per project sidebar (L-30).
// ceiling: long project lists. upgrade: pin/reorder and rail search past ~12 projects.
export const DM_SIDEBAR_LIMIT = 8;

export function personName(person: ChatPerson | null | undefined) {
  return person?.full_name || person?.username || "Someone";
}

export function isDirectLike(channel: ChatChannelSummary) {
  return !channel.application_id && (channel.kind === "dm" || (channel.kind === "private" && channel.name === null));
}

export function isSelfDm(channel: ChatChannelSummary, meId: string | null) {
  return channel.kind === "dm" && channel.dm_user?.id === meId;
}

export function channelTitle(channel: ChatChannelSummary, meId: string | null) {
  if (channel.kind === "dm") return isSelfDm(channel, meId) ? "You" : personName(channel.dm_user);
  if (channel.name) return channel.name;
  const names = (channel.members_preview ?? []).map((person) => personName(person).split(" ")[0]);
  return names.length ? names.join(", ") : "Group";
}

export function isUnread(channel: ChatChannelSummary) {
  return channel.last_top_seq > channel.last_read_seq;
}

/** DM and application rows show a count; channels show bold plus mentions (L-25). */
export function rowCount(channel: ChatChannelSummary) {
  if (channel.notify === "mute") return 0;
  if (isDirectLike(channel) || channel.application_id) return isUnread(channel) ? Math.max(1, channel.last_seq - channel.last_read_seq) : 0;
  return channel.mention_count;
}

function visible(channel: ChatChannelSummary) {
  return !channel.archived_at && !channel.channel_archived_at;
}

function byRecent(a: ChatChannelSummary, b: ChatChannelSummary) {
  return (b.last_message_at ?? "").localeCompare(a.last_message_at ?? "");
}

function byName(a: ChatChannelSummary, b: ChatChannelSummary) {
  return (a.name ?? "").localeCompare(b.name ?? "");
}

function attention(channel: ChatChannelSummary) {
  if (channel.notify === "mute") return 0;
  if (isDirectLike(channel) || channel.application_id) return isUnread(channel) || channel.mention_count > 0 ? 1 : 0;
  return channel.mention_count;
}

export type ChatSections = {
  starred: ChatChannelSummary[];
  channels: ChatChannelSummary[];
  applications: ChatChannelSummary[];
  dms: ChatChannelSummary[];
};

/** projectId null = Home: all DMs plus the applications you sent. */
export function sectionsFor(data: ChatBootstrap | undefined, projectId: string | null): ChatSections {
  const sections: ChatSections = { starred: [], channels: [], applications: [], dms: [] };
  if (!data) return sections;
  const memberOf = new Set((data.projects ?? []).map((project) => project.id));
  for (const channel of data.channels) {
    if (!visible(channel)) continue;
    const direct = isDirectLike(channel);
    const inScope = direct || (projectId === null
      ? Boolean(channel.application_id) && !memberOf.has(channel.project_id ?? "")
      : channel.project_id === projectId);
    if (!inScope) continue;
    if (channel.starred) sections.starred.push(channel);
    if (direct) sections.dms.push(channel);
    else if (channel.application_id) sections.applications.push(channel);
    else sections.channels.push(channel);
  }
  sections.starred.sort(byName);
  sections.channels.sort(byName);
  sections.applications.sort(byRecent);
  sections.dms.sort(byRecent);
  return sections;
}

/** Rail badges: Home = DMs and your applications; a project = its channels and applications. */
export function railBadges(data: ChatBootstrap | undefined) {
  const badges = new Map<string | null, number>();
  if (!data) return badges;
  const memberOf = new Set((data.projects ?? []).map((project) => project.id));
  for (const channel of data.channels) {
    if (!visible(channel)) continue;
    const owner = isDirectLike(channel) || !channel.project_id || !memberOf.has(channel.project_id) ? null : channel.project_id;
    const count = attention(channel);
    if (count) badges.set(owner, (badges.get(owner) ?? 0) + count);
  }
  return badges;
}

/** Projects ordered by most recent activity (L-30). */
export function projectsByActivity(data: ChatBootstrap | undefined) {
  if (!data?.projects) return [];
  const latest = new Map<string, string>();
  for (const channel of data.channels) {
    if (!channel.project_id || !channel.last_message_at) continue;
    if ((latest.get(channel.project_id) ?? "") < channel.last_message_at) latest.set(channel.project_id, channel.last_message_at);
  }
  return [...data.projects].sort((a, b) => (latest.get(b.id) ?? "").localeCompare(latest.get(a.id) ?? "") || a.title.localeCompare(b.title));
}

export function initials(title: string) {
  const words = title.trim().split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? "") + (words[1]?.[0] ?? "")).toUpperCase() || "?";
}

/**
 * Chat timestamps: "clock" = 9:42 AM, "ago" = 5m ago, "auto" = clock today,
 * otherwise a short date (Oct 2).
 */
export function formatChatTime(value: string, mode: "clock" | "ago" | "auto" = "auto") {
  const date = new Date(value);
  if (mode === "ago") {
    const minutes = Math.round((Date.now() - date.getTime()) / 60_000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m ago`;
    if (minutes < 1440) return `${Math.round(minutes / 60)}h ago`;
    return `${Math.round(minutes / 1440)}d ago`;
  }
  if (mode === "clock" || date.toDateString() === new Date().toDateString()) {
    return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

import type { ChatBootstrap, ChatChannelSummary, ChatNotify, ChatPerson } from "@/lib/messaging/types";

/**
 * Notification choices. Every message notifies only in DMs and group chats outside projects
 * (chat_send_message); project channels notify on mentions and followed threads, so "All" would do nothing there.
 */
export function notifiesEveryMessage(channel: Pick<ChatChannelSummary, "kind" | "project_id">) {
  return channel.kind === "dm" || (channel.kind === "private" && !channel.project_id);
}

export function notifyChoices(channel: Pick<ChatChannelSummary, "kind" | "project_id">): { value: ChatNotify; label: string }[] {
  return notifiesEveryMessage(channel)
    ? [{ value: "all", label: "All messages" }, { value: "mentions", label: "Mentions only" }, { value: "mute", label: "Mute" }]
    : [{ value: "mentions", label: "Mentions & threads" }, { value: "mute", label: "Mute" }];
}

/** The selected choice: in channels "all" behaves (and shows) as mentions & threads. */
export function notifyChoice(channel: Pick<ChatChannelSummary, "kind" | "project_id">, notify: ChatNotify): ChatNotify {
  return notifiesEveryMessage(channel) || notify === "mute" ? notify : "mentions";
}

export function notifyLabel(channel: Pick<ChatChannelSummary, "kind" | "project_id">, notify: ChatNotify) {
  const choice = notifyChoice(channel, notify);
  return choice === "mute" ? "Muted" : notifyChoices(channel).find((c) => c.value === choice)!.label;
}

// Pure grouping of the bootstrap into the sidebar (report 7.10). Opening a
// project re-runs this in memory; it never fetches.

// ponytail: projects by recent activity, 8 DMs in the sidebar (L-30).
// ceiling: long project lists. upgrade: pin/reorder and project search past ~12 projects.
export const DM_SIDEBAR_LIMIT = 8;

export function personName(person: ChatPerson | null | undefined) {
  return person?.full_name || person?.username || "Someone";
}

export function isDirectLike(channel: ChatChannelSummary) {
  return !channel.application_id && (channel.kind === "dm" || (channel.kind === "private" && channel.name === null));
}

/** Same rule as app_private.chat_add_members: any member of a live, non-DM conversation. */
export function canAddPeople(channel: { kind: string; is_member: boolean; channel_archived_at: string | null }) {
  return channel.is_member && channel.kind !== "dm" && !channel.channel_archived_at;
}

export function isSelfDm(channel: ChatChannelSummary, meId: string | null) {
  return channel.kind === "dm" && channel.dm_user?.id === meId;
}

export function channelTitle(channel: ChatChannelSummary, meId: string | null) {
  if (channel.kind === "dm") return isSelfDm(channel, meId) ? "You" : personName(channel.dm_user);
  if (channel.name) return channel.name;
  if (channel.title) return channel.title;
  const names = (channel.members_preview ?? []).map((person) => personName(person).split(" ")[0]);
  return names.length ? names.join(", ") : "Group";
}

export function isUnread(channel: ChatChannelSummary) {
  return channel.last_top_seq > channel.last_read_seq;
}

/** DM and application rows show a count; channels show bold plus mentions (L-25). */
export function rowCount(channel: ChatChannelSummary) {
  // Muted: only mentions still count (like Slack).
  if (channel.notify === "mute") return channel.mention_count;
  // Top-level messages only, like bold (isUnread): thread replies don't inflate the count.
  if (isDirectLike(channel) || channel.application_id) return isUnread(channel) ? Math.max(1, channel.last_top_seq - channel.last_read_seq) : 0;
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
  if (channel.notify === "mute") return channel.mention_count;
  if (isDirectLike(channel) || channel.application_id) return isUnread(channel) || channel.mention_count > 0 ? 1 : 0;
  return channel.mention_count;
}

export type ChatSections = {
  starred: ChatChannelSummary[];
  /** Channels and application threads of the selected project. */
  channels: ChatChannelSummary[];
  applications: ChatChannelSummary[];
  /** Applications you sent to projects you are not in. */
  myApplications: ChatChannelSummary[];
  dms: ChatChannelSummary[];
};

/** DMs, your applications and starred rows always; channels only for the open project. */
export function sectionsFor(data: ChatBootstrap | undefined, projectId: string | null): ChatSections {
  const sections: ChatSections = { starred: [], channels: [], applications: [], myApplications: [], dms: [] };
  if (!data) return sections;
  const memberOf = new Set((data.projects ?? []).map((project) => project.id));
  for (const channel of data.channels) {
    if (!visible(channel)) continue;
    // Starred follows the open project (DMs and groups always); a starred row isn't repeated below.
    if (channel.starred && (!projectId || isDirectLike(channel) || channel.project_id === projectId)) {
      sections.starred.push(channel);
      continue;
    }
    if (isDirectLike(channel)) sections.dms.push(channel);
    else if (channel.application_id && !memberOf.has(channel.project_id ?? "")) sections.myApplications.push(channel);
    else if (channel.project_id !== projectId) continue;
    else if (channel.application_id) sections.applications.push(channel);
    else sections.channels.push(channel);
  }
  sections.starred.sort(byRecent);
  sections.channels.sort((a, b) => Number(b.is_default) - Number(a.is_default) || byName(a, b));
  sections.applications.sort(byRecent);
  sections.myApplications.sort(byRecent);
  sections.dms.sort(byRecent);
  return sections;
}

/**
 * Every visible conversation in the sidebar's order (Starred, Channels or the project groups,
 * DMs, My applications). A starred row counts once, where it first appears.
 */
export function sidebarOrder(data: ChatBootstrap | undefined, projectId: string | null) {
  const sections = sectionsFor(data, projectId);
  const projectRows = projectId
    ? [...sections.channels, ...sections.applications]
    : projectsByActivity(data).flatMap((project) => channelsByProject(data).get(project.id) ?? []);
  const seen = new Set<string>();
  return [...sections.starred, ...projectRows, ...sections.dms, ...sections.myApplications].filter((channel) => !seen.has(channel.id) && Boolean(seen.add(channel.id)));
}

/** Unread, or carrying a mention (the Unreads filter). Muted rows never count. */
export function needsAttention(channel: ChatChannelSummary) {
  return channel.mention_count > 0 || (channel.notify !== "mute" && isUnread(channel));
}

/** Every visible project channel grouped by project (the "All projects" sidebar). */
export function channelsByProject(data: ChatBootstrap | undefined) {
  const groups = new Map<string, ChatChannelSummary[]>();
  if (!data) return groups;
  const memberOf = new Set((data.projects ?? []).map((project) => project.id));
  for (const channel of data.channels) {
    if (!visible(channel) || isDirectLike(channel) || !channel.project_id || !memberOf.has(channel.project_id)) continue;
    const list = groups.get(channel.project_id) ?? [];
    list.push(channel);
    groups.set(channel.project_id, list);
  }
  for (const list of groups.values()) list.sort((a, b) => Number(Boolean(a.application_id)) - Number(Boolean(b.application_id)) || Number(b.is_default) - Number(a.is_default) || byName(a, b));
  return groups;
}

/** Unread attention per project (its channels and application threads). */
export function projectBadges(data: ChatBootstrap | undefined) {
  const badges = new Map<string, number>();
  if (!data) return badges;
  const memberOf = new Set((data.projects ?? []).map((project) => project.id));
  for (const channel of data.channels) {
    if (!visible(channel) || isDirectLike(channel) || !channel.project_id || !memberOf.has(channel.project_id)) continue;
    const count = attention(channel);
    if (count) badges.set(channel.project_id, (badges.get(channel.project_id) ?? 0) + count);
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
/**
 * Chat times. "auto": 3:42 PM today, else Oct 3. "at" (reminders, scheduled sends, past or future):
 * "Today 3:42 PM", "Tomorrow 9:00 AM", else "Mon, Oct 6, 9:00 AM".
 */
export function formatChatTime(value: string | Date, mode: "clock" | "ago" | "auto" | "at" = "auto") {
  const date = new Date(value);
  if (mode === "at") {
    const clock = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    const day = new Date(date);
    day.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const days = Math.round((day.getTime() - today.getTime()) / 86_400_000);
    if (days === 0) return `Today ${clock}`;
    if (days === 1) return `Tomorrow ${clock}`;
    if (days === -1) return `Yesterday ${clock}`;
    return date.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }
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

/** The swipe buttons for a list row: Read only when there's something unread; DMs Close, channels Star. */
export function swipeButtons(options: { unread: boolean; muted: boolean; direct: boolean; starred: boolean }) {
  return [
    ...(options.unread ? ["Read"] : []),
    options.muted ? "Unmute" : "Mute",
    options.direct ? "Close" : options.starred ? "Unstar" : "Star",
  ];
}

/** One "mark all as read" everywhere: same label, and it asks first above 5 items. */
export const MARK_ALL_LABEL = "Mark all as read";
export const needsMarkAllConfirm = (count: number) => count > 5;

/** One file-size format for attachments and the Files tab: "820 B", "14.2 KB", "3.1 MB". */
export function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

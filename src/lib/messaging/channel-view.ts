import { MESSAGE_LEVEL_LABELS } from "@/lib/copy/terms";
import type { ChatBootstrap, ChatChannelSummary, ChatNotify, ChatPerson } from "@/lib/messaging/types";
import { formatAbsoluteTimestamp, formatRelativeTimestamp } from "@/lib/notifications/presentation";

type NotifyChannel = Pick<ChatChannelSummary, "kind" | "project_id"> & { application_id?: string | null };

/**
 * Notification choices. Every message notifies only in DMs and group chats outside projects
 * (chat_send_message); project channels notify on mentions and followed threads, so "All" would do nothing there.
 */
export function notifiesEveryMessage(channel: NotifyChannel) {
  // An application thread is a small private room: every message notifies, like a group chat.
  return channel.kind === "dm" || (channel.kind === "private" && !channel.project_id) || Boolean(channel.application_id);
}

export function notifyChoices(channel: NotifyChannel): { value: ChatNotify; label: string }[] {
  // A 1:1 DM: nobody @mentions you in your own DM, so "Mentions" would mean "never".
  if (channel.kind === "dm") return [{ value: "all", label: MESSAGE_LEVEL_LABELS.all }, { value: "mute", label: MESSAGE_LEVEL_LABELS.mute }];
  return notifiesEveryMessage(channel)
    ? [{ value: "all", label: MESSAGE_LEVEL_LABELS.all }, { value: "mentions", label: MESSAGE_LEVEL_LABELS.mentions }, { value: "mute", label: MESSAGE_LEVEL_LABELS.mute }]
    : [{ value: "mentions", label: MESSAGE_LEVEL_LABELS.mentions_threads }, { value: "mute", label: MESSAGE_LEVEL_LABELS.mute }];
}

/** The selected choice: in channels "all" behaves (and shows) as mentions & threads; a DM is all or muted. */
export function notifyChoice(channel: NotifyChannel, notify: ChatNotify): ChatNotify {
  if (channel.kind === "dm") return notify === "mute" ? "mute" : "all";
  return notifiesEveryMessage(channel) || notify === "mute" ? notify : "mentions";
}

/** One line under the setting: what it actually does. */
export function notifyHelp(channel: NotifyChannel, notify: ChatNotify) {
  const choice = notifyChoice(channel, notify);
  if (choice === "mute") return "No notifications. @mentions still show in your Inbox.";
  if (choice === "all") return "Every new message notifies you.";
  return notifiesEveryMessage(channel) ? "Only when someone @mentions you." : "@mentions, @here and replies in threads you follow.";
}

export function notifyLabel(channel: NotifyChannel, notify: ChatNotify) {
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

/** Same rule as app_private.chat_add_members: any member of a live, non-DM conversation; an application thread has a fixed cast. */
export function canAddPeople(channel: { kind: string; is_member: boolean; channel_archived_at: string | null; application_id?: string | null }) {
  return channel.is_member && channel.kind !== "dm" && !channel.channel_archived_at && !channel.application_id;
}

export function isSelfDm(channel: ChatChannelSummary, meId: string | null) {
  return channel.kind === "dm" && channel.dm_user?.id === meId;
}

export function channelTitle(channel: ChatChannelSummary, meId: string | null) {
  if (channel.kind === "dm") return isSelfDm(channel, meId) ? "You" : personName(channel.dm_user);
  // An application thread is named for the other side: the applicant to reviewers, the role to the applicant.
  if (channel.application) {
    const role = channel.application.role_removed ? "Removed role" : channel.application.role_title ?? "Application";
    return channel.application.is_applicant ? `${role} · ${channel.application.project_title}` : `${personName(channel.application.applicant)} · ${role}`;
  }
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

/** One rule for every list of conversations to open: not closed by you, not archived. */
export function isVisible(channel: ChatChannelSummary) {
  return !channel.archived_at && !channel.channel_archived_at;
}

function byRecent(a: ChatChannelSummary, b: ChatChannelSummary) {
  return (b.last_message_at ?? "").localeCompare(a.last_message_at ?? "");
}

function byName(a: ChatChannelSummary, b: ChatChannelSummary) {
  return (a.name ?? "").localeCompare(b.name ?? "");
}

/** What a row adds to a section or project count: mentions for channels, 1 for an unread DM or application. */
export function attention(channel: ChatChannelSummary) {
  if (channel.notify === "mute") return channel.mention_count;
  if (isDirectLike(channel) || channel.application_id) return isUnread(channel) || channel.mention_count > 0 ? 1 : 0;
  return channel.mention_count;
}

export type ChatSections = {
  starred: ChatChannelSummary[];
  /** Channels of the selected project. */
  channels: ChatChannelSummary[];
  /** Every application thread you are in, sent or received, whatever project is open. */
  applications: ChatChannelSummary[];
  dms: ChatChannelSummary[];
};

/** An application thread: private room of an applicant and a project's reviewers. */
export function isApplicationThread(channel: Pick<ChatChannelSummary, "application_id">) {
  return Boolean(channel.application_id);
}

/**
 * The other side of an application thread, for its avatar and header: the applicant for a reviewer,
 * the project's lead (its owner) for the applicant.
 */
export function counterpart(channel: Pick<ChatChannelSummary, "application">): ChatPerson | null {
  const meta = channel.application;
  if (!meta) return null;
  return meta.is_applicant ? meta.lead : meta.applicant;
}

/** DMs and application threads always; starred rows always; channels only for the open project. */
export function sectionsFor(data: ChatBootstrap | undefined, projectId: string | null): ChatSections {
  const sections: ChatSections = { starred: [], channels: [], applications: [], dms: [] };
  if (!data) return sections;
  for (const channel of data.channels) {
    if (!isVisible(channel)) continue;
    // Starred follows the open project (DMs, groups and applications always); a starred row isn't repeated below.
    if (channel.starred && (!projectId || isDirectLike(channel) || isApplicationThread(channel) || channel.project_id === projectId)) {
      sections.starred.push(channel);
      continue;
    }
    if (isDirectLike(channel)) sections.dms.push(channel);
    else if (isApplicationThread(channel)) sections.applications.push(channel);
    else if (channel.project_id !== projectId) continue;
    else sections.channels.push(channel);
  }
  sections.starred.sort(byRecent);
  sections.channels.sort((a, b) => Number(b.is_default) - Number(a.is_default) || byName(a, b));
  sections.applications.sort(byRecent);
  sections.dms.sort(byRecent);
  return sections;
}

/**
 * Every visible conversation in the sidebar's order (Applications, Starred, Channels or the project groups,
 * DMs). A starred row counts once, where it first appears.
 */
export function sidebarOrder(data: ChatBootstrap | undefined, projectId: string | null) {
  const sections = sectionsFor(data, projectId);
  const projectRows = projectId
    ? sections.channels
    : projectsByActivity(data).flatMap((project) => channelsByWorkspace(data).get(project.id) ?? []);
  const seen = new Set<string>();
  return [...sections.applications, ...sections.starred, ...projectRows, ...sections.dms].filter((channel) => !seen.has(channel.id) && Boolean(seen.add(channel.id)));
}

/** Unread, or carrying a mention (the Unreads filter). Muted rows never count. */
export function needsAttention(channel: ChatChannelSummary) {
  return channel.mention_count > 0 || (channel.notify !== "mute" && isUnread(channel));
}

/** Every visible project channel grouped by project (the "All workspaces" sidebar). */
export function channelsByWorkspace(data: ChatBootstrap | undefined) {
  const groups = new Map<string, ChatChannelSummary[]>();
  if (!data) return groups;
  const memberOf = new Set((data.projects ?? []).map((project) => project.id));
  for (const channel of data.channels) {
    if (!isVisible(channel) || isDirectLike(channel) || isApplicationThread(channel) || !channel.project_id || !memberOf.has(channel.project_id)) continue;
    const list = groups.get(channel.project_id) ?? [];
    list.push(channel);
    groups.set(channel.project_id, list);
  }
  for (const list of groups.values()) list.sort((a, b) => Number(b.is_default) - Number(a.is_default) || byName(a, b));
  return groups;
}

/** Unread attention per project (its channels; application threads count in their own section). */
export function projectBadges(data: ChatBootstrap | undefined) {
  const badges = new Map<string, number>();
  if (!data) return badges;
  const memberOf = new Set((data.projects ?? []).map((project) => project.id));
  for (const channel of data.channels) {
    if (!isVisible(channel) || isDirectLike(channel) || isApplicationThread(channel) || !channel.project_id || !memberOf.has(channel.project_id)) continue;
    const count = attention(channel);
    if (count) badges.set(channel.project_id, (badges.get(channel.project_id) ?? 0) + count);
  }
  return badges;
}

/**
 * Badges for the workspace list (report §25.7): an org's count includes its child projects' channels, since
 * a child project lives inside the org's workspace rather than on its own tile.
 */
export function workspaceBadges(data: ChatBootstrap | undefined) {
  const badges = projectBadges(data);
  const parents = new Map((data?.projects ?? []).filter((p) => p.parent_id).map((p) => [p.id, p.parent_id!]));
  const listed = new Set((data?.projects ?? []).map((p) => p.id));
  const rolled = new Map(badges);
  for (const [projectId, count] of badges) {
    const parent = parents.get(projectId);
    if (parent && listed.has(parent)) rolled.set(parent, (rolled.get(parent) ?? 0) + count);
  }
  return rolled;
}

/** A workspace's people: everyone is in its #general (the default channel); null when that isn't loaded. */
export function workspacePeople(data: ChatBootstrap | undefined, projectId: string): number | null {
  return data?.channels.find((c) => c.project_id === projectId && c.is_default)?.member_count ?? null;
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
/** A list time's tooltip: the full date and time ("Oct 3, 2025, 4:12 PM"). */
export const fullTime = (value: string) => formatAbsoluteTimestamp(value) ?? undefined;

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
  // The same "5m ago" as Notifications (one rounding everywhere).
  if (mode === "ago") return formatRelativeTimestamp(date.toISOString()) ?? "";
  if (mode === "clock" || date.toDateString() === new Date().toDateString()) {
    return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  // Another year says which ("Oct 3, 2025"), so an old search hit isn't read as this October.
  const otherYear = date.getFullYear() !== new Date().getFullYear();
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(otherYear ? { year: "numeric" } : {}) });
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

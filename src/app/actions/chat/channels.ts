"use server";

import { normalizeSafeExternalUrl } from "@/lib/messaging/safe-links";
import { sql } from "drizzle-orm";

import { applicationMetaSql } from "@/lib/messaging/application-meta";
import { CHAT_CHANNEL_NAME_PATTERN, CHAT_MAX_DESCRIPTION } from "@/lib/messaging/constants";
import { publishChannel, publishUser } from "@/lib/messaging/publish";
import { chatFailure, chatRows, chatValue, invalidInput, isUuid, jsonParam, requireChatUser, unauthorized, uuidArray } from "@/lib/messaging/server";
import type { ChatChannelSummary, ChatPerson } from "@/lib/messaging/types";

// ponytail: channels always belong to a project; no global public channels (L-5).
// upgrade: community channels once there is a moderation owner.
export async function createChannel(input: { projectId: string; name: string; description?: string | null; isPrivate?: boolean }) {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  const name = typeof input?.name === "string" ? input.name.trim().toLowerCase() : "";
  if (!isUuid(input?.projectId) || !CHAT_CHANNEL_NAME_PATTERN.test(name)) return invalidInput;
  if (input.description && input.description.length > CHAT_MAX_DESCRIPTION) return invalidInput;
  try {
    const channelId = await chatValue<string>(sql`
      SELECT app_private.chat_create_channel(${input.projectId}::uuid, ${user.id}::uuid, ${name}, ${input.description ?? null}, ${Boolean(input.isPrivate)}) AS value
    `);
    publishUser(user.id, "membership.changed", { channel_id: channelId });
    return { success: true as const, channelId };
  } catch (error) {
    return chatFailure(error, "create_channel");
  }
}

export async function updateChannel(input: { channelId: string; name?: string | null; topic?: string | null; description?: string | null }) {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  if (!isUuid(input?.channelId)) return invalidInput;
  const name = input.name ? input.name.trim().toLowerCase() : null;
  if (name !== null && !CHAT_CHANNEL_NAME_PATTERN.test(name)) return invalidInput;
  try {
    await chatRows(sql`
      SELECT app_private.chat_update_channel(${input.channelId}::uuid, ${user.id}::uuid, ${name}, ${input.topic ?? null}, ${input.description ?? null})
    `);
    publishChannel(input.channelId, "channel.updated", { channel_id: input.channelId });
    return { success: true as const };
  } catch (error) {
    return chatFailure(error, "update_channel");
  }
}

/** Admins switch a named project channel between public and private (never #general). */
export async function setChannelPrivacy(input: { channelId: string; private: boolean }) {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  if (!isUuid(input?.channelId) || typeof input.private !== "boolean") return invalidInput;
  try {
    await chatRows(sql`SELECT app_private.chat_set_channel_privacy(${input.channelId}::uuid, ${user.id}::uuid, ${input.private})`);
    publishChannel(input.channelId, "channel.updated", { channel_id: input.channelId });
    return { success: true as const };
  } catch (error) {
    return chatFailure(error, "channel_privacy");
  }
}

export async function archiveChannel(input: { channelId: string }) {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  if (!isUuid(input?.channelId)) return invalidInput;
  try {
    await chatRows(sql`SELECT app_private.chat_archive_channel(${input.channelId}::uuid, ${user.id}::uuid)`);
    publishChannel(input.channelId, "channel.updated", { channel_id: input.channelId });
    return { success: true as const };
  } catch (error) {
    return chatFailure(error, "archive_channel");
  }
}

export async function unarchiveChannel(input: { channelId: string }) {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  if (!isUuid(input?.channelId)) return invalidInput;
  try {
    await chatRows(sql`SELECT app_private.chat_unarchive_channel(${input.channelId}::uuid, ${user.id}::uuid)`);
    publishChannel(input.channelId, "channel.updated", { channel_id: input.channelId });
    return { success: true as const };
  } catch (error) {
    return chatFailure(error, "unarchive_channel");
  }
}

/** Name (or unname) a group chat. Any member may. */
export async function renameGroup(input: { channelId: string; title: string | null }) {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  if (!isUuid(input?.channelId) || (input.title !== null && (typeof input.title !== "string" || input.title.length > 80))) return invalidInput;
  try {
    await chatRows(sql`SELECT app_private.chat_rename_group(${input.channelId}::uuid, ${user.id}::uuid, ${input.title})`);
    publishChannel(input.channelId, "channel.updated", { channel_id: input.channelId });
    publishChannel(input.channelId, "member.changed", { channel_id: input.channelId });
    return { success: true as const };
  } catch (error) {
    return chatFailure(error, "rename_group");
  }
}

export async function joinChannel(input: { channelId: string }) {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  if (!isUuid(input?.channelId)) return invalidInput;
  try {
    await chatRows(sql`SELECT app_private.chat_join_channel(${input.channelId}::uuid, ${user.id}::uuid)`);
    publishChannel(input.channelId, "member.changed", { channel_id: input.channelId });
    publishUser(user.id, "membership.changed", { channel_id: input.channelId });
    return { success: true as const };
  } catch (error) {
    return chatFailure(error, "join_channel");
  }
}

export async function leaveChannel(input: { channelId: string }) {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  if (!isUuid(input?.channelId)) return invalidInput;
  try {
    await chatRows(sql`SELECT app_private.chat_leave_channel(${input.channelId}::uuid, ${user.id}::uuid)`);
    publishChannel(input.channelId, "member.changed", { channel_id: input.channelId });
    publishUser(user.id, "membership.changed", { channel_id: input.channelId });
    return { success: true as const };
  } catch (error) {
    return chatFailure(error, "leave_channel");
  }
}

export type BrowseChannel = {
  id: string;
  name: string;
  description: string | null;
  topic: string | null;
  member_count: number;
  is_default: boolean;
  joined: boolean;
  /** Archived channels are listed too (Browse › Archived), so admins can find one to unarchive. */
  archived: boolean;
};

/** Public channels of a project, for its members (private channels are never listed). */
export async function browseChannels(input: { projectId: string }) {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  if (!isUuid(input?.projectId)) return invalidInput;
  try {
    const channels = await chatRows<BrowseChannel>(sql`
      SELECT c.id, c.name, c.description, c.topic, c.member_count, c.is_default,
             app_private.chat_is_member(c.id, ${user.id}::uuid) AS joined,
             c.archived_at IS NOT NULL AS archived
      FROM chat_channels c
      WHERE c.workspace_id = ${input.projectId}::uuid AND c.kind = 'public'
        AND app_private.chat_is_workspace_member(${input.projectId}::uuid, ${user.id}::uuid)
      ORDER BY c.archived_at IS NOT NULL, c.is_default DESC, c.name
      LIMIT 200
    `);
    return { success: true as const, channels };
  } catch (error) {
    return chatFailure(error, "browse_channels");
  }
}

export type ChannelMatch = { id: string; name: string; project_id: string; project_title: string };

/** ⌘K: public channels you haven't joined, by name, across every project you're in. */
// ponytail: unindexed ILIKE over public channels in your projects. ceiling: ~100k channels.
// upgrade: a pg_trgm index on chat_channels.name.
export async function searchChannels(input: { query: string }) {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  const query = typeof input?.query === "string" ? input.query.trim().toLowerCase().slice(0, 80) : "";
  if (!query) return invalidInput;
  const pattern = `%${query.replace(/[%_\\]/g, "\\$&")}%`;
  try {
    const channels = await chatRows<ChannelMatch>(sql`
      SELECT c.id, c.name, c.workspace_id AS project_id, p.title AS project_title
      FROM chat_channels c
      JOIN workspaces p ON p.id = c.workspace_id
      WHERE c.kind = 'public' AND c.archived_at IS NULL AND c.name ILIKE ${pattern} ESCAPE '\\'
        AND app_private.chat_is_workspace_member(c.workspace_id, ${user.id}::uuid)
        AND NOT app_private.chat_is_member(c.id, ${user.id}::uuid)
      ORDER BY c.name
      LIMIT 5
    `);
    return { success: true as const, channels };
  } catch (error) {
    return chatFailure(error, "search_channels");
  }
}

export type ChannelDetails = ChatChannelSummary & {
  description: string | null;
  created_by: string | null;
  /** The creator's name, even if they left (Details › Created). */
  created_by_name: string | null;
  created_at: string;
  project_title: string | null;
  project_slug: string | null;
  is_member: boolean;
  can_admin: boolean;
};

/** Header and details for a channel the viewer belongs to, or a project's public channel they can join. */
export async function getChannel(input: { channelId: string }) {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  if (!isUuid(input?.channelId)) return invalidInput;
  try {
    const [channel] = await chatRows<ChannelDetails>(sql`
      SELECT c.id, c.kind, c.name, c.title, c.topic, c.description, c.workspace_id AS project_id, c.application_id, c.is_default,
             c.last_seq, c.last_top_seq, c.last_message_at, c.last_preview, c.last_author_id, c.member_count,
             c.archived_at AS channel_archived_at, c.created_by, c.created_at,
             (SELECT coalesce(cp.full_name, cp.username) FROM profiles cp WHERE cp.id = c.created_by) AS created_by_name,
             p.title AS project_title, p.slug AS project_slug,
             coalesce(m.last_read_seq, 0) AS last_read_seq, coalesce(m.mention_count, 0) AS mention_count,
             coalesce(m.notify, 'all') AS notify, coalesce(m.starred, false) AS starred, m.archived_at,
             coalesce(m.role, 'member') AS role,
             m.user_id IS NOT NULL AS is_member,
             app_private.chat_is_channel_admin(c.id, ${user.id}::uuid) AS can_admin,
             app_private.chat_contact_cut(c.id, ${user.id}::uuid) AS reply_closed,
             (app_private.chat_contact_cut(c.id, ${user.id}::uuid) AND EXISTS (
               SELECT 1 FROM chat_channel_members o JOIN user_blocks b ON b.blocker_id = ${user.id}::uuid AND b.blocked_id = o.user_id
               WHERE o.channel_id = c.id)) AS blocked_by_me,
             CASE WHEN c.application_id IS NULL THEN NULL ELSE ${applicationMetaSql(sql`c.application_id`, user.id)} END AS application,
             CASE WHEN c.kind = 'dm' THEN (
               SELECT jsonb_build_object('id', pr.id, 'username', pr.username, 'full_name', pr.full_name, 'avatar_url', pr.avatar_url)
               FROM chat_channel_members o JOIN profiles pr ON pr.id = o.user_id
               WHERE o.channel_id = c.id ORDER BY (o.user_id = ${user.id}::uuid) LIMIT 1
             ) END AS dm_user,
             CASE WHEN c.kind = 'private' AND c.name IS NULL THEN (
               SELECT jsonb_agg(jsonb_build_object('id', gp.id, 'username', gp.username, 'full_name', gp.full_name, 'avatar_url', gp.avatar_url) ORDER BY preview.joined_at, gp.id)
               FROM (SELECT other.user_id, other.joined_at FROM chat_channel_members other
                     WHERE other.channel_id = c.id AND other.user_id <> ${user.id}::uuid
                     ORDER BY other.joined_at LIMIT 3) preview
               JOIN profiles gp ON gp.id = preview.user_id
             ) ELSE NULL::jsonb END AS members_preview
      FROM chat_channels c
      LEFT JOIN workspaces p ON p.id = c.workspace_id
      LEFT JOIN chat_channel_members m ON m.channel_id = c.id AND m.user_id = ${user.id}::uuid
      WHERE c.id = ${input.channelId}::uuid
        AND (m.user_id IS NOT NULL OR (c.kind = 'public' AND app_private.chat_is_workspace_member(c.workspace_id, ${user.id}::uuid)))
    `);
    if (!channel) return { success: false as const, error: "chat_channel_not_found" };
    return { success: true as const, channel };
  } catch (error) {
    return chatFailure(error, "get_channel");
  }
}

export type ChannelMember = ChatPerson & { role: string; joined_at: string };

export async function listMembers(input: { channelId: string }) {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  if (!isUuid(input?.channelId)) return invalidInput;
  try {
    const members = await chatRows<ChannelMember>(sql`
      SELECT pr.id, pr.username, pr.full_name, pr.avatar_url, m.role, m.joined_at,
             pm.role AS project_membership_role,
             (
               SELECT coalesce(nullif(ra.accepted_role_title, ''), nullif(por.title, ''), nullif(por.role, ''))
               FROM role_applications ra
               LEFT JOIN workspace_open_roles por ON por.id = ra.role_id
               WHERE ra.workspace_id = c.workspace_id
                 AND ra.applicant_id = pr.id
                 AND ra.status = 'accepted'
               ORDER BY ra.updated_at DESC
               LIMIT 1
             ) AS project_role_title,
             (c.workspace_id IS NOT NULL AND p.owner_id = pr.id) AS is_project_owner,
             p.import_source->'metadata'->>'leadFocus' AS lead_focus,
             EXISTS (SELECT 1 FROM user_blocks b WHERE b.blocker_id = ${user.id}::uuid AND b.blocked_id = pr.id) AS blocked_by_me
      FROM chat_channel_members m
      JOIN profiles pr ON pr.id = m.user_id
      JOIN chat_channels c ON c.id = m.channel_id
      LEFT JOIN workspaces p ON p.id = c.workspace_id
      LEFT JOIN workspace_members pm ON pm.workspace_id = c.workspace_id AND pm.user_id = pr.id
      WHERE m.channel_id = ${input.channelId}::uuid
        AND app_private.chat_is_member(${input.channelId}::uuid, ${user.id}::uuid)
      ORDER BY (m.role = 'member'), coalesce(pr.full_name, pr.username)
      LIMIT 500
    `);
    return { success: true as const, members };
  } catch (error) {
    return chatFailure(error, "list_members");
  }
}

export type ChannelTab = { id: string; kind: "tasks" | "link" | "files"; title: string; url: string | null; position: number };

/** Tabs everyone in the channel sees: bookmarks (links), Files and the project's Tasks. */
export async function listChannelTabs(input: { channelId: string }) {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  if (!isUuid(input?.channelId)) return invalidInput;
  try {
    const tabs = await chatRows<ChannelTab>(sql`
      SELECT id, kind, title, url, position FROM chat_channel_tabs
      WHERE channel_id = ${input.channelId}::uuid AND app_private.chat_is_member(${input.channelId}::uuid, ${user.id}::uuid)
      ORDER BY position, created_at
    `);
    return { success: true as const, tabs };
  } catch (error) {
    return chatFailure(error, "tabs");
  }
}

export async function addChannelTab(input: { channelId: string; kind: ChannelTab["kind"]; title: string; url?: string | null }) {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  const title = typeof input?.title === "string" ? input.title.trim().slice(0, 60) : "";
  const url = input?.kind === "link" && typeof input.url === "string" ? normalizeSafeExternalUrl(input.url) : null;
  if (!isUuid(input?.channelId) || !["tasks", "link", "files"].includes(input.kind) || !title) return invalidInput;
  if (input.kind === "link" && (!url || !/^https?:\/\//i.test(url) || url.length > 2000)) return invalidInput;
  try {
    // A 21st tab and a tab that is already here each get their own words (they shared "channel name taken").
    // Membership first, so someone outside the channel never learns its tab count.
    const [existing] = await chatRows<{ member: boolean; n: number }>(sql`
      SELECT app_private.chat_is_member(${input.channelId}::uuid, ${user.id}::uuid) AS member,
             (SELECT count(*)::int FROM chat_channel_tabs WHERE channel_id = ${input.channelId}::uuid) AS n
    `);
    if (!existing?.member) return { success: false as const, error: "chat_not_member" };
    if (existing.n >= 20) return { success: false as const, error: "chat_tab_limit" };
    const [tab] = await chatRows<ChannelTab>(sql`
      INSERT INTO chat_channel_tabs (channel_id, kind, title, url, position, created_by)
      SELECT ${input.channelId}::uuid, ${input.kind}, ${title}, ${url},
             coalesce((SELECT max(position) + 1 FROM chat_channel_tabs WHERE channel_id = ${input.channelId}::uuid), 0), ${user.id}::uuid
      WHERE app_private.chat_is_member(${input.channelId}::uuid, ${user.id}::uuid)
        AND (SELECT count(*) FROM chat_channel_tabs WHERE channel_id = ${input.channelId}::uuid) < 20
      ON CONFLICT DO NOTHING
      RETURNING id, kind, title, url, position
    `);
    if (!tab) return { success: false as const, error: "chat_tab_duplicate" };
    publishChannel(input.channelId, "tabs.changed", { channel_id: input.channelId });
    return { success: true as const, tab };
  } catch (error) {
    return chatFailure(error, "add_tab");
  }
}

export async function removeChannelTab(input: { channelId: string; tabId: string }) {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  if (!isUuid(input?.channelId) || !isUuid(input.tabId)) return invalidInput;
  try {
    await chatRows(sql`
      DELETE FROM chat_channel_tabs
      WHERE id = ${input.tabId}::uuid AND channel_id = ${input.channelId}::uuid
        AND app_private.chat_is_member(${input.channelId}::uuid, ${user.id}::uuid)
    `);
    publishChannel(input.channelId, "tabs.changed", { channel_id: input.channelId });
    return { success: true as const };
  } catch (error) {
    return chatFailure(error, "remove_tab");
  }
}

/** Rename and reorder in one save (Edit tabs). Missing ids are removed. */
export async function saveChannelTabs(input: { channelId: string; tabs: { id: string; title: string }[] }) {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  const tabs = Array.isArray(input?.tabs) ? input.tabs.filter((tab) => isUuid(tab?.id) && typeof tab.title === "string" && tab.title.trim()).slice(0, 20) : [];
  if (!isUuid(input?.channelId)) return invalidInput;
  try {
    const member = await chatValue<boolean>(sql`SELECT app_private.chat_is_member(${input.channelId}::uuid, ${user.id}::uuid) AS value`);
    if (!member) return { success: false as const, error: "chat_not_member" };
    await chatRows(sql`
      DELETE FROM chat_channel_tabs WHERE channel_id = ${input.channelId}::uuid
        AND NOT (id = ANY(${uuidArray(tabs.map((tab) => tab.id))}))
    `);
    // One statement for every rename and reorder (ACT-01).
    await chatRows(sql`
      UPDATE chat_channel_tabs t SET title = x.title, position = x.position
      FROM jsonb_to_recordset(${jsonParam(tabs.map((tab, position) => ({ id: tab.id, title: tab.title.trim().slice(0, 60), position })))}) AS x(id uuid, title text, position int)
      WHERE t.id = x.id AND t.channel_id = ${input.channelId}::uuid
    `);
    publishChannel(input.channelId, "tabs.changed", { channel_id: input.channelId });
    return { success: true as const };
  } catch (error) {
    return chatFailure(error, "save_tabs");
  }
}

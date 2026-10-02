"use server";

import { sql } from "drizzle-orm";

import { CHAT_CHANNEL_NAME_PATTERN, CHAT_MAX_DESCRIPTION } from "@/lib/messaging/constants";
import { publishChannel, publishUser } from "@/lib/messaging/publish";
import { chatFailure, chatRows, chatValue, invalidInput, isUuid, requireChatUser, unauthorized } from "@/lib/messaging/server";
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
};

/** Public channels of a project, for its members (private channels are never listed). */
export async function browseChannels(input: { projectId: string }) {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  if (!isUuid(input?.projectId)) return invalidInput;
  try {
    const channels = await chatRows<BrowseChannel>(sql`
      SELECT c.id, c.name, c.description, c.topic, c.member_count, c.is_default,
             app_private.chat_is_member(c.id, ${user.id}::uuid) AS joined
      FROM chat_channels c
      WHERE c.project_id = ${input.projectId}::uuid AND c.kind = 'public' AND c.archived_at IS NULL
        AND app_private.chat_is_project_member(${input.projectId}::uuid, ${user.id}::uuid)
      ORDER BY c.is_default DESC, c.name
      LIMIT 200
    `);
    return { success: true as const, channels };
  } catch (error) {
    return chatFailure(error, "browse_channels");
  }
}

export type ChannelDetails = ChatChannelSummary & {
  description: string | null;
  created_by: string | null;
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
      SELECT c.id, c.kind, c.name, c.topic, c.description, c.project_id, c.application_id, c.is_default,
             c.last_seq, c.last_top_seq, c.last_message_at, c.last_preview, c.last_author_id, c.member_count,
             c.archived_at AS channel_archived_at, c.created_by, c.created_at,
             p.title AS project_title, p.slug AS project_slug,
             coalesce(m.last_read_seq, 0) AS last_read_seq, coalesce(m.mention_count, 0) AS mention_count,
             coalesce(m.notify, 'all') AS notify, coalesce(m.starred, false) AS starred, m.archived_at,
             coalesce(m.role, 'member') AS role,
             m.user_id IS NOT NULL AS is_member,
             app_private.chat_is_channel_admin(c.id, ${user.id}::uuid) AS can_admin,
             CASE WHEN c.kind = 'dm' THEN (
               SELECT jsonb_build_object('id', pr.id, 'username', pr.username, 'full_name', pr.full_name, 'avatar_url', pr.avatar_url)
               FROM chat_channel_members o JOIN profiles pr ON pr.id = o.user_id
               WHERE o.channel_id = c.id ORDER BY (o.user_id = ${user.id}::uuid) LIMIT 1
             ) END AS dm_user,
             NULL::jsonb AS members_preview
      FROM chat_channels c
      LEFT JOIN projects p ON p.id = c.project_id
      LEFT JOIN chat_channel_members m ON m.channel_id = c.id AND m.user_id = ${user.id}::uuid
      WHERE c.id = ${input.channelId}::uuid
        AND (m.user_id IS NOT NULL OR (c.kind = 'public' AND app_private.chat_is_project_member(c.project_id, ${user.id}::uuid)))
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
      SELECT pr.id, pr.username, pr.full_name, pr.avatar_url, m.role, m.joined_at
      FROM chat_channel_members m JOIN profiles pr ON pr.id = m.user_id
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

"use server";

import { sql } from "drizzle-orm";

import { CHAT_MAX_GROUP_OTHERS } from "@/lib/messaging/constants";
import { publishChannel, publishUser } from "@/lib/messaging/publish";
import { chatFailure, chatRows, chatValue, invalidInput, isUuid, requireChatUser, unauthorized, uuidArray } from "@/lib/messaging/server";
import type { ChatNotify, ChatPerson } from "@/lib/messaging/types";
import { rateLimit } from "@/lib/redis";

/** Open (or create) the DM with one person. Privacy and blocks are enforced in SQL. */
export async function getOrCreateDm(input: { userId: string }) {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  if (!isUuid(input?.userId)) return invalidInput;
  if (!(await rateLimit(`chat:dm:${user.id}`, 120, 3600))) return { success: false as const, error: "chat_rate_limited" };
  try {
    const channelId = await chatValue<string>(sql`SELECT app_private.chat_get_or_create_dm(${user.id}::uuid, ${input.userId}::uuid) AS value`);
    return { success: true as const, channelId };
  } catch (error) {
    return chatFailure(error, "get_or_create_dm");
  }
}

/** A group chat: an unnamed private channel with up to 8 other people. */
export async function createGroup(input: { userIds: string[] }) {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  const userIds = Array.isArray(input?.userIds) ? input.userIds.filter(isUuid) : [];
  if (userIds.length < 1 || userIds.length > CHAT_MAX_GROUP_OTHERS) return invalidInput;
  if (!(await rateLimit(`chat:dm:${user.id}`, 120, 3600))) return { success: false as const, error: "chat_rate_limited" };
  try {
    const channelId = await chatValue<string>(sql`SELECT app_private.chat_create_group(${user.id}::uuid, ${uuidArray(userIds)}) AS value`);
    for (const id of [user.id, ...userIds]) publishUser(id, "membership.changed", { channel_id: channelId });
    return { success: true as const, channelId };
  } catch (error) {
    return chatFailure(error, "create_group");
  }
}

export async function addMembers(input: { channelId: string; userIds: string[] }) {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  const userIds = Array.isArray(input?.userIds) ? input.userIds.filter(isUuid) : [];
  if (!isUuid(input?.channelId) || userIds.length === 0) return invalidInput;
  try {
    const added = await chatValue<number>(sql`
      SELECT app_private.chat_add_members(${input.channelId}::uuid, ${user.id}::uuid, ${uuidArray(userIds)}) AS value
    `);
    publishChannel(input.channelId, "member.changed", { channel_id: input.channelId });
    for (const id of userIds) publishUser(id, "membership.changed", { channel_id: input.channelId });
    return { success: true as const, added };
  } catch (error) {
    return chatFailure(error, "add_members");
  }
}

export async function removeMember(input: { channelId: string; userId: string }) {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  if (!isUuid(input?.channelId) || !isUuid(input.userId)) return invalidInput;
  try {
    await chatRows(sql`SELECT app_private.chat_remove_member(${input.channelId}::uuid, ${user.id}::uuid, ${input.userId}::uuid)`);
    publishChannel(input.channelId, "member.changed", { channel_id: input.channelId });
    publishUser(input.userId, "membership.changed", { channel_id: input.channelId });
    return { success: true as const };
  } catch (error) {
    return chatFailure(error, "remove_member");
  }
}

/** Per-member view state: notification level, star, archive (close a DM). */
export async function setMemberState(input: { channelId: string; notify?: ChatNotify; starred?: boolean; archived?: boolean }) {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  if (!isUuid(input?.channelId)) return invalidInput;
  if (input.notify !== undefined && !["all", "mentions", "mute"].includes(input.notify)) return invalidInput;
  try {
    await chatRows(sql`
      SELECT app_private.chat_set_member_state(
        ${input.channelId}::uuid, ${user.id}::uuid, ${input.notify ?? null},
        ${input.starred ?? null}::boolean, ${input.archived ?? null}::boolean
      )
    `);
    publishUser(user.id, "membership.changed", { channel_id: input.channelId });
    return { success: true as const };
  } catch (error) {
    return chatFailure(error, "set_member_state");
  }
}

export type PersonResult = ChatPerson & { can_dm: boolean };

/** People search for New message and @mentions (trigram indexes on username and full_name). */
export async function searchPeople(input: { query: string }) {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  const query = typeof input?.query === "string" ? input.query.trim().slice(0, 64) : "";
  if (query.length < 2) return { success: true as const, people: [] as PersonResult[] };
  const pattern = `%${query.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
  try {
    const people = await chatRows<PersonResult>(sql`
      SELECT p.id, p.username, p.full_name, p.avatar_url,
             app_private.chat_can_dm(${user.id}::uuid, p.id) AS can_dm
      FROM profiles p
      WHERE p.id <> ${user.id}::uuid AND p.deleted_at IS NULL
        AND (p.username ILIKE ${pattern} OR p.full_name ILIKE ${pattern})
        AND NOT app_private.chat_is_blocked(${user.id}::uuid, p.id)
      ORDER BY (p.username ILIKE ${`${query}%`}) DESC, coalesce(p.full_name, p.username)
      LIMIT 20
    `);
    return { success: true as const, people };
  } catch (error) {
    return chatFailure(error, "search_people");
  }
}

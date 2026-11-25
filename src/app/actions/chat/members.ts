"use server";

import { sql } from "drizzle-orm";

import { CHAT_MAX_GROUP_OTHERS } from "@/lib/messaging/constants";
import { publishChannel, publishUser, publishUsers } from "@/lib/messaging/publish";
import { chatFailure, chatRows, chatValue, invalidInput, isUuid, requireChatUser, unauthorized, uuidArray } from "@/lib/messaging/server";
import type { ChatNotify, ChatPerson } from "@/lib/messaging/types";
import { getRedisClient, rateLimit } from "@/lib/redis";
import type { MessageReason } from "@/lib/messaging/can-message";

/**
 * Read-only lookup of the viewer's existing DM with one person (API-016): it never creates a
 * channel or changes membership state, so a link or prefetch can call it safely. The person's
 * display name rides along for the "start a conversation" prompt when no DM exists yet.
 */
export async function findDm(input: { userId: string }) {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  if (!isUuid(input?.userId)) return invalidInput;
  try {
    const [row] = await chatRows<{ channel_id: string | null; display_name: string | null }>(sql`
      SELECT
        (SELECT c.id FROM public.chat_channels c
           JOIN public.chat_channel_members m ON m.channel_id = c.id AND m.user_id = ${user.id}::uuid
          WHERE c.dm_key = least(${user.id}::text, ${input.userId}::text) || ':' || greatest(${user.id}::text, ${input.userId}::text)
            AND NOT app_private.chat_is_blocked(${user.id}::uuid, ${input.userId}::uuid)
          LIMIT 1) AS channel_id,
        (SELECT coalesce(nullif(p.full_name, ''), p.username) FROM public.profiles p
          WHERE p.id = ${input.userId}::uuid AND p.deleted_at IS NULL) AS display_name
    `);
    return { success: true as const, channelId: row?.channel_id ?? null, displayName: row?.display_name ?? null };
  } catch (error) {
    return chatFailure(error, "find_dm");
  }
}

/** Open (or create) the DM with one person. Privacy and blocks are enforced in SQL. */
export async function getOrCreateDm(input: { userId: string }) {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  if (!isUuid(input?.userId)) return invalidInput;
  if (!(await rateLimit(`chat:dm:${user.id}`, 120, 3600))) return { success: false as const, error: "chat_rate_limited" };
  try {
    const channelId = await chatValue<string>(sql`SELECT app_private.chat_get_or_create_dm(${user.id}::uuid, ${input.userId}::uuid) AS value`);
    // Opening a closed DM reopens it in the sidebar, like Slack.
    await chatRows(sql`SELECT app_private.chat_set_member_state(${channelId}::uuid, ${user.id}::uuid, NULL, NULL, false)`);
    publishUser(user.id, "membership.changed", { channel_id: channelId });
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
    publishUsers([user.id, ...userIds], "membership.changed", { channel_id: channelId });
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
    publishUsers(userIds, "membership.changed", { channel_id: input.channelId });
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

/** Make a channel member an admin or a member (channel admins only). */
export async function setMemberRole(input: { channelId: string; userId: string; role: "admin" | "member" }) {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  if (!isUuid(input?.channelId) || !isUuid(input.userId) || !["admin", "member"].includes(input.role)) return invalidInput;
  try {
    await chatRows(sql`SELECT app_private.chat_set_member_role(${input.channelId}::uuid, ${user.id}::uuid, ${input.userId}::uuid, ${input.role})`);
    publishChannel(input.channelId, "member.changed", { channel_id: input.channelId });
    return { success: true as const };
  } catch (error) {
    return chatFailure(error, "set_member_role");
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

/**
 * Can I message them, and the reason when it is safe to say: their own privacy is connections only (the same fact
 * their profile already shows). A block is never named — it reads as a plain no.
 */
function messageGateSql(me: string, target: ReturnType<typeof sql>) {
  return sql`
    SELECT t.id, app_private.chat_can_dm(${me}::uuid, t.id) AS can,
           CASE WHEN NOT app_private.chat_can_dm(${me}::uuid, t.id)
                 AND coalesce(p.message_privacy, 'connections') = 'connections'
                 AND NOT app_private.chat_is_blocked(${me}::uuid, t.id) THEN 'connections' END AS reason
    FROM (SELECT ${target} AS id) t LEFT JOIN profiles p ON p.id = t.id`;
}

/** For a list of Message buttons (organization members, directories): who you can message, one answer each. */
export async function canMessageMany(input: { userIds: string[] }) {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  if (!(await rateLimit(`chat:can-message:${user.id}`, 600, 3600))) return { success: false as const, error: "chat_rate_limited" };
  const ids = [...new Set(Array.isArray(input?.userIds) ? input.userIds.filter(isUuid) : [])].filter((id) => id !== user.id).slice(0, 100);
  if (!ids.length) return { success: true as const, gates: {} as Record<string, { canMessage: boolean; reason: MessageReason }> };
  try {
    const rows = await chatRows<{ id: string; can: boolean; reason: MessageReason }>(sql`${messageGateSql(user.id, sql`unnest(${uuidArray(ids)})`)}`);
    return { success: true as const, gates: Object.fromEntries(rows.map((row) => [row.id, { canMessage: Boolean(row.can), reason: row.reason }])) };
  } catch (error) {
    return chatFailure(error, "can_message");
  }
}

export type PersonContext = {
  timeZone: string | null;
  /** Shown on their card only when the profile is public, or you share a project. */
  headline?: string | null;
  location?: string | null;
  sharedProjects: { id: string; title: string; slug: string | null }[];
  sharedChannels: { id: string; name: string; project_title: string | null }[];
  /** Whether a DM with them can start (their privacy, organizations, blocks): `chat_can_dm`. */
  canMessage: boolean;
  /** Why not, only when it is their own message privacy; a block is never named. */
  reason: MessageReason;
};

/** For a DM's details and a person's card: their time zone (if they share activity), headline and location, and what you have in common. */
export async function getPersonContext(input: { userId: string }) {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  if (!isUuid(input?.userId)) return invalidInput;
  try {
    const blocked = await chatValue<boolean>(sql`SELECT app_private.chat_is_blocked(${user.id}::uuid, ${input.userId}::uuid) AS value`);
    if (blocked) return { success: true as const, context: { timeZone: null, sharedProjects: [], sharedChannels: [], canMessage: false, reason: null } satisfies PersonContext };
    const [sharedProjects, sharedChannels, profile, timeZone, canMessage] = await Promise.all([
      chatRows<PersonContext["sharedProjects"][number]>(sql`
        SELECT p.id, p.title, p.slug FROM workspace_members a
        JOIN workspace_members b ON b.workspace_id = a.workspace_id AND b.user_id = ${input.userId}::uuid
        JOIN workspaces p ON p.id = a.workspace_id
        WHERE a.user_id = ${user.id}::uuid AND p.deleted_at IS NULL ORDER BY p.title LIMIT 10
      `),
      chatRows<PersonContext["sharedChannels"][number]>(sql`
        SELECT c.id, c.name, p.title AS project_title FROM chat_channel_members a
        JOIN chat_channel_members b ON b.channel_id = a.channel_id AND b.user_id = ${input.userId}::uuid
        JOIN chat_channels c ON c.id = a.channel_id
        LEFT JOIN workspaces p ON p.id = c.workspace_id
        WHERE a.user_id = ${user.id}::uuid AND c.name IS NOT NULL AND c.archived_at IS NULL
        ORDER BY c.last_message_at DESC NULLS LAST LIMIT 10
      `),
      chatRows<{ show_activity: boolean | null; visibility: string | null; headline: string | null; location: string | null }>(sql`SELECT show_activity, visibility, headline, location FROM profiles WHERE id = ${input.userId}::uuid`).then((rows) => rows[0] ?? null),
      getRedisClient()?.get<string>(`presence:tz:${input.userId}`).catch(() => null) ?? Promise.resolve(null),
      chatRows<{ can: boolean; reason: MessageReason }>(sql`${messageGateSql(user.id, sql`${input.userId}::uuid`)}`).then((rows) => rows[0] ?? { can: false, reason: null }),
    ]);
    // The profile's own visibility decides: public, yours, or someone you share a project with.
    const open = profile?.visibility === "public" || input.userId === user.id || sharedProjects.length > 0;
    const context: PersonContext = {
      timeZone: profile?.show_activity === false ? null : timeZone ?? null,
      headline: open ? profile?.headline?.trim() || null : null,
      location: open ? profile?.location?.trim() || null : null,
      sharedProjects,
      sharedChannels,
      canMessage: Boolean(canMessage.can),
      reason: canMessage.reason,
    };
    return { success: true as const, context };
  } catch (error) {
    return chatFailure(error, "person_context");
  }
}

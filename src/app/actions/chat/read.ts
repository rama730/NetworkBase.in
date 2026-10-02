"use server";

import { sql } from "drizzle-orm";

import { publishUser } from "@/lib/messaging/publish";
import { chatFailure, chatRows, chatValue, invalidInput, isUuid, requireChatUser, unauthorized } from "@/lib/messaging/server";
import type { ChatBootstrap } from "@/lib/messaging/types";

/**
 * App entry and the background poll: every joined channel with its unread
 * state, the user's projects (first load only), and the pending invitation and
 * application counts from their real tables.
 */
export async function bootstrap(input: { since?: string | null } = {}) {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  const since = typeof input.since === "string" && !Number.isNaN(Date.parse(input.since)) ? input.since : null;
  try {
    const [data, [counts]] = await Promise.all([
      chatValue<ChatBootstrap>(sql`SELECT app_private.chat_bootstrap(${user.id}::uuid, ${since}::timestamptz) AS value`),
      chatRows<{ invites: number; applications: number }>(sql`
        SELECT
          (SELECT count(*)::int FROM project_invitations
            WHERE candidate_id = ${user.id}::uuid AND status = 'pending' AND expires_at > now()) AS invites,
          (SELECT count(*)::int FROM role_applications
            WHERE creator_id = ${user.id}::uuid AND status = 'pending') AS applications
      `),
    ]);
    return { success: true as const, data, pending: counts ?? { invites: 0, applications: 0 } };
  } catch (error) {
    return chatFailure(error, "bootstrap");
  }
}

/** Move the read cursor forward (only-if-newer) and tell the user's other tabs. */
export async function markRead(input: { channelId: string; seq: number }) {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  if (!isUuid(input?.channelId) || !Number.isInteger(input.seq) || input.seq < 1) return invalidInput;
  try {
    const moved = await chatValue<boolean>(sql`
      SELECT app_private.chat_mark_read(${input.channelId}::uuid, ${user.id}::uuid, ${input.seq}::bigint) AS value
    `);
    if (moved) publishUser(user.id, "read.moved", { channel_id: input.channelId, seq: input.seq });
    return { success: true as const, moved };
  } catch (error) {
    return chatFailure(error, "mark_read");
  }
}

export async function markThreadRead(input: { channelId: string; rootSeq: number; seq: number }) {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  if (!isUuid(input?.channelId) || !Number.isInteger(input.rootSeq) || !Number.isInteger(input.seq)) return invalidInput;
  try {
    const moved = await chatValue<boolean>(sql`
      SELECT app_private.chat_mark_thread_read(${input.channelId}::uuid, ${user.id}::uuid, ${input.rootSeq}::bigint, ${input.seq}::bigint) AS value
    `);
    return { success: true as const, moved };
  } catch (error) {
    return chatFailure(error, "mark_thread_read");
  }
}

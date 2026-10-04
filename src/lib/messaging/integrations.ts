import { sql, type SQL } from "drizzle-orm";

import { db } from "@/lib/db";
import { publishSentMessage } from "@/lib/messaging/publish";
import type { ChatMessageView } from "@/lib/messaging/types";

// Hooks other domains call (projects, applications, invitations). Each takes
// an executor so it runs inside the caller's transaction.
type Executor = { execute: (query: SQL) => PromiseLike<unknown> };

async function value<T>(executor: Executor, query: SQL): Promise<T> {
  const rows = (await executor.execute(query)) as unknown as Array<{ value: T }>;
  return rows[0]?.value as T;
}

/** Keep chat membership in step with project membership (report 7.1, 7.9). */
export async function syncProjectChat(
  executor: Executor,
  projectId: string,
  userId: string | null,
  op: "ensure_default" | "add" | "remove" | "role",
) {
  await executor.execute(sql`SELECT app_private.chat_sync_project_members(${projectId}::uuid, ${userId}::uuid, ${op})`);
}

/** The application's private thread (applicant + reviewers) opened by the application card. */
export async function ensureApplicationChannel(executor: Executor, applicationId: string) {
  return value<string>(executor, sql`SELECT app_private.chat_ensure_application_channel(${applicationId}::uuid) AS value`);
}

/** A system line in an application thread, e.g. a status change. */
export async function postApplicationUpdate(executor: Executor, applicationId: string, actorId: string, text: string) {
  const channelId = await ensureApplicationChannel(executor, applicationId);
  await executor.execute(sql`SELECT app_private.chat_post_system(${channelId}::uuid, ${actorId}::uuid, ${text.slice(0, 4000)})`);
  return channelId;
}

/**
 * Post an invitation card into the inviter↔candidate DM. Invitations may open a
 * DM regardless of message privacy (never across a block).
 */
export async function postInviteCard(input: {
  invitationId: string;
  inviterId: string;
  candidateId: string;
  note: string | null;
}) {
  const channelId = await value<string>(db, sql`
    SELECT app_private.chat_get_or_create_dm(${input.inviterId}::uuid, ${input.candidateId}::uuid, 'invite') AS value
  `);
  const body = (input.note ?? "").slice(0, 4000);
  const card = { kind: "invite" as const, ref_id: input.invitationId };
  const result = await value<{ channel_seq: number; created_at: string; deduped: boolean; notify?: string[] }>(db, sql`
    SELECT app_private.chat_send_message(
      ${channelId}::uuid, ${input.inviterId}::uuid, ${body}, ${`invite:${input.invitationId}`},
      NULL, '{}'::uuid[], NULL, '[]'::jsonb, ${JSON.stringify(card)}::text::jsonb
    ) AS value
  `);
  if (!result.deduped) {
    const message: ChatMessageView = {
      channel_id: channelId,
      seq: Number(result.channel_seq),
      author_id: input.inviterId,
      author: null,
      kind: "user",
      body,
      thread_root_seq: null,
      reply_count: 0,
      last_reply_seq: null,
      last_reply_at: null,
      edited_at: null,
      deleted_at: null,
      created_at: result.created_at,
      client_message_id: `invite:${input.invitationId}`,
      attachments: [],
      reactions: [],
      card,
      pinned: false,
    };
    publishSentMessage({ message, notify: result.notify ?? [], mentioned: [], channelLabel: null });
  }
  return channelId;
}

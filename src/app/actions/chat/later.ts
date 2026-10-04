"use server";

import { sql } from "drizzle-orm";

import { CHAT_MAX_BODY } from "@/lib/messaging/constants";
import { chatFailure, chatRows, invalidInput, isUuid, requireChatUser, unauthorized } from "@/lib/messaging/server";
import type { ChatPerson } from "@/lib/messaging/types";

const MAX_AHEAD_MS = 120 * 24 * 60 * 60 * 1000;

function futureDate(value: unknown): string | null | "invalid" {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return "invalid";
  const at = Date.parse(value);
  if (at <= Date.now() || at - Date.now() > MAX_AHEAD_MS) return "invalid";
  return new Date(at).toISOString();
}

/** Save for later (on/off), optionally with a reminder time. */
export async function saveMessage(input: { channelId: string; seq: number; on: boolean; remindAt?: string | null }) {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  if (!isUuid(input?.channelId) || !Number.isInteger(input.seq)) return invalidInput;
  const remindAt = futureDate(input.remindAt);
  if (remindAt === "invalid") return { success: false as const, error: "chat_schedule_in_past" };
  try {
    if (!input.on) {
      await chatRows(sql`
        DELETE FROM chat_saved WHERE user_id = ${user.id}::uuid AND channel_id = ${input.channelId}::uuid AND message_seq = ${input.seq}
      `);
      return { success: true as const };
    }
    const saved = await chatRows<{ ok: number }>(sql`
      INSERT INTO chat_saved (user_id, channel_id, message_seq, remind_at)
      SELECT ${user.id}::uuid, ${input.channelId}::uuid, ${input.seq}, ${remindAt}::timestamptz
      WHERE app_private.chat_is_member(${input.channelId}::uuid, ${user.id}::uuid)
        AND EXISTS (SELECT 1 FROM chat_messages WHERE channel_id = ${input.channelId}::uuid AND channel_seq = ${input.seq} AND deleted_at IS NULL)
      ON CONFLICT (user_id, channel_id, message_seq) DO UPDATE
        SET remind_at = coalesce(EXCLUDED.remind_at, chat_saved.remind_at), reminded_at = CASE WHEN EXCLUDED.remind_at IS NULL THEN chat_saved.reminded_at END
      RETURNING 1 AS ok
    `);
    if (!saved.length) return { success: false as const, error: "chat_message_not_found" };
    return { success: true as const };
  } catch (error) {
    return chatFailure(error, "save");
  }
}

export type SavedItem = {
  channel_id: string;
  channel_name: string | null;
  channel_kind: string;
  /** A group's title, or the other person's name for a DM. */
  channel_title: string | null;
  seq: number;
  thread_root_seq: number | null;
  body: string;
  created_at: string;
  saved_at: string;
  remind_at: string | null;
  reminded_at: string | null;
  author: ChatPerson | null;
};

/** Saved messages, due reminders first, then newest saves. */
export async function listSaved() {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  try {
    const items = await chatRows<SavedItem>(sql`
      SELECT s.channel_id, c.name AS channel_name, c.kind AS channel_kind, s.message_seq::int AS seq,
             CASE WHEN c.kind = 'dm' THEN (
               SELECT coalesce(op.full_name, op.username) FROM chat_channel_members o JOIN profiles op ON op.id = o.user_id
               WHERE o.channel_id = c.id ORDER BY (o.user_id = ${user.id}::uuid) LIMIT 1
             ) ELSE c.title END AS channel_title,
             m.thread_root_seq::int AS thread_root_seq, m.body, m.created_at, s.created_at AS saved_at, s.remind_at, s.reminded_at,
             CASE WHEN pr.id IS NULL THEN NULL ELSE jsonb_build_object(
               'id', pr.id, 'username', pr.username, 'full_name', pr.full_name, 'avatar_url', pr.avatar_url
             ) END AS author
      FROM chat_saved s
      JOIN chat_channels c ON c.id = s.channel_id
      JOIN chat_messages m ON m.channel_id = s.channel_id AND m.channel_seq = s.message_seq
      LEFT JOIN profiles pr ON pr.id = m.author_id
      WHERE s.user_id = ${user.id}::uuid AND m.deleted_at IS NULL
        AND app_private.chat_is_member(s.channel_id, ${user.id}::uuid)
      ORDER BY (s.remind_at IS NOT NULL AND s.reminded_at IS NULL) DESC, s.remind_at ASC NULLS LAST, s.created_at DESC
      LIMIT 200
    `);
    return { success: true as const, items };
  } catch (error) {
    return chatFailure(error, "saved");
  }
}

/** The saved keys of the open conversation, so rows can show their bookmark state. */
export async function listSavedSeqs(input: { channelId: string }) {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  if (!isUuid(input?.channelId)) return invalidInput;
  try {
    const rows = await chatRows<{ seq: number }>(sql`
      SELECT message_seq::int AS seq FROM chat_saved WHERE user_id = ${user.id}::uuid AND channel_id = ${input.channelId}::uuid
    `);
    return { success: true as const, seqs: rows.map((row) => row.seq) };
  } catch (error) {
    return chatFailure(error, "saved_seqs");
  }
}

/** Queue a message to send later (sent by the chat-due job, within a minute of send_at). */
export async function scheduleMessage(input: { channelId: string; body: string; sendAt: string; threadRootSeq?: number | null }) {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  if (!isUuid(input?.channelId) || typeof input.body !== "string" || !input.body.trim() || input.body.length > CHAT_MAX_BODY) return invalidInput;
  if (input.threadRootSeq != null && !Number.isInteger(input.threadRootSeq)) return invalidInput;
  const sendAt = futureDate(input.sendAt);
  if (sendAt === "invalid" || sendAt === null) return { success: false as const, error: "chat_schedule_in_past" };
  try {
    const [row] = await chatRows<{ id: string }>(sql`
      INSERT INTO chat_scheduled_messages (channel_id, user_id, body, thread_root_seq, send_at)
      SELECT ${input.channelId}::uuid, ${user.id}::uuid, ${input.body}, ${input.threadRootSeq ?? null}::bigint, ${sendAt}::timestamptz
      WHERE app_private.chat_is_member(${input.channelId}::uuid, ${user.id}::uuid)
        AND (SELECT count(*) FROM chat_scheduled_messages WHERE user_id = ${user.id}::uuid AND sent_at IS NULL) < 100
      RETURNING id
    `);
    if (!row) return { success: false as const, error: "chat_not_member" };
    return { success: true as const, id: row.id, sendAt };
  } catch (error) {
    return chatFailure(error, "schedule");
  }
}

export type ScheduledItem = {
  id: string;
  channel_id: string;
  channel_name: string | null;
  channel_kind: string;
  body: string;
  thread_root_seq: number | null;
  send_at: string;
  failed_reason: string | null;
};

export async function listScheduled() {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  try {
    const items = await chatRows<ScheduledItem>(sql`
      SELECT s.id, s.channel_id, c.name AS channel_name, c.kind AS channel_kind, s.body, s.thread_root_seq::int AS thread_root_seq,
             s.send_at, s.failed_reason
      FROM chat_scheduled_messages s JOIN chat_channels c ON c.id = s.channel_id
      WHERE s.user_id = ${user.id}::uuid AND s.sent_at IS NULL
      ORDER BY s.send_at
      LIMIT 100
    `);
    return { success: true as const, items };
  } catch (error) {
    return chatFailure(error, "scheduled");
  }
}

export async function cancelScheduled(input: { id: string }) {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  if (!isUuid(input?.id)) return invalidInput;
  try {
    await chatRows(sql`DELETE FROM chat_scheduled_messages WHERE id = ${input.id}::uuid AND user_id = ${user.id}::uuid AND sent_at IS NULL`);
    return { success: true as const };
  } catch (error) {
    return chatFailure(error, "cancel_scheduled");
  }
}

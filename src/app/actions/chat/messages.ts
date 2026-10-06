"use server";

import { sql } from "drizzle-orm";

import { createTaskAction } from "@/app/actions/project";
import { hydrateCards } from "@/lib/messaging/cards";
import { CHAT_MAX_BODY } from "@/lib/messaging/constants";
import { publishChannel, publishUser, publishUsers } from "@/lib/messaging/publish";
import { listTopLevel, selectMessages } from "@/lib/messaging/queries";
import { takeReactToken, takeSendToken } from "@/lib/messaging/send-bucket";
import { sendAs, type SendInput } from "@/lib/messaging/send";
import { chatFailure, chatRows, chatValue, invalidInput, isUuid, requireChatUser, unauthorized, uuidArray } from "@/lib/messaging/server";
import { parseMentions, tokensToPlainText } from "@/lib/messaging/tokens";
import { messageHref } from "@/lib/messaging/routes";
import type { ChatCardRef } from "@/lib/messaging/types";
import { rateLimit } from "@/lib/redis";
import { countsOrNothing } from "@/lib/messaging/inbox-counts";

export async function sendMessage(input: SendInput & { alsoToChannel?: boolean }) {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  if (!isUuid(input?.channelId) || typeof input.body !== "string" || input.body.length > CHAT_MAX_BODY) return invalidInput;
  if (input.clientId != null && (typeof input.clientId !== "string" || input.clientId.length > 160)) return invalidInput;
  if (!takeSendToken(user.id)) return { success: false as const, error: "chat_rate_limited" };
  try {
    const { alsoToChannel, ...message } = input;
    const sent = await sendAs(user, message, null);
    // ponytail: "Also send to #channel" posts a second, top-level copy (L-31), files included.
    // ceiling: the copy doesn't link back to the thread. upgrade: a reply-ref column.
    // Its mentions are flattened (the reply already notified them), and a failed copy
    // never fails the reply that was sent: the client only says "Also sent" when it was.
    if (!sent.success || !alsoToChannel || !input.threadRootSeq || !(input.body.trim() || input.assetIds?.length)) return sent;
    const copy = await flattenMentions(input.body)
      .then((body) => sendAs(user, { channelId: input.channelId, body, assetIds: input.assetIds }, null))
      .catch(() => null);
    return { ...sent, alsoSent: Boolean(copy?.success) };
  } catch (error) {
    return chatFailure(error, "send");
  }
}

/** "@Ann" as text instead of a <@id> token, so a copy never notifies anyone again. */
async function flattenMentions(body: string) {
  const ids = parseMentions(body).userIds;
  const names = ids.length
    ? await chatRows<{ id: string; name: string }>(sql`
        SELECT id, coalesce(full_name, username, 'someone') AS name FROM profiles WHERE id = ANY(${uuidArray(ids)})
      `)
    : [];
  return body
    .replace(/<@([0-9a-fA-F-]{36})>/g, (_match, id: string) => `@${names.find((n) => n.id === id.toLowerCase())?.name ?? "someone"}`)
    .replace(/<!(channel|here)>/g, "@$1");
}

/** `/task Title`: create a task in the channel's project, then post its card. */
export async function createTaskFromMessage(input: { channelId: string; title: string; threadRootSeq?: number | null }) {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  if (!isUuid(input?.channelId) || typeof input.title !== "string" || !input.title.trim()) return invalidInput;
  if (!takeSendToken(user.id)) return { success: false as const, error: "chat_rate_limited" };
  try {
    const projectId = await chatValue<string | null>(sql`
      SELECT project_id AS value FROM chat_channels
      WHERE id = ${input.channelId}::uuid AND app_private.chat_is_member(id, ${user.id}::uuid)
    `);
    if (!projectId) return { success: false as const, error: "chat_task_needs_project" };
    const created = await createTaskAction({ projectId, title: input.title.trim().slice(0, 200), status: "todo", priority: "medium" });
    if (!created.success || !("task" in created) || !created.task) {
      return { success: false as const, error: "chat_task_create_failed" };
    }
    return await sendAs(user, { channelId: input.channelId, body: "", threadRootSeq: input.threadRootSeq }, { kind: "task", ref_id: created.task.id });
  } catch (error) {
    return chatFailure(error, "create_task");
  }
}

export async function editMessage(input: { channelId: string; seq: number; body: string }) {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  if (!isUuid(input?.channelId) || !Number.isInteger(input.seq) || typeof input.body !== "string") return invalidInput;
  try {
    // Mentions follow the edited body (MUT-01); newly mentioned people get a hint for their Inbox.
    const added = await chatValue<string[]>(sql`
      SELECT to_jsonb(app_private.chat_edit_message(${input.channelId}::uuid, ${input.seq}::bigint, ${user.id}::uuid, ${input.body},
        ${uuidArray(parseMentions(input.body).userIds)})) AS value
    `);
    publishChannel(input.channelId, "message.edit", { channel_id: input.channelId, seq: input.seq, body: input.body, edited_at: new Date().toISOString() });
    publishUsers(added ?? [], "hint", { channel_id: input.channelId, seq: input.seq, mention: true, thread_root_seq: null });
    return { success: true as const };
  } catch (error) {
    return chatFailure(error, "edit");
  }
}

/** Remove your message's link preview for everyone (the link stays in the text). */
export async function hideLinkPreview(input: { channelId: string; seq: number }) {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  if (!isUuid(input?.channelId) || !Number.isInteger(input.seq)) return invalidInput;
  try {
    const rows = await chatRows<{ channel_seq: number }>(sql`
      UPDATE chat_messages SET link_preview_hidden = true
      WHERE channel_id = ${input.channelId}::uuid AND channel_seq = ${input.seq} AND author_id = ${user.id}::uuid AND deleted_at IS NULL
        -- Same rule as editing: a current member, in a live channel (DB-002).
        AND app_private.chat_is_member(${input.channelId}::uuid, ${user.id}::uuid)
        AND EXISTS (SELECT 1 FROM chat_channels c WHERE c.id = ${input.channelId}::uuid AND c.archived_at IS NULL)
      RETURNING channel_seq
    `);
    if (!rows.length) return { success: false as const, error: "chat_not_editable" };
    publishChannel(input.channelId, "message.preview_hidden", { channel_id: input.channelId, seq: input.seq });
    return { success: true as const };
  } catch (error) {
    return chatFailure(error, "hide_preview");
  }
}

export async function deleteMessage(input: { channelId: string; seq: number }) {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  if (!isUuid(input?.channelId) || !Number.isInteger(input.seq)) return invalidInput;
  try {
    await chatRows(sql`SELECT app_private.chat_delete_message(${input.channelId}::uuid, ${input.seq}::bigint, ${user.id}::uuid)`);
    publishChannel(input.channelId, "message.delete", { channel_id: input.channelId, seq: input.seq });
    return { success: true as const };
  } catch (error) {
    return chatFailure(error, "delete");
  }
}

/** Top-level timeline page plus hydrated cards. */
const THREAD_PAGE = 500;

export async function listMessages(input: { channelId: string; before?: number; around?: number }) {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  if (!isUuid(input?.channelId)) return invalidInput;
  try {
    const messages = await listTopLevel(user.id, input.channelId, { before: input.before, around: input.around });
    const cards = await hydrateCards(user.id, messages.flatMap((message) => (message.card ? [message.card] : [])));
    return { success: true as const, messages, cards };
  } catch (error) {
    return chatFailure(error, "list");
  }
}

/** Thread replies, newest page first (default 500); `before` pages older ones (no root then). */
export async function listThread(input: { channelId: string; rootSeq: number; before?: number; limit?: number }) {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  if (!isUuid(input?.channelId) || !Number.isInteger(input.rootSeq)) return invalidInput;
  if (input.before !== undefined && !Number.isInteger(input.before)) return invalidInput;
  const limit = Number.isInteger(input.limit) ? Math.min(Math.max(input.limit!, 1), THREAD_PAGE) : THREAD_PAGE;
  try {
    const [rootRows, newest, [follow]] = await Promise.all([
      input.before === undefined
        ? selectMessages(user.id, input.channelId, sql`m.channel_seq = ${input.rootSeq}`, sql`m.channel_seq ASC`, 1)
        : Promise.resolve([]),
      selectMessages(
        user.id, input.channelId,
        input.before === undefined
          ? sql`m.thread_root_seq = ${input.rootSeq}`
          : sql`m.thread_root_seq = ${input.rootSeq} AND m.channel_seq < ${input.before}`,
        sql`m.channel_seq DESC`, limit + 1,
      ),
      chatRows<{ last_read_seq: number }>(sql`
        SELECT last_read_seq::int FROM chat_thread_follows
        WHERE user_id = ${user.id}::uuid AND channel_id = ${input.channelId}::uuid AND root_seq = ${input.rootSeq}
      `),
    ]);
    const replies = newest.slice(0, limit).reverse();
    const rows = [...rootRows, ...replies];
    const cards = await hydrateCards(user.id, rows.flatMap((message) => (message.card ? [message.card] : [])));
    return {
      success: true as const,
      root: rootRows[0] ?? null,
      replies,
      hasOlder: newest.length > limit,
      cards,
      following: Boolean(follow),
      lastReadSeq: follow?.last_read_seq ?? null,
    };
  } catch (error) {
    return chatFailure(error, "thread");
  }
}

/** Follow or leave a thread (replies notify followers). */
export async function setThreadFollow(input: { channelId: string; rootSeq: number; on: boolean }) {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  if (!isUuid(input?.channelId) || !Number.isInteger(input.rootSeq)) return invalidInput;
  try {
    await chatRows(sql`SELECT app_private.chat_set_thread_follow(${input.channelId}::uuid, ${user.id}::uuid, ${input.rootSeq}::bigint, ${Boolean(input.on)})`);
    // Leaving a thread reads its replies: the badge drops everywhere now.
    if (!input.on) publishUser(user.id, "inbox.count", await countsOrNothing(user.id));
    return { success: true as const };
  } catch (error) {
    return chatFailure(error, "thread_follow");
  }
}

/** Mark unread from this message: the channel's read cursor moves back to just before it. */
export async function markUnread(input: { channelId: string; seq: number }) {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  if (!isUuid(input?.channelId) || !Number.isInteger(input.seq) || input.seq < 1) return invalidInput;
  try {
    await chatRows(sql`SELECT app_private.chat_mark_unread(${input.channelId}::uuid, ${user.id}::uuid, ${input.seq}::bigint)`);
    publishUser(user.id, "membership.changed", { channel_id: input.channelId });
    return { success: true as const };
  } catch (error) {
    return chatFailure(error, "mark_unread");
  }
}

/** Who reacted with what, for the reaction tooltip (loaded on hover). */
export async function listReactors(input: { channelId: string; seq: number }) {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  if (!isUuid(input?.channelId) || !Number.isInteger(input.seq)) return invalidInput;
  try {
    const rows = await chatRows<{ emoji: string; names: string[] }>(sql`
      SELECT r.emoji, jsonb_agg(CASE WHEN r.user_id = ${user.id}::uuid THEN 'You' ELSE coalesce(pr.full_name, pr.username, 'Someone') END ORDER BY r.created_at) AS names
      FROM chat_reactions r
      LEFT JOIN profiles pr ON pr.id = r.user_id
      WHERE r.channel_id = ${input.channelId}::uuid AND r.message_seq = ${input.seq}
        AND app_private.chat_is_member(${input.channelId}::uuid, ${user.id}::uuid)
      GROUP BY r.emoji
    `);
    return { success: true as const, reactors: Object.fromEntries(rows.map((row) => [row.emoji, row.names])) as Record<string, string[]> };
  } catch (error) {
    return chatFailure(error, "reactors");
  }
}

/**
 * Share a message into another conversation you belong to: an optional note,
 * then the original as a quote with its link. Mentions are flattened to text
 * so sharing never re-notifies anyone.
 */
export async function shareMessage(input: { channelId: string; seq: number; toChannelId: string; note?: string }) {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  if (!isUuid(input?.channelId) || !isUuid(input.toChannelId) || !Number.isInteger(input.seq)) return invalidInput;
  if (input.note !== undefined && (typeof input.note !== "string" || input.note.length > 1000)) return invalidInput;
  if (!takeSendToken(user.id)) return { success: false as const, error: "chat_rate_limited" };
  try {
    const [source] = await chatRows<{ body: string; author: string | null; channel_name: string | null; thread_root_seq: number | null }>(sql`
      SELECT m.body, m.thread_root_seq, coalesce(pr.full_name, pr.username) AS author, c.name AS channel_name
      FROM chat_messages m
      JOIN chat_channels c ON c.id = m.channel_id
      LEFT JOIN profiles pr ON pr.id = m.author_id
      WHERE m.channel_id = ${input.channelId}::uuid AND m.channel_seq = ${input.seq} AND m.deleted_at IS NULL
        AND app_private.chat_is_member(${input.channelId}::uuid, ${user.id}::uuid)
    `);
    if (!source) return { success: false as const, error: "chat_message_not_found" };
    const names = await chatRows<{ id: string; name: string }>(sql`
      SELECT p.id, coalesce(p.full_name, p.username, 'someone') AS name FROM profiles p
      WHERE p.id = ANY(${uuidArray(Array.from(source.body.matchAll(/<@([0-9a-f-]{36})>/g), (m) => m[1]!))})
    `);
    // Attachment-only messages still quote something readable.
    const text = tokensToPlainText(source.body, (id) => names.find((n) => n.id === id)?.name).trim() || "(attachment)";
    const origin = source.channel_name ? `#${source.channel_name}` : "a conversation";
    const quote = text.split("\n").map((line) => `> ${line}`).join("\n");
    const link = messageHref(input.channelId, input.seq, source.thread_root_seq);
    const body = [input.note?.trim(), `${quote}\n— ${source.author ?? "Someone"} in ${origin} · [View message](${link})`].filter(Boolean).join("\n\n").slice(0, CHAT_MAX_BODY);
    return await sendAs(user, { channelId: input.toChannelId, body }, null);
  } catch (error) {
    return chatFailure(error, "share");
  }
}

export type ChannelFile = { channel_id: string; seq: number; thread_root_seq: number | null; asset_id: string; name: string; mime: string; size: number; created_at: string; author: string | null };

/** Every attachment in a conversation, newest first. */
export async function listFiles(input: { channelId: string }) {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  if (!isUuid(input?.channelId)) return invalidInput;
  try {
    const files = await chatRows<ChannelFile>(sql`
      SELECT a.channel_id, a.message_seq::int AS seq, m.thread_root_seq::int AS thread_root_seq, a.asset_id, a.name, a.mime, a.size::bigint AS size, a.created_at,
             coalesce(pr.full_name, pr.username) AS author
      FROM chat_attachments a
      JOIN chat_messages m ON m.channel_id = a.channel_id AND m.channel_seq = a.message_seq
      LEFT JOIN profiles pr ON pr.id = m.author_id
      WHERE a.channel_id = ${input.channelId}::uuid AND m.deleted_at IS NULL
        AND app_private.chat_is_member(${input.channelId}::uuid, ${user.id}::uuid)
      ORDER BY a.message_seq DESC, a.idx
      LIMIT 200
    `);
    return { success: true as const, files: files.map((f) => ({ ...f, size: Number(f.size) })) };
  } catch (error) {
    return chatFailure(error, "files");
  }
}

export async function refreshCard(input: { kind: ChatCardRef["kind"]; refId: string }) {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  if (!isUuid(input?.refId) || !["application", "task", "invite"].includes(input.kind)) return invalidInput;
  const cards = await hydrateCards(user.id, [{ kind: input.kind, ref_id: input.refId }]);
  return { success: true as const, card: cards[`${input.kind}:${input.refId}`] };
}

// ponytail: reactions notify nobody (L-10). upgrade: an Activity row, not a tray row.
export async function react(input: { channelId: string; seq: number; emoji: string; on: boolean }) {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  if (!isUuid(input?.channelId) || !Number.isInteger(input.seq) || typeof input.emoji !== "string" || !input.emoji || input.emoji.length > 64) return invalidInput;
  if (!takeReactToken(user.id)) return { success: false as const, error: "chat_rate_limited" };
  try {
    await chatRows(sql`SELECT app_private.chat_react(${input.channelId}::uuid, ${input.seq}::bigint, ${user.id}::uuid, ${input.emoji}, ${Boolean(input.on)})`);
    publishChannel(input.channelId, input.on ? "reaction.add" : "reaction.remove", {
      channel_id: input.channelId, seq: input.seq, emoji: input.emoji, user_id: user.id,
    });
    return { success: true as const };
  } catch (error) {
    return chatFailure(error, "react");
  }
}

export async function pinMessage(input: { channelId: string; seq: number; on: boolean }) {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  if (!isUuid(input?.channelId) || !Number.isInteger(input.seq)) return invalidInput;
  try {
    await chatRows(sql`SELECT app_private.chat_pin(${input.channelId}::uuid, ${input.seq}::bigint, ${user.id}::uuid, ${Boolean(input.on)})`);
    publishChannel(input.channelId, "pin.changed", { channel_id: input.channelId, seq: input.seq, pinned: Boolean(input.on) });
    return { success: true as const };
  } catch (error) {
    return chatFailure(error, "pin");
  }
}

export async function listPins(input: { channelId: string }) {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  if (!isUuid(input?.channelId)) return invalidInput;
  try {
    const messages = await selectMessages(
      user.id, input.channelId,
      sql`EXISTS (SELECT 1 FROM chat_pins p WHERE p.channel_id = m.channel_id AND p.message_seq = m.channel_seq)`,
      sql`m.channel_seq DESC`, 100,
    );
    return { success: true as const, messages };
  } catch (error) {
    return chatFailure(error, "pins");
  }
}

export async function reportMessage(input: { channelId: string; seq: number; reason: string }) {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  if (!isUuid(input?.channelId) || !Number.isInteger(input.seq) || typeof input.reason !== "string") return invalidInput;
  if (!(await rateLimit(`chat:report:${user.id}`, 10, 3600))) return { success: false as const, error: "chat_rate_limited" };
  try {
    await chatRows(sql`SELECT app_private.chat_report(${input.channelId}::uuid, ${input.seq}::bigint, ${user.id}::uuid, ${input.reason.slice(0, 1000)})`);
    return { success: true as const };
  } catch (error) {
    return chatFailure(error, "report");
  }
}

/** "Created from message" on a task: the chat messages whose task card points at it (viewer must be a member). */
export async function listTaskSourceMessages(input: { taskId: string }) {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  if (!isUuid(input?.taskId)) return invalidInput;
  try {
    const links = await chatRows<{ channel_id: string; seq: number; channel_name: string | null; preview: string | null }>(sql`
      SELECT c.channel_id, c.message_seq::int AS seq, ch.name AS channel_name, ch.last_preview AS preview
      FROM chat_message_cards c
      JOIN chat_channels ch ON ch.id = c.channel_id
      WHERE c.kind = 'task' AND c.ref_id = ${input.taskId}::uuid
        AND app_private.chat_is_member(c.channel_id, ${user.id}::uuid)
      LIMIT 5
    `);
    return { success: true as const, links };
  } catch (error) {
    return chatFailure(error, "task_source");
  }
}

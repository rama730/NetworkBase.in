"use server";

import { sql } from "drizzle-orm";

import { createTaskAction } from "@/app/actions/project";
import { hydrateCards } from "@/lib/messaging/cards";
import { CHAT_MAX_ATTACHMENTS, CHAT_MAX_BODY } from "@/lib/messaging/constants";
import { publishChannel, publishSentMessage } from "@/lib/messaging/publish";
import { listTopLevel, selectMessages } from "@/lib/messaging/queries";
import { takeReactToken, takeSendToken } from "@/lib/messaging/send-bucket";
import {
  chatFailure,
  chatRows,
  chatValue,
  invalidInput,
  isUuid,
  jsonParam,
  requireChatUser,
  unauthorized,
  uuidArray,
} from "@/lib/messaging/server";
import { parseMentions } from "@/lib/messaging/tokens";
import type { ChatAttachmentView, ChatCardRef, ChatMessageView, ChatPerson } from "@/lib/messaging/types";
import { rateLimit } from "@/lib/redis";

type SendInput = {
  channelId: string;
  body: string;
  clientId?: string | null;
  threadRootSeq?: number | null;
  assetIds?: string[];
};

type SendResult = {
  channel_seq: number;
  created_at: string;
  deduped: boolean;
  notify?: string[];
  channel_kind?: string;
};

function authorFromUser(user: { id: string; user_metadata?: Record<string, unknown> }): ChatPerson {
  const meta = user.user_metadata ?? {};
  const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
  return {
    id: user.id,
    username: text(meta.username),
    full_name: text(meta.full_name) ?? text(meta.name),
    avatar_url: text(meta.avatar_url),
  };
}

async function send(user: { id: string; user_metadata?: Record<string, unknown> }, input: SendInput, card: ChatCardRef | null) {
  const body = typeof input.body === "string" ? input.body : "";
  const assetIds = (input.assetIds ?? []).filter(isUuid).slice(0, CHAT_MAX_ATTACHMENTS);

  // Only the sender's own verified uploads can be attached; size and type come
  // from the verified asset, never from the client.
  let attachments: ChatAttachmentView[] = [];
  if (assetIds.length > 0) {
    const assets = await chatRows<{ id: string; mime: string; size: number; name: string; width: number | null; height: number | null }>(sql`
      SELECT id, coalesce(verified_mime_type, declared_mime_type) AS mime, coalesce(verified_size, declared_size)::bigint AS size,
             coalesce(metadata->>'filename', '') AS name, (metadata->>'width')::int AS width, (metadata->>'height')::int AS height
      FROM storage_assets
      WHERE id = ANY(${uuidArray(assetIds)}) AND owner_user_id = ${user.id}::uuid AND state = 'verified'
    `);
    if (assets.length !== assetIds.length) return { success: false as const, error: "chat_attachment_not_ready" };
    attachments = assetIds.map((id, idx) => {
      const asset = assets.find((row) => row.id === id)!;
      return { idx, asset_id: id, name: asset.name, mime: asset.mime, size: Number(asset.size), width: asset.width, height: asset.height };
    });
  }

  const { userIds, broadcast } = parseMentions(body);
  const result = await chatValue<SendResult>(sql`
    SELECT app_private.chat_send_message(
      ${input.channelId}::uuid, ${user.id}::uuid, ${body}, ${input.clientId ?? null},
      ${input.threadRootSeq ?? null}::bigint, ${uuidArray(userIds)}, ${broadcast},
      ${jsonParam(attachments.map(({ idx: _idx, ...rest }) => rest))}, ${card ? jsonParam(card) : null}::jsonb
    ) AS value
  `);

  const message: ChatMessageView = {
    channel_id: input.channelId,
    seq: Number(result.channel_seq),
    author_id: user.id,
    author: authorFromUser(user),
    kind: "user",
    body,
    thread_root_seq: input.threadRootSeq ?? null,
    reply_count: 0,
    last_reply_seq: null,
    last_reply_at: null,
    edited_at: null,
    deleted_at: null,
    created_at: result.created_at,
    client_message_id: input.clientId ?? null,
    attachments,
    reactions: [],
    card,
    pinned: false,
  };

  if (!result.deduped) {
    const channelName = result.channel_kind === "dm" ? null : await chatValue<string | null>(sql`
      SELECT name AS value FROM chat_channels WHERE id = ${input.channelId}::uuid
    `);
    publishSentMessage({ message, notify: result.notify ?? [], mentioned: userIds, channelName });
  }
  return { success: true as const, message };
}

export async function sendMessage(input: SendInput) {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  if (!isUuid(input?.channelId) || typeof input.body !== "string" || input.body.length > CHAT_MAX_BODY) return invalidInput;
  if (input.clientId != null && (typeof input.clientId !== "string" || input.clientId.length > 160)) return invalidInput;
  if (!takeSendToken(user.id)) return { success: false as const, error: "chat_rate_limited" };
  try {
    return await send(user, input, null);
  } catch (error) {
    return chatFailure(error, "send");
  }
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
    return await send(user, { channelId: input.channelId, body: "", threadRootSeq: input.threadRootSeq }, { kind: "task", ref_id: created.task.id });
  } catch (error) {
    return chatFailure(error, "create_task");
  }
}

export async function editMessage(input: { channelId: string; seq: number; body: string }) {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  if (!isUuid(input?.channelId) || !Number.isInteger(input.seq) || typeof input.body !== "string") return invalidInput;
  try {
    await chatRows(sql`SELECT app_private.chat_edit_message(${input.channelId}::uuid, ${input.seq}::bigint, ${user.id}::uuid, ${input.body})`);
    publishChannel(input.channelId, "message.edit", { channel_id: input.channelId, seq: input.seq, body: input.body, edited_at: new Date().toISOString() });
    return { success: true as const };
  } catch (error) {
    return chatFailure(error, "edit");
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

export async function listThread(input: { channelId: string; rootSeq: number }) {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  if (!isUuid(input?.channelId) || !Number.isInteger(input.rootSeq)) return invalidInput;
  try {
    const rows = await selectMessages(
      user.id, input.channelId,
      sql`(m.channel_seq = ${input.rootSeq} OR m.thread_root_seq = ${input.rootSeq})`,
      sql`m.channel_seq ASC`, 500,
    );
    const cards = await hydrateCards(user.id, rows.flatMap((message) => (message.card ? [message.card] : [])));
    return { success: true as const, root: rows[0] ?? null, replies: rows.slice(1), cards };
  } catch (error) {
    return chatFailure(error, "thread");
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

import "server-only";

import { sql } from "drizzle-orm";

import { CHAT_MAX_ATTACHMENTS, CHAT_MAX_BODY } from "@/lib/messaging/constants";
import { selectMessages } from "@/lib/messaging/queries";
import { isMessageSeq } from "@/lib/messaging/routes";
import { normalizeMediaDimensions } from "@/lib/messaging/media-metadata";
import { publishSentMessage } from "@/lib/messaging/publish";
import { chatRows, chatValue, isUuid, jsonParam, uuidArray } from "@/lib/messaging/server";
import { parseMentions } from "@/lib/messaging/tokens";
import type { ChatAttachmentView, ChatCardRef, ChatMessageView, ChatPerson } from "@/lib/messaging/types";

export type SendInput = {
  channelId: string;
  body: string;
  clientId?: string | null;
  threadRootSeq?: number | null;
  assetIds?: string[];
};

export type ChatSender = { id: string };

type SendResult = {
  channel_seq: number;
  created_at: string;
  deduped: boolean;
  notify?: string[];
  muted?: string[];
  follows?: string[];
  channel_kind?: string;
};

// The author comes from profiles, like every message the timeline loads. Auth
// user_metadata holds the sign-in provider's picture (e.g. Google), not the profile photo.
// Where it was sent (for push titles: "#design", a group's name, nothing for a DM) rides along,
// so a send costs no extra roundtrip (ACT-02).
async function authorAndChannel(userId: string, channelId: string) {
  const [row] = await chatRows<{ author: ChatPerson | null; channel_label: string | null }>(sql`
    SELECT (SELECT jsonb_build_object('id', id, 'username', username, 'full_name', full_name, 'avatar_url', avatar_url)
              FROM profiles WHERE id = ${userId}::uuid) AS author,
           (SELECT CASE WHEN name IS NOT NULL THEN '#' || name WHEN kind = 'dm' OR application_id IS NOT NULL THEN NULL ELSE coalesce(title, 'a group chat') END
              FROM chat_channels WHERE id = ${channelId}::uuid) AS channel_label
  `);
  return row ?? { author: null, channel_label: null };
}

/**
 * Append a message as `user` and publish it. Permissions are enforced by
 * chat_send_message; callers validate input and rate limits. Server-only: the
 * actions, the scheduled-send job and sharing call it, the browser never does.
 */
export async function sendAs(user: ChatSender, input: SendInput, card: ChatCardRef | null) {
  if (!isUuid(input.channelId) || typeof input.body !== "string" || input.body.length > CHAT_MAX_BODY
    || (input.clientId != null && (typeof input.clientId !== "string" || input.clientId.length > 160))
    || (input.threadRootSeq != null && !isMessageSeq(input.threadRootSeq))
    || (input.assetIds !== undefined && (!Array.isArray(input.assetIds) || input.assetIds.some((id) => !isUuid(id))))) {
    return { success: false as const, error: "chat_invalid_input" };
  }
  const body = input.body;
  const assetIds = input.assetIds ?? [];
  if (assetIds.length > CHAT_MAX_ATTACHMENTS) return { success: false as const, error: "chat_too_many_attachments" };
  if (new Set(assetIds).size !== assetIds.length) return { success: false as const, error: "chat_invalid_input" };

  // Only the sender's own verified uploads can be attached; size and type come
  // from the verified asset, never from the client.
  let attachments: ChatAttachmentView[] = [];
  if (assetIds.length > 0) {
    const assets = await chatRows<{ id: string; mime: string; size: number; name: string; width: string | null; height: string | null }>(sql`
      SELECT id, coalesce(verified_mime_type, declared_mime_type) AS mime, coalesce(verified_size, declared_size)::bigint AS size,
             coalesce(metadata->>'filename', '') AS name, metadata->>'width' AS width, metadata->>'height' AS height
      FROM storage_assets
      WHERE id = ANY(${uuidArray(assetIds)}) AND owner_user_id = ${user.id}::uuid AND state = 'verified' AND bucket = 'chat-attachments'
    `);
    if (assets.length !== assetIds.length) return { success: false as const, error: "chat_attachment_not_ready" };
    attachments = assetIds.map((id, idx) => {
      const asset = assets.find((row) => row.id === id)!;
      const dimensions = /^(image|video)\//.test(asset.mime) ? normalizeMediaDimensions(asset.width, asset.height) : null;
      return { idx, asset_id: id, name: asset.name, mime: asset.mime, size: Number(asset.size), width: dimensions?.width ?? null, height: dimensions?.height ?? null };
    });
  }

  const { userIds, broadcast } = parseMentions(body);
  const [result, { author, channel_label: channelLabel }] = await Promise.all([chatValue<SendResult>(sql`
    SELECT app_private.chat_send_message(
      ${input.channelId}::uuid, ${user.id}::uuid, ${body}, ${input.clientId ?? null},
      ${input.threadRootSeq ?? null}::bigint, ${uuidArray(userIds)}, ${broadcast},
      ${jsonParam(attachments.map(({ idx: _idx, ...rest }) => rest))}, ${card ? jsonParam(card) : null}::jsonb
    ) AS value
  `), authorAndChannel(user.id, input.channelId)]);

  if (result.deduped) {
    const [message] = await selectMessages(user.id, input.channelId, sql`m.channel_seq = ${result.channel_seq}`, sql`m.channel_seq ASC`, 1);
    if (!message) return { success: false as const, error: "chat_message_not_found" };
    return { success: true as const, message };
  }

  const message: ChatMessageView = {
    channel_id: input.channelId,
    seq: Number(result.channel_seq),
    author_id: user.id,
    author: author ?? { id: user.id, username: null, full_name: null, avatar_url: null },
    kind: "user",
    body,
    thread_root_seq: input.threadRootSeq ?? null,
    reply_count: 0,
    last_reply_seq: null,
    last_reply_at: null,
    edited_at: null,
    deleted_at: null,
    created_at: new Date(result.created_at).toISOString(),
    client_message_id: input.clientId ?? null,
    attachments,
    reactions: [],
    card,
    pinned: false,
  };

  if (!result.deduped) {
    publishSentMessage({ message, notify: result.notify ?? [], muted: result.muted, follows: result.follows, mentioned: userIds, channelLabel });
  }
  return { success: true as const, message };
}

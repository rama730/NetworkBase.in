import "server-only";

import { sql } from "drizzle-orm";

import { CHAT_MAX_ATTACHMENTS } from "@/lib/messaging/constants";
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
  const [result, { author, channel_label: channelLabel }] = await Promise.all([chatValue<SendResult>(sql`
    SELECT app_private.chat_send_message(
      ${input.channelId}::uuid, ${user.id}::uuid, ${body}, ${input.clientId ?? null},
      ${input.threadRootSeq ?? null}::bigint, ${uuidArray(userIds)}, ${broadcast},
      ${jsonParam(attachments.map(({ idx: _idx, ...rest }) => rest))}, ${card ? jsonParam(card) : null}::jsonb
    ) AS value
  `), authorAndChannel(user.id, input.channelId)]);

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
    created_at: result.created_at,
    client_message_id: input.clientId ?? null,
    attachments,
    reactions: [],
    card,
    pinned: false,
  };

  if (!result.deduped) {
    publishSentMessage({ message, notify: result.notify ?? [], mentioned: userIds, channelLabel });
  }
  return { success: true as const, message };
}

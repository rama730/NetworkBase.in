import "server-only";

import { sql } from "drizzle-orm";

import { listTopLevel } from "@/lib/messaging/queries";
import { sendAs } from "@/lib/messaging/send";
import { takeSendToken } from "@/lib/messaging/send-bucket";
import { chatRows, chatValue, uuidArray } from "@/lib/messaging/server";
import { encodeMentions, parseMentions, previewText, tokensToPlainText } from "@/lib/messaging/tokens";
import { withBlockState } from "@/lib/messaging/shell-state";
import type { ChatBootstrap, ChatChannelSummary } from "@/lib/messaging/types";

/**
 * Messages for tokens (report C4, nb message): the same SQL functions the app uses, so permissions, blocks and
 * read markers behave exactly as in the browser. Bodies go out as plain text, with mentions as @handle.
 */
export type Conversation = {
  id: string;
  kind: "channel" | "dm" | "group";
  /** "#design", "@sam" or a group's title: what `nb message read` takes. */
  label: string;
  workspace: string | null;
  workspaceId: string | null;
  unread: number;
  mentions: number;
  lastAt: string | null;
  lastPreview: string | null;
  canReply: boolean;
};

const kindOf = (c: ChatChannelSummary): Conversation["kind"] => (c.name ? "channel" : c.kind === "dm" ? "dm" : "group");

function labelOf(c: ChatChannelSummary) {
  if (c.name) return `#${c.name}`;
  if (c.kind === "dm") return c.dm_user ? `@${c.dm_user.username ?? c.dm_user.full_name ?? "someone"}` : "@you";
  return c.title ?? (c.members_preview ?? []).map((p) => p.username ?? p.full_name).filter(Boolean).slice(0, 3).join(", ") ?? "a group chat";
}

export async function listConversations(userId: string): Promise<Conversation[]> {
  const data = await chatValue<ChatBootstrap>(sql`SELECT app_private.chat_bootstrap(${userId}::uuid, ${null}::timestamptz) AS value`);
  const workspaces = new Map((data.projects ?? []).map((p) => [p.id, p.slug ?? p.title]));
  const blocks = await chatRows<{ blocker_id: string; blocked_id: string }>(sql`
    SELECT blocker_id, blocked_id FROM user_blocks WHERE blocker_id = ${userId}::uuid OR blocked_id = ${userId}::uuid
  `);
  // Across a block (either way) a DM or two-person group takes no replies, as in the app (B44).
  return withBlockState(data.channels, userId, blocks)
    // Application threads belong to the hiring screens; archived ones stay in the app.
    .filter((c) => !c.application_id && !c.archived_at && !c.channel_archived_at)
    .map((c) => ({
      id: c.id,
      kind: kindOf(c),
      label: labelOf(c),
      workspace: c.project_id ? workspaces.get(c.project_id) ?? null : null,
      workspaceId: c.project_id,
      unread: Math.max(0, c.last_top_seq - c.last_read_seq),
      mentions: c.mention_count ?? 0,
      lastAt: c.last_message_at,
      lastPreview: c.last_preview ? previewText(c.last_preview).slice(0, 140) : null,
      canReply: !c.reply_closed,
    }))
    .sort((a, b) => (b.lastAt ?? "").localeCompare(a.lastAt ?? ""));
}

/** Handles for the ids a body mentions, in one query. */
async function handles(ids: string[]) {
  if (!ids.length) return new Map<string, string>();
  const rows = await chatRows<{ id: string; handle: string }>(sql`
    SELECT id, coalesce(username, full_name, 'someone') AS handle FROM profiles WHERE id = ANY(${uuidArray(ids)})
  `);
  return new Map(rows.map((r) => [r.id, r.handle]));
}


/** The latest messages in a conversation (or before a message), oldest first, as plain text. */
export async function readConversation(userId: string, channelId: string, before?: number) {
  const [messages, hidden] = await Promise.all([
    listTopLevel(userId, channelId, before ? { before } : {}),
    // People the viewer blocked or muted fold away, as in the app (B23, B26).
    chatRows<{ id: string }>(sql`
      SELECT blocked_id AS id FROM user_blocks WHERE blocker_id = ${userId}::uuid
      UNION SELECT muted_id FROM user_mutes WHERE muter_id = ${userId}::uuid
    `),
  ]);
  const folded = new Set(hidden.map((h) => h.id));
  const names = await handles([...new Set(messages.flatMap((m) => parseMentions(m.body).userIds))]);
  return messages.filter((m) => !m.deleted_at).map((m) => ({
    seq: m.seq,
    at: m.created_at,
    author: m.author?.username ? `@${m.author.username}` : m.author?.full_name ?? (m.kind === "system" ? "NetworkBase" : "someone"),
    text: m.author_id && folded.has(m.author_id) ? "(hidden: someone you blocked or muted)" : tokensToPlainText(m.body, (id) => names.get(id)),
    replies: m.reply_count,
    edited: Boolean(m.edited_at),
    files: m.attachments.map((a) => a.name),
  }));
}

/** Moves the read marker forward, as opening the conversation in the app does. */
export async function markConversationRead(userId: string, channelId: string, seq: number) {
  return chatValue<boolean>(sql`SELECT app_private.chat_mark_read(${channelId}::uuid, ${userId}::uuid, ${seq}::bigint) AS value`);
}

/** Sends as the person: @handles of the conversation's members become mentions; others stay plain text. */
export async function sendToConversation(userId: string, input: { channelId: string; text: string; replyTo?: number | null; clientId?: string | null }) {
  if (!takeSendToken(userId)) return { success: false as const, error: "chat_rate_limited" };
  const asked = [...new Set([...input.text.matchAll(/(?:^|\s)@([A-Za-z0-9_.-]{2,40})/g)].map((m) => m[1]!.toLowerCase()))].slice(0, 20);
  const people = asked.length
    ? await chatRows<{ id: string; name: string }>(sql`
        SELECT p.id, p.username AS name FROM chat_channel_members m JOIN profiles p ON p.id = m.user_id
        WHERE m.channel_id = ${input.channelId}::uuid AND lower(p.username) = ANY(${`{${asked.join(",")}}`}::text[])
      `)
    : [];
  const body = encodeMentions(input.text, people, { broadcast: false });
  return sendAs({ id: userId }, { channelId: input.channelId, body, threadRootSeq: input.replyTo ?? null, clientId: input.clientId ?? null }, null);
}

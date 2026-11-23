"use server";

import { sql } from "drizzle-orm";

import { createTaskAction } from "@/app/actions/workspace";
import { hydrateCards } from "@/lib/messaging/cards";
import { CHAT_MAX_BODY } from "@/lib/messaging/constants";
import { publishChannel, publishUser, publishUsers } from "@/lib/messaging/publish";
import { listTopLevel, selectMessages } from "@/lib/messaging/queries";
import { takeReactToken, takeSendToken } from "@/lib/messaging/send-bucket";
import { sendAs, type SendInput } from "@/lib/messaging/send";
import { chatFailure, chatRows, chatValue, invalidInput, isUuid, requireChatUser, unauthorized, uuidArray } from "@/lib/messaging/server";
import { parseMentions, previewText, tokensToPlainText } from "@/lib/messaging/tokens";
import { isMessageSeq, messageHref } from "@/lib/messaging/routes";
import type { ChatCardRef } from "@/lib/messaging/types";
import { rateLimit } from "@/lib/redis";
import { countsOrNothing } from "@/lib/messaging/inbox-counts";
import { IdempotencyConflictError, runIdempotent } from "@/lib/security/idempotency";
import { createHash } from "node:crypto";

export async function sendMessage(input: SendInput & { alsoToChannel?: boolean }) {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  if (!isUuid(input?.channelId) || typeof input.body !== "string" || input.body.length > CHAT_MAX_BODY || (input.threadRootSeq != null && !isMessageSeq(input.threadRootSeq))) return invalidInput;
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
    // The copy's identity derives from the reply's, so a retry of the whole send finds the copy it
    // already made instead of posting another (COR-054).
    const copyClientId = input.clientId ? `also:${createHash("sha256").update(input.clientId).digest("hex")}` : null;
    const copy = await flattenMentions(input.body)
      .then((body) => sendAs(user, { channelId: input.channelId, body, assetIds: input.assetIds, clientId: copyClientId }, null))
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

/**
 * `/task Title`: create a task in the channel's project, then post its card. `operationId` (a uuid the
 * client keeps for one attempt) is the shared identity of both steps: the created task is remembered
 * under it and the card's clientId derives from it, so a retry resumes where the first try stopped
 * instead of creating a second task (COR-055).
 */
export async function createTaskFromMessage(input: { channelId: string; title: string; threadRootSeq?: number | null; operationId?: string }) {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  if (!isUuid(input?.channelId) || typeof input.title !== "string" || !input.title.trim() || (input.threadRootSeq != null && !isMessageSeq(input.threadRootSeq))) return invalidInput;
  if (input.operationId !== undefined && !isUuid(input.operationId)) return invalidInput;
  if (!takeSendToken(user.id)) return { success: false as const, error: "chat_rate_limited" };
  try {
    const projectId = await chatValue<string | null>(sql`
      SELECT workspace_id AS value FROM chat_channels
      WHERE id = ${input.channelId}::uuid AND app_private.chat_is_member(id, ${user.id}::uuid)
    `);
    if (!projectId) return { success: false as const, error: "chat_task_needs_project" };
    const { result: created } = await runIdempotent(
      { namespace: "chat.task-from-message", scopeId: `${user.id}:${input.channelId}`, key: input.operationId },
      async () => {
        const task = await createTaskAction({ projectId, title: input.title.trim().slice(0, 200), status: "todo", priority: "medium" });
        if (!task.success || !("task" in task) || !task.task) throw new TaskCreateFailed();
        return { taskId: task.task.id };
      },
    );
    return await sendAs(
      user,
      { channelId: input.channelId, body: "", threadRootSeq: input.threadRootSeq, clientId: input.operationId ? `task:${input.operationId}` : null },
      { kind: "task", ref_id: created.taskId },
    );
  } catch (error) {
    if (error instanceof TaskCreateFailed) return { success: false as const, error: "chat_task_create_failed" };
    if (error instanceof IdempotencyConflictError) return { success: false as const, error: "chat_task_in_progress" };
    return chatFailure(error, "create_task");
  }
}

class TaskCreateFailed extends Error {}

/**
 * Report 38.6 W10 (plan A2.3): Report as bug from a workspace channel message. The New module opens on Bug prefilled
 * from the message; this files what it sends at New, names the message's files under What happened?, links back to the
 * message, and posts the bug's card in the conversation (like Create task).
 * ponytail: files are named and reached through the link, not copied into the workspace's Files.
 */
export async function reportBugFromMessage(input: {
  channelId: string; seq: number; title: string; typeFields?: Record<string, unknown>; threadRootSeq?: number | null; operationId?: string;
  /** What else the New module carries; createTaskAction checks them like any report. */
  description?: string; attachmentNodeIds?: string[]; subtasks?: Array<{ title: string; completed: boolean }>;
}) {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  if (!isUuid(input?.channelId) || !isMessageSeq(input.seq) || typeof input.title !== "string" || !input.title.trim()) return invalidInput;
  if (input.typeFields !== undefined && (typeof input.typeFields !== "object" || input.typeFields === null || Array.isArray(input.typeFields))) return invalidInput;
  if ((input.threadRootSeq != null && !isMessageSeq(input.threadRootSeq)) || (input.operationId !== undefined && !isUuid(input.operationId))) return invalidInput;
  if (!takeSendToken(user.id)) return { success: false as const, error: "chat_rate_limited" };
  try {
    const projectId = await chatValue<string | null>(sql`
      SELECT workspace_id AS value FROM chat_channels
      WHERE id = ${input.channelId}::uuid AND app_private.chat_is_member(id, ${user.id}::uuid)
    `);
    if (!projectId) return { success: false as const, error: "chat_task_needs_project" };
    const found = await chatRows<{ thread_root_seq: number | null }>(sql`
      SELECT thread_root_seq::int AS thread_root_seq FROM chat_messages WHERE channel_id = ${input.channelId}::uuid AND channel_seq = ${input.seq} AND deleted_at IS NULL`);
    if (!found[0]) return { success: false as const, error: "chat_message_not_found" };
    const files = await chatRows<{ name: string }>(sql`
      SELECT coalesce(nullif(name, ''), 'file') AS name FROM chat_attachments
      WHERE channel_id = ${input.channelId}::uuid AND message_seq = ${input.seq} ORDER BY idx`);
    const { withFiles } = await import("@/lib/workflows/bugs");
    const { shareOrigin } = await import("@/lib/sharing/presentation");
    const link = `${shareOrigin()}${messageHref(input.channelId, input.seq, found[0].thread_root_seq)}`;
    const fields = { ...(input.typeFields ?? {}) };
    const steps = withFiles(typeof fields.steps === "string" ? fields.steps : "", files.map((f) => f.name));
    if (steps) fields.steps = steps; else delete fields.steps;
    const { result: created } = await runIdempotent(
      { namespace: "chat.bug-from-message", scopeId: `${user.id}:${input.channelId}`, key: input.operationId },
      async () => {
        const task = await createTaskAction({
          projectId, title: input.title.trim().slice(0, 200), status: "todo", priority: "medium", itemType: "bug", stage: "new", typeFields: fields,
          ...(input.description ? { description: input.description } : {}), ...(input.attachmentNodeIds?.length ? { attachmentNodeIds: input.attachmentNodeIds } : {}),
          ...(input.subtasks?.length ? { subtasks: input.subtasks } : {}),
        } as Parameters<typeof createTaskAction>[0]);
        if (!task.success || !("task" in task) || !task.task) throw new BugCreateFailed(task.success ? "" : String(task.error ?? ""));
        const { db } = await import("@/lib/db");
        const { taskLinks } = await import("@/lib/db/schema");
        // Task links are https only (0087); a local http server keeps the bug without the link.
        if (link.startsWith("https://")) await db.insert(taskLinks).values({ taskId: task.task.id, url: link, title: "The message", kind: "link", createdBy: user.id }).onConflictDoNothing();
        return { taskId: task.task.id };
      },
    );
    const sent = await sendAs(
      user,
      { channelId: input.channelId, body: "", threadRootSeq: input.threadRootSeq, clientId: input.operationId ? `bug:${input.operationId}` : null },
      { kind: "task", ref_id: created.taskId },
    );
    return sent;
  } catch (error) {
    // The New module shows the server's own words (Bug has no field …, Check the bug's …); Bugs not added has its own.
    if (error instanceof BugCreateFailed) return { success: false as const, error: /isn’t in this workspace|was removed/.test(error.message) ? "chat_bugs_not_added" : "chat_bug_create_failed", message: error.message };
    if (error instanceof IdempotencyConflictError) return { success: false as const, error: "chat_task_in_progress" };
    return chatFailure(error, "report_bug");
  }
}

class BugCreateFailed extends Error {}

export async function editMessage(input: { channelId: string; seq: number; body: string }) {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  if (!isUuid(input?.channelId) || !isMessageSeq(input.seq) || typeof input.body !== "string") return invalidInput;
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
export async function hideLinkPreview(input: { channelId: string; seq: number; hidden?: boolean }) {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  if (!isUuid(input?.channelId) || !isMessageSeq(input.seq) || (input.hidden !== undefined && typeof input.hidden !== 'boolean')) return invalidInput;
  try {
    const rows = await chatRows<{ channel_seq: number }>(sql`
      UPDATE chat_messages SET link_preview_hidden = ${input.hidden ?? true}
      WHERE channel_id = ${input.channelId}::uuid AND channel_seq = ${input.seq} AND author_id = ${user.id}::uuid AND deleted_at IS NULL
        -- Same rule as editing: a current member, in a live channel (DB-002).
        AND app_private.chat_is_member(${input.channelId}::uuid, ${user.id}::uuid)
        AND EXISTS (SELECT 1 FROM chat_channels c WHERE c.id = ${input.channelId}::uuid AND c.archived_at IS NULL)
      RETURNING channel_seq
    `);
    if (!rows.length) return { success: false as const, error: "chat_not_editable" };
    publishChannel(input.channelId, "message.preview_hidden", { channel_id: input.channelId, seq: input.seq, hidden: input.hidden ?? true });
    return { success: true as const };
  } catch (error) {
    return chatFailure(error, "hide_preview");
  }
}

export async function deleteMessage(input: { channelId: string; seq: number }) {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  if (!isUuid(input?.channelId) || !isMessageSeq(input.seq)) return invalidInput;
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
  if (!isUuid(input?.channelId) || (input.before !== undefined && !isMessageSeq(input.before)) || (input.around !== undefined && !isMessageSeq(input.around))) return invalidInput;
  try {
    const messages = await listTopLevel(user.id, input.channelId, { before: input.before, around: input.around });
    const cards = await hydrateCards(user.id, messages.flatMap((message) => (message.card ? [message.card] : [])));
    return { success: true as const, messages, cards };
  } catch (error) {
    return chatFailure(error, "list");
  }
}

/** Message-location lookup uses exactly the same read authorization as the timeline. */
export async function resolveMessageTarget(input: { channelId: string; seq: number }) {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  if (!isUuid(input?.channelId) || !isMessageSeq(input.seq)) return invalidInput;
  try {
    const [message] = await selectMessages(user.id, input.channelId, sql`m.channel_seq = ${input.seq} AND m.deleted_at IS NULL`, sql`m.channel_seq ASC`, 1);
    if (!message) return { success: false as const, error: "chat_message_not_found" };
    return { success: true as const, seq: message.seq, threadRootSeq: message.thread_root_seq };
  } catch (error) {
    return chatFailure(error, "resolve_target");
  }
}

/** Bounded thread windows, with explicit older/newer gaps and an authorized root. */
export async function listThread(input: { channelId: string; rootSeq: number; before?: number; after?: number; around?: number; limit?: number }) {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  if (!isUuid(input?.channelId) || !isMessageSeq(input.rootSeq)) return invalidInput;
  if ([input.before, input.after, input.around].some((seq) => seq !== undefined && !isMessageSeq(seq))) return invalidInput;
  if ([input.before, input.after, input.around].filter((seq) => seq !== undefined).length > 1) return invalidInput;
  const limit = Number.isInteger(input.limit) ? Math.min(Math.max(input.limit!, 1), THREAD_PAGE) : THREAD_PAGE;
  try {
    const base = sql`m.thread_root_seq = ${input.rootSeq}`;
    const around = input.around;
    const leftLimit = Math.ceil(limit / 2);
    const rightLimit = Math.floor(limit / 2);
    const [rootRows, left, right, [follow]] = await Promise.all([
      selectMessages(user.id, input.channelId, sql`m.channel_seq = ${input.rootSeq} AND m.thread_root_seq IS NULL`, sql`m.channel_seq ASC`, 1),
      around !== undefined
        ? selectMessages(user.id, input.channelId, sql`${base} AND m.channel_seq <= ${around}`, sql`m.channel_seq DESC`, leftLimit + 1)
        : selectMessages(user.id, input.channelId,
            input.before !== undefined ? sql`${base} AND m.channel_seq < ${input.before}`
              : input.after !== undefined ? sql`${base} AND m.channel_seq > ${input.after}` : base,
            input.after !== undefined ? sql`m.channel_seq ASC` : sql`m.channel_seq DESC`, limit + 1),
      around !== undefined
        ? selectMessages(user.id, input.channelId, sql`${base} AND m.channel_seq > ${around}`, sql`m.channel_seq ASC`, rightLimit + 1)
        : Promise.resolve([]),
      chatRows<{ last_read_seq: number }>(sql`
        SELECT last_read_seq::int FROM chat_thread_follows
        WHERE user_id = ${user.id}::uuid AND channel_id = ${input.channelId}::uuid AND root_seq = ${input.rootSeq}
      `),
    ]);
    const forward = input.after !== undefined;
    const replies = around !== undefined
      ? [...left.slice(0, leftLimit).reverse(), ...right.slice(0, rightLimit)]
      : forward ? left.slice(0, limit) : left.slice(0, limit).reverse();
    const root = rootRows[0] ?? null;
    const cards = await hydrateCards(user.id, [root, ...replies].flatMap((message) => message?.card ? [message.card] : []));
    return {
      success: true as const, root, replies, cards,
      hasOlder: around !== undefined ? left.length > leftLimit : !forward && left.length > limit,
      hasNewer: around !== undefined ? right.length > rightLimit : forward && left.length > limit,
      following: Boolean(follow), lastReadSeq: follow?.last_read_seq ?? null,
    };
  } catch (error) {
    return chatFailure(error, "thread");
  }
}

/** Follow or leave a thread (replies notify followers). */
export async function setThreadFollow(input: { channelId: string; rootSeq: number; on: boolean }) {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  if (!isUuid(input?.channelId) || !isMessageSeq(input.rootSeq)) return invalidInput;
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
  if (!isUuid(input?.channelId) || !isMessageSeq(input.seq) || input.seq < 1) return invalidInput;
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
  if (!isUuid(input?.channelId) || !isMessageSeq(input.seq)) return invalidInput;
  try {
    const rows = await chatRows<{ emoji: string; names: string[] }>(sql`
      -- Across a block the name is left out, never the reaction: the count stays honest (Blocking B20, B44).
      SELECT r.emoji, jsonb_agg(CASE WHEN r.user_id = ${user.id}::uuid THEN 'You'
               WHEN app_private.blocked_between(${user.id}::uuid, r.user_id) THEN 'Someone'
               ELSE coalesce(pr.full_name, pr.username, 'Someone') END ORDER BY r.created_at) AS names
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
  if (!isUuid(input?.channelId) || !isUuid(input.toChannelId) || !isMessageSeq(input.seq)) return invalidInput;
  if (input.note !== undefined && (typeof input.note !== "string" || input.note.length > 1000)) return invalidInput;
  if (!takeSendToken(user.id)) return { success: false as const, error: "chat_rate_limited" };
  try {
    const [source] = await chatRows<{ body: string; author: string | null; channel_name: string | null; thread_root_seq: number | null; private_thread: boolean }>(sql`
      SELECT m.body, m.thread_root_seq, coalesce(pr.full_name, pr.username) AS author, c.name AS channel_name, c.application_id IS NOT NULL AS private_thread
      FROM chat_messages m
      JOIN chat_channels c ON c.id = m.channel_id
      LEFT JOIN profiles pr ON pr.id = m.author_id
      WHERE m.channel_id = ${input.channelId}::uuid AND m.channel_seq = ${input.seq} AND m.deleted_at IS NULL
        AND app_private.chat_is_member(${input.channelId}::uuid, ${user.id}::uuid)
    `);
    if (!source) return { success: false as const, error: "chat_message_not_found" };
    // An application thread is private to the applicant and the reviewers: its text (the cover letter) is not quoted elsewhere.
    if (source.private_thread) return { success: false as const, error: "chat_share_not_allowed" };
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
  if (!isUuid(input?.refId) || !["application", "task", "invite", "announcement", "assignment"].includes(input.kind)) return invalidInput;
  const cards = await hydrateCards(user.id, [{ kind: input.kind, ref_id: input.refId }]);
  return { success: true as const, card: cards[`${input.kind}:${input.refId}`] };
}

// ponytail: reactions notify nobody (L-10). upgrade: an Activity row, not a tray row.
export async function react(input: { channelId: string; seq: number; emoji: string; on: boolean }) {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  if (!isUuid(input?.channelId) || !isMessageSeq(input.seq) || typeof input.emoji !== "string" || !input.emoji || input.emoji.length > 64) return invalidInput;
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
  if (!isUuid(input?.channelId) || !isMessageSeq(input.seq)) return invalidInput;
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

/** "Created from message" on a task: the chat messages whose task card points at it (viewer must be a member). */
export async function listTaskSourceMessages(input: { taskId: string }) {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  if (!isUuid(input?.taskId)) return invalidInput;
  try {
    const links = await chatRows<{ channel_id: string; seq: number; thread_root_seq: number | null; channel_name: string | null; preview: string | null }>(sql`
      SELECT c.channel_id, c.message_seq::int AS seq, m.thread_root_seq::int AS thread_root_seq, ch.name AS channel_name, left(m.body, 160) AS preview
      FROM chat_message_cards c
      JOIN chat_channels ch ON ch.id = c.channel_id
      JOIN chat_messages m ON m.channel_id = c.channel_id AND m.channel_seq = c.message_seq
      WHERE m.deleted_at IS NULL AND c.kind = 'task' AND c.ref_id = ${input.taskId}::uuid
        AND app_private.chat_is_member(c.channel_id, ${user.id}::uuid)
      LIMIT 5
    `);
    return { success: true as const, links: links.map((link) => ({ ...link, preview: previewText(link.preview ?? "") || "Task" })) };
  } catch (error) {
    return chatFailure(error, "task_source");
  }
}

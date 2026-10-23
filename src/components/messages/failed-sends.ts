"use client";

import type { InfiniteData, QueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/feedback";

import { sendMessage } from "@/app/actions/chat/messages";
import { chatErrorMessage } from "@/lib/messaging/errors";
import { keepLocalPreviews } from "@/lib/messaging/timeline";
import type { ChatMessageView } from "@/lib/messaging/types";
import { queryKeys } from "@/lib/query-keys";

// A send the server refused stays in the timeline ("Not sent · Retry · Delete").
// What it needs to try again lives here, by client id, and in sessionStorage so a
// reload keeps it (the uploaded files are already on the server; only ids are kept).
export type FailedSend = { channelId: string; threadRootSeq: number | null; body: string; assetIds: string[]; alsoToChannel: boolean };
type Stored = { clientId: string; payload: FailedSend; message: ChatMessageView };

const STORE = "nb_chat_failed_sends";
const failed = new Map<string, FailedSend>();

function readStore(): Stored[] {
  try {
    const list = JSON.parse(sessionStorage.getItem(STORE) ?? "[]");
    return Array.isArray(list) ? list.filter((entry) => entry && typeof entry.clientId === "string"
      && entry.payload && typeof entry.payload.channelId === "string" && typeof entry.payload.body === "string"
      && Array.isArray(entry.payload.assetIds) && entry.message && typeof entry.message.body === "string"
      && Array.isArray(entry.message.attachments) && Array.isArray(entry.message.reactions)) : [];
  } catch {
    return [];
  }
}

function writeStore(list: Stored[]) {
  try {
    if (list.length) sessionStorage.setItem(STORE, JSON.stringify(list.slice(-20)));
    else sessionStorage.removeItem(STORE);
  } catch {
    // Storage full or blocked: Retry still works until the page closes.
  }
}

function forget(clientId: string) {
  failed.delete(clientId);
  const list = readStore();
  if (list.some((entry) => entry.clientId === clientId)) writeStore(list.filter((entry) => entry.clientId !== clientId));
}

export function rememberFailed(clientId: string, payload: FailedSend) {
  failed.set(clientId, payload);
}

export function failedSend(clientId: string | null) {
  return clientId ? failed.get(clientId) ?? null : null;
}

/** Failed sends kept from before a reload, for one conversation (or one thread). */
export function storedFailedSends(channelId: string, threadRootSeq: number | null, authorId: string | null) {
  return readStore().filter((entry) => {
    if (!authorId || entry.message.author_id !== authorId) return false;
    if (entry.payload.channelId !== channelId || entry.payload.threadRootSeq !== threadRootSeq) return false;
    failed.set(entry.clientId, entry.payload);
    return true;
  }).map((entry) => entry.message);
}

/**
 * Map the messages of a conversation's timeline, or of a thread when `threadRootSeq` is set.
 * False when that timeline isn't loaded (nothing on screen to show the change).
 */
export function patchSent(queryClient: QueryClient, channelId: string, threadRootSeq: number | null, map: (messages: ChatMessageView[]) => ChatMessageView[]) {
  let found = false;
  if (threadRootSeq) {
    queryClient.setQueryData<{ replies: ChatMessageView[] }>(queryKeys.chat.thread(channelId, threadRootSeq), (t) => {
      found = Boolean(t);
      return t ? { ...t, replies: map(t.replies) } : t;
    });
    return found;
  }
  queryClient.setQueryData<InfiniteData<ChatMessageView[], number | null>>(queryKeys.chat.messages(channelId), (prev) => {
    found = Boolean(prev);
    return prev ? { ...prev, pages: prev.pages.map(map) } : prev;
  });
  return found;
}

function findSent(queryClient: QueryClient, channelId: string, threadRootSeq: number | null, clientId: string) {
  const messages = threadRootSeq
    ? queryClient.getQueryData<{ replies: ChatMessageView[] }>(queryKeys.chat.thread(channelId, threadRootSeq))?.replies
    : queryClient.getQueryData<InfiniteData<ChatMessageView[], number | null>>(queryKeys.chat.messages(channelId))?.pages.flat();
  return messages?.find((m) => m.client_message_id === clientId) ?? null;
}

const mark = (clientId: string, patch: Partial<ChatMessageView>) => (messages: ChatMessageView[]) =>
  messages.map((m) => (m.client_message_id === clientId ? { ...m, ...patch } : m));

/**
 * Mark an optimistic send as failed and keep its payload for Retry (across a reload too).
 * False when it isn't on screen: the caller puts the text back in the box instead.
 */
export function failSend(queryClient: QueryClient, clientId: string, payload: FailedSend) {
  rememberFailed(clientId, payload);
  const shown = patchSent(queryClient, payload.channelId, payload.threadRootSeq, mark(clientId, { failed: true }));
  const message = findSent(queryClient, payload.channelId, payload.threadRootSeq, clientId);
  if (shown && message) {
    // Local previews (blob: URLs) die with the page; the server copy of each file stays.
    const kept = { ...message, attachments: message.attachments.map(({ local_url: _local, ...rest }) => rest) };
    writeStore([...readStore().filter((entry) => entry.clientId !== clientId), { clientId, payload, message: kept }]);
  }
  return shown;
}

/** Retry with the same client id (the server dedupes it if the first try did land). */
export async function retrySend(queryClient: QueryClient, clientId: string, options: { quiet?: boolean } = {}) {
  const payload = failed.get(clientId);
  if (!payload) return;
  patchSent(queryClient, payload.channelId, payload.threadRootSeq, mark(clientId, { failed: false }));
  const result = await sendMessage({
    channelId: payload.channelId, body: payload.body, clientId, threadRootSeq: payload.threadRootSeq,
    assetIds: payload.assetIds, alsoToChannel: payload.alsoToChannel,
  }).catch(() => ({ success: false as const, error: "chat_network" }));
  if (!result.success) {
    patchSent(queryClient, payload.channelId, payload.threadRootSeq, mark(clientId, { failed: true }));
    if (!options.quiet) toast.error(chatErrorMessage(result.error));
    return;
  }
  forget(clientId);
  patchSent(queryClient, payload.channelId, payload.threadRootSeq, (messages) => messages.map((m) => (m.client_message_id === clientId ? keepLocalPreviews(result.message, m) : m)));
}

/** Back online: try every failed send of this page again, once each (the server dedupes by client id). */
export function retryAllFailed(queryClient: QueryClient) {
  for (const clientId of [...failed.keys()]) void retrySend(queryClient, clientId, { quiet: true });
}

// "Edit" on a failed send: its text goes back into the matching composer (same draft key).
export const LOAD_DRAFT_EVENT = "chat-load-draft";
export type LoadDraftDetail = { draftKey: string; body: string };

/** Put a failed send's text back in its composer and drop it from the timeline. */
export function editFailedSend(queryClient: QueryClient, clientId: string, channelId: string, threadRootSeq: number | null, body: string) {
  const draftKey = threadRootSeq ? `${channelId}:${threadRootSeq}` : channelId;
  window.dispatchEvent(new CustomEvent<LoadDraftDetail>(LOAD_DRAFT_EVENT, { detail: { draftKey, body } }));
  discardSend(queryClient, clientId, channelId, threadRootSeq);
}

/** Drop a failed send from the timeline. */
export function discardSend(queryClient: QueryClient, clientId: string, channelId: string, threadRootSeq: number | null) {
  forget(clientId);
  patchSent(queryClient, channelId, threadRootSeq, (messages) => messages.filter((m) => m.client_message_id !== clientId));
}

/** Failed sends belong to the account that authored them. */
export function clearFailedSends() {
  failed.clear();
  try { sessionStorage.removeItem(STORE); } catch { /* Storage can be disabled. */ }
}

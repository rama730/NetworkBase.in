"use client";

import type { InfiniteData, QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { sendMessage } from "@/app/actions/chat/messages";
import { chatErrorMessage } from "@/lib/messaging/errors";
import type { ChatMessageView } from "@/lib/messaging/types";
import { queryKeys } from "@/lib/query-keys";

// A send the server refused stays in the timeline ("Not sent · Retry · Delete").
// What it needs to try again lives here, by client id, for this page only.
export type FailedSend = { channelId: string; threadRootSeq: number | null; body: string; assetIds: string[]; alsoToChannel: boolean };

const failed = new Map<string, FailedSend>();

export function rememberFailed(clientId: string, payload: FailedSend) {
  failed.set(clientId, payload);
}

export function failedSend(clientId: string | null) {
  return clientId ? failed.get(clientId) ?? null : null;
}

/** Map the messages of a conversation's timeline, or of a thread when `threadRootSeq` is set. */
export function patchSent(queryClient: QueryClient, channelId: string, threadRootSeq: number | null, map: (messages: ChatMessageView[]) => ChatMessageView[]) {
  if (threadRootSeq) {
    queryClient.setQueryData<{ replies: ChatMessageView[] }>(queryKeys.chat.thread(channelId, threadRootSeq), (t) => (t ? { ...t, replies: map(t.replies) } : t));
    return;
  }
  queryClient.setQueryData<InfiniteData<ChatMessageView[], number | null>>(queryKeys.chat.messages(channelId), (prev) => (prev ? { ...prev, pages: prev.pages.map(map) } : prev));
}

const mark = (clientId: string, patch: Partial<ChatMessageView>) => (messages: ChatMessageView[]) =>
  messages.map((m) => (m.client_message_id === clientId ? { ...m, ...patch } : m));

/** Mark an optimistic send as failed and keep its payload for Retry. */
export function failSend(queryClient: QueryClient, clientId: string, payload: FailedSend) {
  rememberFailed(clientId, payload);
  patchSent(queryClient, payload.channelId, payload.threadRootSeq, mark(clientId, { failed: true }));
}

/** Retry with the same client id (the server dedupes it if the first try did land). */
export async function retrySend(queryClient: QueryClient, clientId: string) {
  const payload = failed.get(clientId);
  if (!payload) return;
  patchSent(queryClient, payload.channelId, payload.threadRootSeq, mark(clientId, { failed: false }));
  const result = await sendMessage({
    channelId: payload.channelId, body: payload.body, clientId, threadRootSeq: payload.threadRootSeq,
    assetIds: payload.assetIds, alsoToChannel: payload.alsoToChannel,
  }).catch(() => ({ success: false as const, error: "chat_network" }));
  if (!result.success) {
    patchSent(queryClient, payload.channelId, payload.threadRootSeq, mark(clientId, { failed: true }));
    toast.error(chatErrorMessage(result.error));
    return;
  }
  failed.delete(clientId);
  patchSent(queryClient, payload.channelId, payload.threadRootSeq, (messages) => messages.map((m) => (m.client_message_id === clientId ? result.message : m)));
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
  failed.delete(clientId);
  patchSent(queryClient, channelId, threadRootSeq, (messages) => messages.filter((m) => m.client_message_id !== clientId));
}

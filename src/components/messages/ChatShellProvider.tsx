"use client";

import { sameOriginPath } from "@/lib/messaging/safe-links";
import { evictCachedTimelines } from "@/lib/messaging/storage-cache";
import { useChatWindow } from "@/components/messages/chat-window-store";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";

import { bootstrap } from "@/app/actions/chat/read";
import { useAuth } from "@/hooks/useAuth";
import { CHAT_POLL_BASE_MS, CHAT_POLL_JITTER_MS, userTopic } from "@/lib/messaging/constants";
import { applyHint, applyInboxCounts, applyMentionCount, applyReadMoved, chatBadge, mergeDelta, type ChatHint, type InboxCounts } from "@/lib/messaging/shell-state";
import type { ChatBootstrap } from "@/lib/messaging/types";
import { invalidateLinkPreviewAccess } from "@/lib/links/client-preview-cache";
import { queryKeys } from "@/lib/query-keys";
import { subscribeBroadcast, type BroadcastStatus } from "@/lib/realtime/private-broadcast";
import { invalidatePrivacyDependents } from "@/lib/privacy/client-invalidation";
import { forgetOnDevice } from "@/lib/privacy/device-forget";
import { readShellPart } from "@/lib/shell-batch";
import { useDocumentTitlePrefix } from "@/hooks/useDocumentTitlePrefix";
import { clearFailedSends, retryAllFailed } from "@/components/messages/failed-sends";

type Snapshot = { data: ChatBootstrap };

export type ChatShell = {
  data: ChatBootstrap | undefined;
  badge: number;
  status: BroadcastStatus;
  /** The channel list could not be loaded (shown with a Retry). */
  loadError: string | null;
  /** Full reload of the channel list (membership changes, returning to the tab). */
  refresh: () => void;
  /** Move this tab's read cursor without waiting for the server echo. */
  applyRead: (channelId: string, seq: number) => void;
};

// A delta asks for changes since the last server_time minus this overlap, so a
// send that committed just after that snapshot is never missed.
const DELTA_OVERLAP_MS = 5_000;
// ponytail: one-release purge of the old chat's persisted stores (L-14).
// ceiling: runs once per tab load. upgrade: delete one release after cutover.
const LEGACY_STORAGE_KEYS = ["messages-v2-ui", "messages-v2-outbox"];

const ChatShellContext = createContext<ChatShell>({
  data: undefined,
  badge: 0,
  status: "connecting",
  loadError: null,
  refresh: () => undefined,
  applyRead: () => undefined,
});

async function load(since: string | null): Promise<Snapshot> {
  const result = since ? await bootstrap({ since }) : await readShellPart("chatSummary");
  if (!result?.success) {
    const code = result?.error ?? "chat_unavailable";
    console.error("[chat] conversations failed to load", code);
    throw new Error(code);
  }
  return { data: result.data };
}

/**
 * App-wide chat state: the bootstrap (every joined channel with unread state),
 * a 90 s ±30 s delta poll while the tab is visible (L-2), and the user's own
 * Realtime topic for hints, read sync across tabs, and membership changes.
 */
export function ChatShellProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const resetAccount = useCallback(() => {
    void queryClient.cancelQueries({ queryKey: queryKeys.sharing.root() });
    queryClient.removeQueries({ queryKey: queryKeys.sharing.root() });
    void queryClient.cancelQueries({ queryKey: queryKeys.sharing.linksRoot() });
    queryClient.removeQueries({ queryKey: queryKeys.sharing.linksRoot() });
    void queryClient.cancelQueries({ queryKey: queryKeys.chat.root() });
    queryClient.removeQueries({ queryKey: queryKeys.chat.root() });
    useChatWindow.getState().close();
    clearFailedSends();
  }, [queryClient]);
  const previousUser = useRef(userId);
  useEffect(() => {
    if (previousUser.current !== userId) {
      resetAccount();
      previousUser.current = userId;
    }
  }, [resetAccount, userId]);
  useEffect(() => {
    window.addEventListener("auth:signout", resetAccount);
    return () => window.removeEventListener("auth:signout", resetAccount);
  }, [resetAccount]);
  const key = useMemo(() => queryKeys.chat.bootstrap(userId), [userId]);
  const [status, setStatus] = useState<BroadcastStatus>("connecting");
  const wasDisconnected = useRef(false);

  const query = useQuery({
    queryKey: key,
    enabled: Boolean(userId),
    queryFn: async (): Promise<Snapshot> => {
      return load(null);
    },
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: key });
  }, [key, queryClient]);

  const applyRead = useCallback((channelId: string, seq: number) => {
    queryClient.setQueryData<Snapshot>(key, (prev) => (prev ? { ...prev, data: applyReadMoved(prev.data, channelId, seq) } : prev));
    queryClient.setQueryData<any>(queryKeys.chat.channel(channelId), (prev: any) =>
      prev && seq > (prev.last_read_seq ?? 0) ? { ...prev, last_read_seq: seq, mention_count: 0 } : prev
    );
  }, [key, queryClient]);

  const pollDelta = useCallback(async () => {
    const current = queryClient.getQueryData<Snapshot>(key);
    if (!current) return refresh();
    const since = new Date(Date.parse(current.data.server_time) - DELTA_OVERLAP_MS).toISOString();
    try {
      const next = await load(since);
      queryClient.setQueryData<Snapshot>(key, (prev) => (prev ? { data: mergeDelta(prev.data, next.data) } : prev));
    } catch {
      // The next tick retries; a failed background poll never surfaces.
    }
  }, [key, queryClient, refresh]);

  // Back online: sends that failed while offline go out by themselves.
  useEffect(() => {
    const onOnline = () => retryAllFailed(queryClient);
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [queryClient]);

  useEffect(() => {
    try {
      evictCachedTimelines(window.localStorage);
      evictCachedTimelines(window.sessionStorage);
      LEGACY_STORAGE_KEYS.forEach((name) => window.localStorage.removeItem(name));
    } catch {
      // Storage blocked: nothing to purge.
    }
  }, []);

  useEffect(() => {
    if (!userId) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      if (document.visibilityState !== "visible") return;
      const delay = CHAT_POLL_BASE_MS + (Math.random() * 2 - 1) * CHAT_POLL_JITTER_MS;
      timer = setTimeout(() => void pollDelta().finally(schedule), delay);
    };
    const onReturn = () => {
      if (document.visibilityState !== "visible") return schedule();
      refresh();
      schedule();
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) onReturn();
    };
    schedule();
    document.addEventListener("visibilitychange", onReturn);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("online", onReturn);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onReturn);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("online", onReturn);
    };
  }, [pollDelta, refresh, userId]);

  useEffect(() => {
    if (!userId) return;
    const subscription = subscribeBroadcast(
      userTopic(userId),
      (event, payload) => {
        if (event === "share.preview_changed") {
          if (typeof payload.resource_key === "string" && /^[a-f\d]{64}$/.test(payload.resource_key)) void invalidateLinkPreviewAccess(queryClient, payload.resource_key);
          return;
        }
        if (event === "membership.changed") {
          void invalidateLinkPreviewAccess(queryClient);
          return refresh();
        }
        // A block or unblock involving this person (Blocking B11, B35): every screen refetches, and what this device
        // kept about the other person goes. The event never says who blocked whom.
        if (event === "relationship") {
          const other = typeof payload.userId === "string" ? payload.userId : null;
          void invalidatePrivacyDependents(queryClient);
          if (other) {
            window.dispatchEvent(new CustomEvent("nb:relationship-changed", { detail: { userId: other } }));
            void forgetOnDevice(other);
          }
          // Every chat query: the list, the open conversation's header and composer, member tags, folded messages.
          return void queryClient.invalidateQueries({ queryKey: queryKeys.chat.root() });
        }
        const current = queryClient.getQueryData<Snapshot>(key);
        if (!current) return;
        if (event === "hint") {
          const hint = payload as unknown as ChatHint;
          // The open Inbox list (and followed threads) pick up a new mention or reply; plain DMs aren't in them.
          if (hint.mention || hint.thread_root_seq !== null) {
            void queryClient.invalidateQueries({ queryKey: ["chat-v3", "inbox"] });
            void queryClient.invalidateQueries({ queryKey: queryKeys.chat.threads() });
          }
          const next = applyHint(current.data, hint);
          if (!next) return void pollDelta();
          if (next !== current.data) queryClient.setQueryData<Snapshot>(key, { ...current, data: next });
          // The Threads count is per thread, not per reply: only the server knows if this one was already unread.
          if (hint.follows && hint.thread_root_seq !== null) void pollDelta();
        } else if (event === "read.moved" && typeof payload.channel_id === "string" && typeof payload.seq === "number") {
          // Reads carry the fresh Inbox counts, so the badge, the Inbox row and the tab title drop together.
          const moved = applyReadMoved(current.data, payload.channel_id, payload.seq);
          queryClient.setQueryData<Snapshot>(key, { ...current, data: applyInboxCounts(moved, payload as InboxCounts) });
          queryClient.setQueryData<any>(queryKeys.chat.channel(payload.channel_id), (prev: any) =>
            prev && (payload.seq as number) > (prev.last_read_seq ?? 0) ? { ...prev, last_read_seq: payload.seq, mention_count: 0 } : prev
          );
        } else if (event === "inbox.count") {
          let data = applyInboxCounts(current.data, payload as InboxCounts);
          if (typeof payload.channel_id === "string" && typeof payload.mention_count === "number") {
            data = applyMentionCount(data, payload.channel_id, payload.mention_count);
          }
          queryClient.setQueryData<Snapshot>(key, { ...current, data });
          void queryClient.invalidateQueries({ queryKey: queryKeys.chat.threads() });
        }
      },
      (next) => {
        setStatus(next);
        // Hints sent while disconnected are lost; catch up once rejoined.
        if (next === "disconnected") wasDisconnected.current = true;
        if (next === "connected" && wasDisconnected.current) {
          wasDisconnected.current = false;
          void pollDelta();
        }
      },
    );
    return subscription.unsubscribe;
  }, [key, pollDelta, queryClient, refresh, userId]);

  const data = userId ? query.data?.data : undefined;
  const badge = useMemo(() => chatBadge(data), [data]);
  const router = useRouter();
  // A notification click asks this tab to route in-app instead of reloading (public/sw.js).
  useEffect(() => {
    const worker = typeof navigator === "undefined" ? undefined : navigator.serviceWorker;
    if (!worker) return;
    const onMessage = (event: MessageEvent) => {
      const message = event.data as { type?: string; href?: unknown } | null;
      if (message?.type !== "nb:navigate" || typeof message.href !== "string" || !message.href.startsWith("/") || message.href.startsWith("//")) return;
      const path = sameOriginPath(message.href, window.location.origin);
      if (!path) return;
      router.push(path);
      event.ports[0]?.postMessage("ok");
    };
    worker.addEventListener("message", onMessage);
    return () => worker.removeEventListener("message", onMessage);
  }, [router]);
  // The tab title carries the same count as the Messages badge: "(3) Discover".
  useDocumentTitlePrefix(badge ? `(${badge > 99 ? "99+" : badge})` : null, " ");
  const loadError = userId && query.isError && !data ? query.error.message : null;
  const shell = useMemo<ChatShell>(
    () => ({ data, badge, status, loadError, refresh, applyRead }),
    [applyRead, badge, data, loadError, refresh, status],
  );

  return (
    <ChatShellContext.Provider value={shell}>{children}</ChatShellContext.Provider>
  );
}

export function useChatShell() {
  return useContext(ChatShellContext);
}

/** People the viewer blocked (Blocking B23, B34): one stable set, new only when the list itself changes. */
export function useBlockedIds(): ReadonlySet<string> {
  const key = useChatShell().data?.blocked_ids?.join(",") ?? "";
  return useMemo(() => new Set(key ? key.split(",") : []), [key]);
}

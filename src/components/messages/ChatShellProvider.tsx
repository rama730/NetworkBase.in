"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";

import { bootstrap } from "@/app/actions/chat/read";
import { useAuth } from "@/hooks/useAuth";
import { CHAT_POLL_BASE_MS, CHAT_POLL_JITTER_MS, userTopic } from "@/lib/messaging/constants";
import { applyHint, applyInboxCounts, applyReadMoved, chatBadge, mergeDelta, type ChatHint, type InboxCounts } from "@/lib/messaging/shell-state";
import type { ChatBootstrap } from "@/lib/messaging/types";
import { queryKeys } from "@/lib/query-keys";
import { subscribeBroadcast, type BroadcastStatus } from "@/lib/realtime/private-broadcast";
import { readShellPart } from "@/lib/shell-batch";
import { useDocumentTitlePrefix } from "@/hooks/useDocumentTitlePrefix";

type Pending = { invites: number; applications: number };
type Snapshot = { data: ChatBootstrap; pending: Pending };
/** Delta polls skip the invite/application counts (null): keep the last ones. */
type Loaded = { data: ChatBootstrap; pending: Pending | null };

export type ChatShell = {
  data: ChatBootstrap | undefined;
  pending: Pending;
  badge: number;
  status: BroadcastStatus;
  /** The channel list could not be loaded (shown with a Retry). */
  loadError: string | null;
  /** Full reload of the channel list (membership changes, returning to the tab). */
  refresh: () => void;
  /** Move this tab's read cursor without waiting for the server echo. */
  applyRead: (channelId: string, seq: number) => void;
};

const NO_PENDING: Pending = { invites: 0, applications: 0 };
// A delta asks for changes since the last server_time minus this overlap, so a
// send that committed just after that snapshot is never missed.
const DELTA_OVERLAP_MS = 5_000;
// ponytail: one-release purge of the old chat's persisted stores (L-14).
// ceiling: runs once per tab load. upgrade: delete one release after cutover.
const LEGACY_STORAGE_KEYS = ["messages-v2-ui", "messages-v2-outbox"];

const ChatShellContext = createContext<ChatShell>({
  data: undefined,
  pending: NO_PENDING,
  badge: 0,
  status: "connecting",
  loadError: null,
  refresh: () => undefined,
  applyRead: () => undefined,
});

async function load(since: string | null): Promise<Loaded> {
  const result = since ? await bootstrap({ since }) : await readShellPart("chatSummary");
  if (!result?.success) {
    const code = result?.error ?? "chat_unavailable";
    console.error("[chat] conversations failed to load", code);
    throw new Error(code);
  }
  return { data: result.data, pending: result.pending };
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
  const key = useMemo(() => queryKeys.chat.bootstrap(userId), [userId]);
  const [status, setStatus] = useState<BroadcastStatus>("connecting");
  const wasDisconnected = useRef(false);

  const query = useQuery({
    queryKey: key,
    enabled: Boolean(userId),
    queryFn: async (): Promise<Snapshot> => {
      const loaded = await load(null);
      return { data: loaded.data, pending: loaded.pending ?? NO_PENDING };
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
  }, [key, queryClient]);

  const pollDelta = useCallback(async () => {
    const current = queryClient.getQueryData<Snapshot>(key);
    if (!current) return refresh();
    const since = new Date(Date.parse(current.data.server_time) - DELTA_OVERLAP_MS).toISOString();
    try {
      const next = await load(since);
      queryClient.setQueryData<Snapshot>(key, (prev) => (prev ? { data: mergeDelta(prev.data, next.data), pending: next.pending ?? prev.pending } : prev));
    } catch {
      // The next tick retries; a failed background poll never surfaces.
    }
  }, [key, queryClient, refresh]);

  useEffect(() => {
    try {
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
        if (event === "membership.changed") return refresh();
        const current = queryClient.getQueryData<Snapshot>(key);
        if (!current) return;
        if (event === "hint") {
          // The open Inbox list (and followed threads) pick up the new item too.
          void queryClient.invalidateQueries({ queryKey: ["chat-v3", "inbox"] });
          void queryClient.invalidateQueries({ queryKey: queryKeys.chat.threads() });
          const next = applyHint(current.data, payload as unknown as ChatHint);
          if (!next) return void pollDelta();
          if (next !== current.data) queryClient.setQueryData<Snapshot>(key, { ...current, data: next });
        } else if (event === "read.moved" && typeof payload.channel_id === "string" && typeof payload.seq === "number") {
          // Reads carry the fresh Inbox counts, so the badge, the Inbox row and the tab title drop together.
          const moved = applyReadMoved(current.data, payload.channel_id, payload.seq);
          queryClient.setQueryData<Snapshot>(key, { ...current, data: applyInboxCounts(moved, payload as InboxCounts) });
        } else if (event === "inbox.count") {
          queryClient.setQueryData<Snapshot>(key, { ...current, data: applyInboxCounts(current.data, payload as InboxCounts) });
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
  const pending = (userId && query.data?.pending) || NO_PENDING;
  const badge = useMemo(() => chatBadge(data), [data]);
  const router = useRouter();
  // A notification click asks this tab to route in-app instead of reloading (public/sw.js).
  useEffect(() => {
    const worker = typeof navigator === "undefined" ? undefined : navigator.serviceWorker;
    if (!worker) return;
    const onMessage = (event: MessageEvent) => {
      const message = event.data as { type?: string; href?: unknown } | null;
      if (message?.type !== "nb:navigate" || typeof message.href !== "string" || !message.href.startsWith("/") || message.href.startsWith("//")) return;
      router.push(message.href);
      event.ports[0]?.postMessage("ok");
    };
    worker.addEventListener("message", onMessage);
    return () => worker.removeEventListener("message", onMessage);
  }, [router]);
  // The tab title carries the same count as the Messages badge: "(3) Discover".
  useDocumentTitlePrefix(badge ? `(${badge > 99 ? "99+" : badge})` : null, " ");
  const loadError = userId && query.isError && !data ? query.error.message : null;
  const shell = useMemo<ChatShell>(
    () => ({ data, pending, badge, status, loadError, refresh, applyRead }),
    [applyRead, badge, data, loadError, pending, refresh, status],
  );

  return (
    <ChatShellContext.Provider value={shell}>{children}</ChatShellContext.Provider>
  );
}

export function useChatShell() {
  return useContext(ChatShellContext);
}

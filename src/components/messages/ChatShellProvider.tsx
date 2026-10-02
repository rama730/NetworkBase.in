"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { bootstrap } from "@/app/actions/chat/read";
import { useAuth } from "@/hooks/useAuth";
import { CHAT_POLL_BASE_MS, CHAT_POLL_JITTER_MS, userTopic } from "@/lib/messaging/constants";
import { applyHint, applyReadMoved, chatBadge, mergeDelta, type ChatHint } from "@/lib/messaging/shell-state";
import type { ChatBootstrap } from "@/lib/messaging/types";
import { queryKeys } from "@/lib/query-keys";
import { subscribeBroadcast, type BroadcastStatus } from "@/lib/realtime/private-broadcast";
import { readShellPart } from "@/lib/shell-batch";

type Pending = { invites: number; applications: number };
type Snapshot = { data: ChatBootstrap; pending: Pending };

export type ChatShell = {
  data: ChatBootstrap | undefined;
  pending: Pending;
  badge: number;
  status: BroadcastStatus;
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
  refresh: () => undefined,
  applyRead: () => undefined,
});

async function load(since: string | null): Promise<Snapshot> {
  const result = since ? await bootstrap({ since }) : await readShellPart("chatSummary");
  if (!result.success) throw new Error(result.error);
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
    queryFn: () => load(null),
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
      queryClient.setQueryData<Snapshot>(key, (prev) => (prev ? { data: mergeDelta(prev.data, next.data), pending: next.pending } : prev));
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
          const next = applyHint(current.data, payload as unknown as ChatHint);
          if (!next) return void pollDelta();
          if (next !== current.data) queryClient.setQueryData<Snapshot>(key, { ...current, data: next });
        } else if (event === "read.moved" && typeof payload.channel_id === "string" && typeof payload.seq === "number") {
          queryClient.setQueryData<Snapshot>(key, { ...current, data: applyReadMoved(current.data, payload.channel_id, payload.seq) });
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
  const shell = useMemo<ChatShell>(() => ({ data, pending, badge, status, refresh, applyRead }), [applyRead, badge, data, pending, refresh, status]);

  return (
    <ChatShellContext.Provider value={shell}>{children}</ChatShellContext.Provider>
  );
}

export function useChatShell() {
  return useContext(ChatShellContext);
}

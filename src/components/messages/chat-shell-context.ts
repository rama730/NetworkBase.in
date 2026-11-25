"use client";

import { createContext, useContext, useMemo } from "react";

import type { ChatBootstrap } from "@/lib/messaging/types";
import type { BroadcastStatus } from "@/lib/realtime/private-broadcast";

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

export const ChatShellContext = createContext<ChatShell>({
  data: undefined,
  badge: 0,
  status: "connecting",
  loadError: null,
  refresh: () => undefined,
  applyRead: () => undefined,
});

export function useChatShell() {
  return useContext(ChatShellContext);
}

/** People the viewer blocked (Blocking B23, B34): one stable set, new only when the list itself changes. */
export function useBlockedIds(): ReadonlySet<string> {
  const key = useChatShell().data?.blocked_ids?.join(",") ?? "";
  return useMemo(() => new Set(key ? key.split(",") : []), [key]);
}

/** People the viewer muted (B26), the same way. */
export function useMutedIds(): ReadonlySet<string> {
  const key = useChatShell().data?.muted_ids?.join(",") ?? "";
  return useMemo(() => new Set(key ? key.split(",") : []), [key]);
}

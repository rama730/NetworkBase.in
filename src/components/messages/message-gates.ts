"use client";

import { useEffect, useSyncExternalStore } from "react";

import { canMessageMany } from "@/app/actions/chat/members";
import { useBlockedIds } from "@/components/messages/chat-shell-context";
import { messageGate, type MessageReason } from "@/lib/messaging/can-message";

// Every Message link on a page asks once, together: the ids collect for a tick, then one canMessageMany read.
const known = new Map<string, { canMessage: boolean; reason: MessageReason }>();
const waiting = new Set<string>();
const listeners = new Set<() => void>();
let timer = 0;

function flush() {
  timer = 0;
  const ids = [...waiting];
  waiting.clear();
  void canMessageMany({ userIds: ids })
    .then((result) => { if (result.success) for (const [id, gate] of Object.entries(result.gates ?? {})) known.set(id, gate); })
    .catch(() => undefined)
    .finally(() => listeners.forEach((listener) => listener()));
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

/** What one person's Message link should do. Unknown (still asking, or the read failed): open, and the server decides. */
export function useMessageGate(userId: string) {
  const blockedIds = useBlockedIds();
  useEffect(() => {
    if (known.has(userId) || waiting.has(userId)) return;
    waiting.add(userId);
    if (!timer) timer = window.setTimeout(flush, 0);
  }, [userId]);
  const gate = useSyncExternalStore(subscribe, () => known.get(userId), () => undefined);
  return messageGate({ canMessage: gate?.canMessage, reason: gate?.reason, blockedByMe: blockedIds.has(userId) });
}

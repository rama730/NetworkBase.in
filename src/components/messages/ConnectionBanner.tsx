"use client";

import { useSyncExternalStore } from "react";
import { WifiOff } from "lucide-react";

import { useChatShell } from "@/components/messages/ChatShellProvider";
import type { BroadcastStatus } from "@/lib/realtime/private-broadcast";

const subscribeOnline = (onChange: () => void) => {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
};

/**
 * Offline, or the live connection dropped: say so above the timeline or list (catch-up polling
 * keeps it fresh meanwhile). Without a `status`, the app-wide chat connection's.
 */
export function ConnectionBanner({ status: own }: { status?: BroadcastStatus }) {
  const shell = useChatShell();
  const status = own ?? shell.status;
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  const text = !online
    ? "You’re offline. New messages will show when you reconnect."
    : status === "disconnected" ? "Reconnecting… new messages may take a moment to appear." : null;
  if (!text) return null;
  return (
    <p role="status" className="flex flex-none items-center gap-2 border-b border-border bg-[var(--status-warning-soft)] px-4 py-1.5 text-[13px] text-foreground">
      <WifiOff size={14} aria-hidden="true" /> {text}
    </p>
  );
}

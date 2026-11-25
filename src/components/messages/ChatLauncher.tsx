"use client";

// Loaded with the launcher, so the first open after a click already knows it was a click (the window rises).
import "@/components/messages/recent-input";
import { padCount } from "@/lib/messaging/mix-format";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { MessageSquare } from "lucide-react";

import { CHAT_WINDOW_QUERY, chatWindowHiddenOn, useChatWindow } from "@/components/messages/chat-window-store";
import { useChatShell } from "@/components/messages/ChatShellProvider";

const ChatWindow = dynamic(() => import("@/components/messages/ChatWindow"), { ssr: false });

/**
 * The floating button (report 7.13): 56px, bottom-right, badge = chatBadge (unread DMs + Inbox).
 * Not mounted below 768px or on focused message/create-project/profile-editor routes.
 */
export default function ChatLauncher() {
  const pathname = usePathname() ?? "";
  const { badge } = useChatShell();
  const open = useChatWindow((state) => state.open);
  const setOpen = useChatWindow((state) => state.setOpen);
  const close = useChatWindow((state) => state.close);
  const button = useRef<HTMLButtonElement>(null);
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const query = window.matchMedia(CHAT_WINDOW_QUERY);
    const sync = () => setWide(query.matches);
    sync();
    query.addEventListener("change", sync);
    // Prewarm the window's code when idle; no channel data is fetched until it opens.
    const idle = window.requestIdleCallback?.(() => void import("@/components/messages/ChatWindow"));
    return () => {
      query.removeEventListener("change", sync);
      if (idle) window.cancelIdleCallback?.(idle);
    };
  }, []);

  if (!wide || chatWindowHiddenOn(pathname)) return null;
  const label = badge ? `Messages, ${badge} unread` : "Messages";
  return (
    <>
      <button
        ref={button}
        type="button"
        onClick={() => setOpen(!open)}
        aria-label={label}
        aria-expanded={open}
        aria-controls="chat-window"
        data-testid="chat-launcher"
        className="nbm nbm-launcher fixed bottom-6 right-6 z-20"
      >
        <MessageSquare size={24} aria-hidden="true" />
        {/* A mono clay count chip on the ink-or-card cell. */}
        {badge ? <span className="nbm-count hot nbm-launcher-count" aria-hidden="true">{padCount(badge)}</span> : null}
      </button>
      {open ? <ChatWindow onMinimize={() => { setOpen(false); button.current?.focus(); }} onClose={() => { close(); button.current?.focus(); }} /> : null}
    </>
  );
}

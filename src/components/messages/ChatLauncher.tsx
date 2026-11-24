"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { MessageSquare } from "@/components/ui/icons";

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
        className="fixed bottom-6 right-6 z-20 grid size-14 place-items-center rounded-full bg-primary text-primary-foreground shadow-md"
      >
        <MessageSquare size={24} aria-hidden="true" />
        {/* The nav's neutral count, readable on the clay button (never clay on clay). */}
        {badge ? <span className="nb-chat-count absolute -right-1 -top-1 m-0 border border-card text-secondary-foreground" aria-hidden="true">{badge > 99 ? "99+" : badge}</span> : null}
      </button>
      {open ? <ChatWindow onMinimize={() => { setOpen(false); button.current?.focus(); }} onClose={() => { close(); button.current?.focus(); }} /> : null}
    </>
  );
}

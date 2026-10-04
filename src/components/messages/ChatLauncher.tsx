"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { MessageCircle } from "lucide-react";

import { CHAT_WINDOW_QUERY, chatWindowHiddenOn, useChatWindow } from "@/components/messages/chat-window-store";
import { useChatShell } from "@/components/messages/ChatShellProvider";

const ChatWindow = dynamic(() => import("@/components/messages/ChatWindow"), { ssr: false });

/**
 * The floating button (report 7.13): 56px, bottom-right, badge = mentions +
 * unread DMs. Not mounted below 768px or on /messages and /projects/new.
 */
export default function ChatLauncher() {
  const pathname = usePathname() ?? "";
  const { badge } = useChatShell();
  const open = useChatWindow((state) => state.open);
  const setOpen = useChatWindow((state) => state.setOpen);
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
        <MessageCircle size={22} aria-hidden="true" />
        {badge ? <span className="nb-chat-count absolute -right-1 -top-1 m-0" aria-hidden="true">{badge > 99 ? "99+" : badge}</span> : null}
      </button>
      {open ? <ChatWindow onMinimize={() => { setOpen(false); button.current?.focus(); }} /> : null}
    </>
  );
}

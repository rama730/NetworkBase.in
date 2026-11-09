"use client";

import Link from "next/link";
import { SquarePen } from "lucide-react";

import { ChatSections } from "@/components/messages/ChatSections";
import { ConnectionBanner } from "@/components/messages/ConnectionBanner";

/**
 * The List screen (report 7.12 B10): phones and tablets at /messages, and the
 * launcher window's first screen. Same sections as the desktop sidebar.
 */
export function ListScreen({ onSelect, onNewMessage, onInbox, actions }: { onSelect?: (channelId: string) => void; onNewMessage?: () => void; onInbox?: () => void; actions?: React.ReactNode }) {
  return (
    <div className="nb-chat-list flex h-full min-h-0 flex-col bg-card">
      <header className="flex h-14 flex-none items-center gap-1 border-b border-border px-2">
        {/* The floating window is inside a page that has its own h1. */}
        {onSelect ? <h2 className="nb-card-title min-w-0 flex-1 truncate px-2">Messages</h2> : <h1 className="nb-card-title min-w-0 flex-1 truncate px-2">Messages</h1>}
        {onNewMessage ? (
          <button type="button" onClick={onNewMessage} className="nb-icon-button nb-touch-target" aria-label="New message"><SquarePen size={16} aria-hidden="true" /></button>
        ) : (
          <Link href="/messages/new" className="nb-icon-button nb-touch-target" aria-label="New message"><SquarePen size={16} aria-hidden="true" /></Link>
        )}
        {actions}
      </header>
      <ConnectionBanner />
      <div data-scroll-memory="messages-list" className="app-scroll app-scroll-y min-h-0 flex-1 px-2 py-3">
        <ChatSections variant="list" onSelect={onSelect} onNewMessage={onNewMessage} onInbox={onInbox} />
      </div>
    </div>
  );
}

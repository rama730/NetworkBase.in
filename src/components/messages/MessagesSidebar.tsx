"use client";

import { ChatSections } from "@/components/messages/ChatSections";
import { useWide } from "@/components/messages/useWide";

// ponytail: tablets (768–1023px) use the single-pane pattern (L-22).
// upgrade: show this sidebar from ~900px if tablet data shows wasted space.
/**
 * The chat sidebar inside /messages at 1024px+, to the right of the app's own
 * navigation: Home, Inbox, Saved and Drafts, then Starred, the open project's
 * channels, Direct messages and your applications. Below 1024px the List screen takes its place.
 * From 1024 to 1279px, with a thread or details open, it steps aside (CSS: .nb-chat-sidebar in globals.css).
 */
export function MessagesSidebar() {
  // Phones never show it (CSS), so once the width is known it stops running its list and presence there.
  const wide = useWide();
  return (
    <aside className="nb-chat-sidebar hidden h-full w-[260px] flex-none flex-col border-r border-border bg-card lg:flex" aria-label="Conversations">
      {/* The app sidebar's spacing: 16px 12px. */}
      <div data-scroll-memory="messages-sidebar" className="app-scroll app-scroll-y min-h-0 flex-1 px-3 py-4">
        {wide === false ? null : <ChatSections variant="sidebar" />}
      </div>
    </aside>
  );
}

import { ChatSections } from "@/components/messages/ChatSections";

// ponytail: tablets (768–1023px) use the single-pane pattern (L-22).
// upgrade: show this sidebar from ~900px if tablet data shows wasted space.
/**
 * The chat sidebar inside /messages at 1024px+, to the right of the app's own
 * navigation: Home, Inbox, Saved and Drafts, then Starred, the open project's
 * channels, Direct messages and your applications. Below 1024px the List screen takes its place.
 * From 1024 to 1279px, with a thread or details open, it steps aside (CSS: .nb-chat-sidebar in globals.css).
 */
export function MessagesSidebar() {
  return (
    <aside className="nb-chat-sidebar hidden h-full w-[260px] flex-none flex-col border-r border-border bg-card lg:flex" aria-label="Conversations">
      <div className="app-scroll app-scroll-y min-h-0 flex-1 px-2 py-3">
        <ChatSections variant="sidebar" />
      </div>
    </aside>
  );
}

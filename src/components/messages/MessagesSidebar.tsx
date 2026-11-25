"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { PanelLeft } from "lucide-react";
import { ChatSections } from "@/components/messages/ChatSections";
import { useChatUi } from "@/components/messages/chat-ui-store";
import { useWide } from "@/components/messages/useWide";
import { escapeTaken } from "@/components/messages/keys";

const SHEET_RANGE = "(min-width: 1024px) and (max-width: 1279px)";
const closeSheet = () => {
  useChatUi.getState().setSidebarSheet(false);
  document.querySelector<HTMLElement>(".nbm-sheet-toggle")?.focus();
};

// ponytail: tablets (768–1023px) use the single-pane pattern (L-22).
// upgrade: show this sidebar from ~900px if tablet data shows wasted space.
/**
 * The chat sidebar inside /messages at 1024px+, to the right of the app's own
 * navigation: Home, Inbox, Saved and Drafts, then Starred, the open project's
 * channels, Direct messages and your applications. Below 1024px the List screen takes its place.
 * From 1024 to 1279px, with a thread or details open, it steps aside (CSS: .nb-chat-sidebar in globals.css);
 * "Show conversations" brings it back as a sheet over the conversation (messages-mix.css).
 */
export function MessagesSidebar() {
  // Phones never show it (CSS), so once the width is known it stops running its list and presence there.
  const wide = useWide();
  const sheet = useChatUi((state) => state.sidebarSheet);
  const pathname = usePathname();
  const ref = useRef<HTMLElement>(null);
  // Picking a row opens another conversation: the sheet closes (the old drawer closes with its URL).
  useEffect(() => useChatUi.getState().setSidebarSheet(false), [pathname]);
  useEffect(() => {
    if (!sheet) return;
    // The sheet exists only in its width range: leaving it (a resize) closes it.
    const range = window.matchMedia(SHEET_RANGE);
    if (!range.matches) return void useChatUi.getState().setSidebarSheet(false);
    const onRange = () => useChatUi.getState().setSidebarSheet(false);
    range.addEventListener("change", onRange);
    ref.current?.querySelector<HTMLElement>("a[href], button:not([disabled])")?.focus();
    const onKey = (event: KeyboardEvent) => {
      // An open menu or dialog takes Esc first; Shift+Esc stays "mark read".
      if (event.key !== "Escape" || event.shiftKey || escapeTaken(event)) return;
      // Then the sheet, before the drawer behind it.
      event.preventDefault();
      event.stopPropagation();
      closeSheet();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      range.removeEventListener("change", onRange);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [sheet]);
  return (
    <>
      <aside ref={ref} data-sheet={sheet ? "true" : undefined} className="nb-chat-sidebar hidden h-full w-[260px] flex-none flex-col border-r border-border bg-card lg:flex" aria-label="Conversations">
        {/* Mix: full-bleed rows; each row carries its own 14px inset. */}
        <div data-scroll-memory="messages-sidebar" className="app-scroll app-scroll-y min-h-0 flex-1 py-2">
          {wide === false ? null : <ChatSections variant="sidebar" />}
        </div>
      </aside>
      {sheet ? <div className="nbm-sheet-scrim" aria-hidden="true" onClick={closeSheet} /> : null}
    </>
  );
}

/** In the conversation header; CSS shows it only at 1024–1279px with a drawer open. */
export function SidebarSheetToggle() {
  const sheet = useChatUi((state) => state.sidebarSheet);
  return (
    <button type="button" className="nbm-cell nbm-sheet-toggle flex-none" aria-pressed={sheet} aria-label="Show conversations" title="Show conversations" onClick={() => useChatUi.getState().setSidebarSheet(!sheet)}>
      <PanelLeft size={16} aria-hidden="true" />
    </button>
  );
}

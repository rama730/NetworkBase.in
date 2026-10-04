"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckSquare, Copy, ExternalLink, FileText, Files, LayoutTemplate, Link2, MessageSquare, Pin, Plus, SlidersHorizontal, X } from "lucide-react";

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { ChannelTabItem } from "@/lib/messaging/channel-tabs";
import { normalizeSafeExternalUrl } from "@/lib/messaging/safe-links";

type Props = {
  activeTab: string;
  tabs: ChannelTabItem[];
  pinCount: number;
  onSelectTab: (tabId: string) => void;
  /** Hide the canvas for you, or remove a shared tab for everyone. */
  onCloseTab: (tab: ChannelTabItem) => void;
  /** Channels only: blank, copied from another channel (project channels) or template canvas. */
  onAddCanvas?: (from: "blank" | "existing" | "template") => void;
  /** Project channels: other channels' canvases can be copied in. */
  canCopyCanvas?: boolean;
  /** Project channels without a Tasks tab yet. */
  onAddTasks?: () => void;
  /** Channels without a Files tab yet. */
  onAddFiles?: () => void;
  onAddBookmark: () => void;
  onEditTabs?: () => void;
  /** A canvas exists: "+" offers to open it rather than start a new one. */
  hasCanvas?: boolean;
};

/** One icon per tab kind, shared with Edit tabs. Bookmarks use a link (the bookmark icon means Saved). */
export const TAB_ICONS: Record<ChannelTabItem["kind"], typeof Pin> = {
  messages: MessageSquare,
  pins: Pin,
  files: Files,
  canvas: FileText,
  tasks: CheckSquare,
  link: Link2,
};

/**
 * Messages, Canvas, Pins, Files and Tasks are tabs; bookmarks follow after a divider as plain links
 * (they open a website in a new browser tab, so they aren't tabs). "+" adds a canvas, a tab or a bookmark.
 */
export function ChannelTabBar({ activeTab, tabs, pinCount, onSelectTab, onCloseTab, onAddCanvas, canCopyCanvas = false, onAddTasks, onAddFiles, onAddBookmark, onEditTabs, hasCanvas = false }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // On a narrow screen the strip scrolls: a fade at the edge says there's more.
  const [more, setMore] = useState(false);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const sync = () => setMore(el.scrollWidth - el.clientWidth - el.scrollLeft > 4);
    sync();
    el.addEventListener("scroll", sync, { passive: true });
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    return () => {
      el.removeEventListener("scroll", sync);
      observer.disconnect();
    };
  }, [tabs.length]);

  // Arrows, Home and End move between tabs (and the + button). No delete key: removing a shared tab affects everyone, so it's the × (with Undo).
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const elements = Array.from(containerRef.current?.querySelectorAll<HTMLElement>('[role="tab"], [data-add-tab-trigger]') ?? []);
    const index = elements.indexOf(e.currentTarget as HTMLElement);
    const next = e.key === "ArrowRight" ? (index + 1) % elements.length
      : e.key === "ArrowLeft" ? (index - 1 + elements.length) % elements.length
      : e.key === "Home" ? 0 : e.key === "End" ? elements.length - 1 : null;
    if (next === null) return;
    e.preventDefault();
    elements[next]?.focus();
  }, []);

  const tabClass = "nb-tab inline-flex items-center border-b-2 px-2 pb-2 text-[13px] font-medium transition-colors";
  const views = tabs.filter((tab) => tab.kind !== "link");
  const bookmarks = tabs.filter((tab) => tab.kind === "link");
  const closeButton = (tab: ChannelTabItem) => (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onCloseTab(tab);
      }}
      aria-label={tab.kind === "canvas" ? "Hide canvas tab" : `Remove ${tab.title} ${tab.kind === "link" ? "bookmark" : "tab"}`}
      title={tab.kind === "canvas" ? "Hide for you (the canvas stays)" : "Remove for everyone"}
      className="absolute right-0.5 top-1/2 -mt-1 grid size-5 -translate-y-1/2 place-items-center rounded-[3px] bg-card text-muted-foreground opacity-0 shadow-[-6px_0_6px_var(--card)] transition-opacity hover:bg-muted hover:text-foreground focus:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:size-8 pointer-coarse:opacity-100"
    >
      <X size={12} />
    </button>
  );
  return (
    <div
      ref={containerRef}
      className={`flex h-10 flex-none items-end gap-1 overflow-x-auto scroll-smooth border-b border-border px-4 ${more ? "[mask-image:linear-gradient(to_right,black_calc(100%-32px),transparent)]" : ""}`}
    >
      <div className="flex items-end gap-1" role="tablist" aria-label="Conversation views">
        {views.map((tab) => {
          const Icon = TAB_ICONS[tab.kind];
          const selected = activeTab === tab.id;
          const closable = tab.shared || tab.kind === "canvas";
          return (
            <div key={tab.id} className="group relative -mb-px inline-flex flex-none items-center">
              <button
                type="button"
                role="tab"
                id={`conversation-tab-${tab.id}`}
                aria-controls="conversation-tabpanel"
                aria-selected={selected}
                tabIndex={selected ? 0 : -1}
                onClick={() => onSelectTab(tab.id)}
                onKeyDown={handleKeyDown}
                // On touch the × always shows: room for it, so it never covers the name.
                className={`${tabClass} ${closable ? "pointer-coarse:pr-8" : ""} ${selected ? "border-[var(--chat-accent)] text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
              >
                <Icon size={13} className="mr-1.5 shrink-0 opacity-70" aria-hidden="true" />
                <span className="max-w-[130px] truncate">{tab.title}</span>
                {tab.kind === "pins" && pinCount > 0 ? <span className="nb-tab-count ml-1.5">{pinCount}<span className="sr-only"> pinned</span></span> : null}
              </button>
              {closable ? closeButton(tab) : null}
            </div>
          );
        })}
      </div>

      {bookmarks.length ? (
        <>
          <span className="mx-1 mb-2.5 h-4 w-px flex-none bg-border" aria-hidden="true" />
          {bookmarks.map((tab) => {
            const href = normalizeSafeExternalUrl(tab.url ?? "") ?? undefined;
            return (
              <div key={tab.id} className="group relative -mb-px inline-flex flex-none items-center">
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={tab.url ? `Open ${tab.url} in a new tab` : undefined}
                  className={`${tabClass} pointer-coarse:pr-8 border-transparent text-muted-foreground hover:text-foreground`}
                >
                  <Link2 size={13} className="mr-1.5 shrink-0 opacity-70" aria-hidden="true" />
                  <span className="max-w-[130px] truncate">{tab.title}</span>
                  <ExternalLink size={11} className="ml-1 shrink-0 opacity-60" aria-hidden="true" />
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
                {closeButton(tab)}
              </div>
            );
          })}
        </>
      ) : null}

      <div className="mb-1.5 flex flex-none items-center">
        <DropdownMenu>
          <DropdownMenuTrigger
            data-add-tab-trigger
            aria-label="Add a tab"
            title="Add a tab"
            onKeyDown={handleKeyDown}
            className="inline-flex size-7 items-center justify-center rounded-[4px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring pointer-coarse:size-11"
          >
            <Plus size={15} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-60">
            {onAddCanvas ? (
              <>
                <DropdownMenuItem onSelect={() => onAddCanvas("blank")} className="gap-2"><FileText size={15} className="text-muted-foreground" /> {hasCanvas ? "Open canvas" : "New canvas"}</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onAddCanvas("template")} className="gap-2"><LayoutTemplate size={15} className="text-muted-foreground" /> Templates…</DropdownMenuItem>
                {canCopyCanvas ? <DropdownMenuItem onSelect={() => onAddCanvas("existing")} className="gap-2"><Copy size={15} className="text-muted-foreground" /> Copy from another channel…</DropdownMenuItem> : null}
                <DropdownMenuSeparator />
              </>
            ) : null}
            {onAddFiles ? (
              <DropdownMenuItem onSelect={onAddFiles} className="gap-2"><Files size={15} className="text-muted-foreground" /> Add Files tab</DropdownMenuItem>
            ) : null}
            {onAddTasks ? (
              <DropdownMenuItem onSelect={onAddTasks} className="gap-2"><CheckSquare size={15} className="text-muted-foreground" /> Add Tasks tab</DropdownMenuItem>
            ) : null}
            <DropdownMenuItem onSelect={onAddBookmark} className="gap-2"><Link2 size={15} className="text-muted-foreground" /> Add bookmark…</DropdownMenuItem>
            {onEditTabs ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={onEditTabs} className="gap-2"><SlidersHorizontal size={15} className="text-muted-foreground" /> Edit tabs</DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

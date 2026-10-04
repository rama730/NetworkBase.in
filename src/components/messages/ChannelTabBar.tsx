"use client";

import { useCallback, useRef } from "react";
import { Bookmark, CheckSquare, FileText, Files, LayoutTemplate, MessageSquare, Pin, Plus, SlidersHorizontal, X } from "lucide-react";
import { toast } from "sonner";

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { ChannelTabItem } from "@/lib/messaging/channel-tabs";

type Props = {
  activeTab: string;
  tabs: ChannelTabItem[];
  pinCount: number;
  onSelectTab: (tabId: string) => void;
  /** Hide the canvas for you, or remove a shared tab for everyone. */
  onCloseTab: (tab: ChannelTabItem) => void;
  /** Channels only: blank, existing or template canvas. */
  onAddCanvas?: (from: "blank" | "existing" | "template") => void;
  /** Project channels without a Tasks tab yet. */
  onAddTasks?: () => void;
  /** Channels without a Files tab yet. */
  onAddFiles?: () => void;
  onAddBookmark: () => void;
  onEditTabs?: () => void;
};

const ICONS: Record<ChannelTabItem["kind"], typeof Pin> = {
  messages: MessageSquare,
  pins: Pin,
  files: Files,
  canvas: FileText,
  tasks: CheckSquare,
  link: Bookmark,
};

/** Messages, Canvas, Pins, Files, then shared Tasks and bookmarks; "+" adds a canvas, Tasks or a bookmark. */
export function ChannelTabBar({ activeTab, tabs, pinCount, onSelectTab, onCloseTab, onAddCanvas, onAddTasks, onAddFiles, onAddBookmark, onEditTabs }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const handleKeyDown = useCallback((e: React.KeyboardEvent, tab?: ChannelTabItem) => {
    const elements = Array.from(containerRef.current?.querySelectorAll<HTMLElement>('[role="tab"], [data-add-tab-trigger]') ?? []);
    const index = elements.indexOf(e.currentTarget as HTMLElement);
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const step = e.key === "ArrowRight" ? 1 : -1;
      elements[(index + step + elements.length) % elements.length]?.focus();
    } else if ((e.key === "Delete" || e.key === "Backspace") && tab && (tab.shared || tab.kind === "canvas")) {
      e.preventDefault();
      onCloseTab(tab);
      elements[0]?.focus();
    }
  }, [onCloseTab]);

  return (
    <div ref={containerRef} className="flex h-10 flex-none items-end gap-1 overflow-x-auto scroll-smooth border-b border-border px-4" role="tablist" aria-label="Conversation views">
      {tabs.map((tab) => {
        const Icon = ICONS[tab.kind];
        const selected = activeTab === tab.id;
        const closable = tab.shared || tab.kind === "canvas";
        return (
          <div
            key={tab.id}
            className="group relative -mb-px inline-flex flex-none items-center"
            onContextMenu={tab.kind === "link" && tab.url ? (e) => {
              e.preventDefault();
              void navigator.clipboard?.writeText(tab.url!);
              toast.success(`Copied "${tab.title}" link`);
            } : undefined}
          >
            <button
              type="button"
              role="tab"
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => onSelectTab(tab.id)}
              onKeyDown={(e) => handleKeyDown(e, tab)}
              className={`nb-tab inline-flex items-center border-b-2 px-2 pb-2 text-[13px] font-medium transition-colors ${
                selected ? "border-[var(--chat-accent)] text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon size={13} className="mr-1.5 shrink-0 opacity-70" aria-hidden="true" />
              <span className="max-w-[130px] truncate">{tab.title}</span>
              {tab.kind === "pins" && pinCount > 0 ? <span className="nb-tab-count ml-1.5" aria-label={`${pinCount} pinned messages`}>{pinCount}</span> : null}
            </button>
            {closable ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab(tab);
                }}
                aria-label={tab.kind === "canvas" ? "Hide canvas tab" : `Remove ${tab.title} tab`}
                title={tab.kind === "canvas" ? "Hide for you (the canvas stays)" : "Remove for everyone"}
                className="absolute right-0.5 top-1/2 -mt-1 grid size-5 -translate-y-1/2 place-items-center rounded-[3px] bg-card text-muted-foreground opacity-0 shadow-[-6px_0_6px_var(--card)] transition-opacity hover:bg-muted hover:text-foreground focus:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100"
              >
                <X size={12} />
              </button>
            ) : null}
          </div>
        );
      })}

      <div className="mb-1.5 flex flex-none items-center">
        <DropdownMenu>
          <DropdownMenuTrigger
            data-add-tab-trigger
            aria-label="Add a tab"
            title="Add a tab"
            onKeyDown={(e) => handleKeyDown(e)}
            className="inline-flex size-7 items-center justify-center rounded-[4px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <Plus size={15} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            {onAddCanvas ? (
              <>
                <DropdownMenuItem onSelect={() => onAddCanvas("blank")} className="gap-2"><FileText size={15} className="text-muted-foreground" /> New canvas</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onAddCanvas("existing")} className="gap-2"><Files size={15} className="text-muted-foreground" /> Canvas from another channel</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onAddCanvas("template")} className="gap-2"><LayoutTemplate size={15} className="text-muted-foreground" /> Canvas from a template</DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            ) : null}
            {onAddFiles ? (
              <DropdownMenuItem onSelect={onAddFiles} className="gap-2"><Files size={15} className="text-muted-foreground" /> Files</DropdownMenuItem>
            ) : null}
            {onAddTasks ? (
              <DropdownMenuItem onSelect={onAddTasks} className="gap-2"><CheckSquare size={15} className="text-muted-foreground" /> Project tasks</DropdownMenuItem>
            ) : null}
            <DropdownMenuItem onSelect={onAddBookmark} className="gap-2"><Bookmark size={15} className="text-muted-foreground" /> Bookmark</DropdownMenuItem>
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

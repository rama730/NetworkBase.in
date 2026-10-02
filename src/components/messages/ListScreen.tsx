"use client";

import Link from "next/link";
import { ChevronDown, Search, SquarePen } from "lucide-react";

import { useChatUi } from "@/components/messages/chat-ui-store";
import { ChatSections } from "@/components/messages/ChatSections";
import { useChatShell } from "@/components/messages/ChatShellProvider";
import { useSelectedProject } from "@/components/messages/useSelectedProject";

/**
 * The List screen (report 7.12 B10): phones and tablets at /messages, and the
 * launcher window's first screen. Same sections as the desktop sidebar.
 */
export function ListScreen({ onSelect, onNewMessage }: { onSelect?: (channelId: string) => void; onNewMessage?: () => void }) {
  const { data, status } = useChatShell();
  const projectId = useSelectedProject();
  const setSwitcherOpen = useChatUi((state) => state.setSwitcherOpen);
  const setProjectSheetOpen = useChatUi((state) => state.setProjectSheetOpen);
  const setCreateFor = useChatUi((state) => state.setCreateChannelFor);
  const setInviteFor = useChatUi((state) => state.setInviteFor);
  const title = data?.projects?.find((p) => p.id === projectId)?.title ?? "Home";

  return (
    <div className="nb-chat-list flex h-full min-h-0 flex-col bg-card">
      <header className="flex h-14 flex-none items-center gap-1 border-b border-border px-2">
        <button type="button" onClick={() => setProjectSheetOpen(true)} className="flex min-h-11 min-w-0 flex-1 items-center gap-1 rounded-[5px] px-2 text-left text-[17px] font-semibold" aria-label={`${title}, switch project`}>
          <span className="truncate">{title}</span>
          <ChevronDown size={16} aria-hidden="true" className="flex-none" />
        </button>
        <button type="button" onClick={() => setSwitcherOpen(true)} className="nb-icon-button nb-touch-target" aria-label="Find a conversation"><Search size={18} aria-hidden="true" /></button>
        {onNewMessage ? (
          <button type="button" onClick={onNewMessage} className="nb-icon-button nb-touch-target" aria-label="New message"><SquarePen size={18} aria-hidden="true" /></button>
        ) : (
          <Link href="/messages/new" className="nb-icon-button nb-touch-target" aria-label="New message"><SquarePen size={18} aria-hidden="true" /></Link>
        )}
      </header>
      <div className="app-scroll app-scroll-y min-h-0 flex-1 px-2 py-3">
        {!data ? (
          <p role="status" className="px-3 py-6 text-center text-[13px] text-muted-foreground">{status === "disabled" || status === "connected" ? "Loading conversations…" : "Connecting…"}</p>
        ) : (
          <ChatSections
            projectId={projectId}
            variant="list"
            onSelect={onSelect}
            onCreateChannel={projectId && !onSelect ? () => setCreateFor(projectId) : undefined}
            onInvite={projectId && !onSelect ? () => setInviteFor(projectId) : undefined}
          />
        )}
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronDown, Search, Settings, SquarePen } from "lucide-react";

import { markRead } from "@/app/actions/chat/read";
import { useChatUi } from "@/components/messages/chat-ui-store";
import { ChatSections, type ChatSectionsVariant } from "@/components/messages/ChatSections";
import { useChatShell } from "@/components/messages/ChatShellProvider";
import { useSelectedProject } from "@/components/messages/useSelectedProject";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { settingsTabHref } from "@/constants/routes";
import { isUnread } from "@/lib/messaging/channel-view";

type Props = {
  variant: ChatSectionsVariant;
  onCreateChannel: () => void;
  onInvite: () => void;
  onSelect?: (channelId: string) => void;
};

/** Sidebar header + "Find a conversation" + sections. The mobile List screen and launcher reuse it with variant "list". */
export function ChatSidebar({ variant, onCreateChannel, onInvite, onSelect }: Props) {
  const { data, refresh } = useChatShell();
  const projectId = useSelectedProject();
  const setSwitcherOpen = useChatUi((state) => state.setSwitcherOpen);
  const setProjectSheetOpen = useChatUi((state) => state.setProjectSheetOpen);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const project = data?.projects?.find((p) => p.id === projectId) ?? null;
  const title = project?.title ?? "Home";
  const canManage = project?.role === "owner" || project?.role === "admin";

  const markAllRead = async () => {
    const unread = (data?.channels ?? []).filter((c) => isUnread(c) && (projectId ? c.project_id === projectId : !c.project_id));
    await Promise.all(unread.map((c) => markRead({ channelId: c.id, seq: c.last_seq })));
    refresh();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-14 flex-none items-center gap-1 px-3">
        <DropdownMenu>
          <DropdownMenuTrigger className="flex min-h-11 min-w-0 flex-1 items-center gap-1 rounded-[5px] px-1 text-left text-[17px] font-semibold text-[var(--foreground)]">
            <span className="truncate">{title}</span>
            <ChevronDown size={16} aria-hidden="true" className="flex-none" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuItem onSelect={() => setProjectSheetOpen(true)}>Switch project</DropdownMenuItem>
            {canManage ? <DropdownMenuItem onSelect={onInvite}>Invite people</DropdownMenuItem> : null}
            {project && canManage ? (
              <DropdownMenuItem asChild><Link href={`/projects/${project.slug ?? project.id}?tab=settings`}>Project settings</Link></DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem checked={unreadOnly} onCheckedChange={(checked) => setUnreadOnly(Boolean(checked))}>Show unreads only</DropdownMenuCheckboxItem>
            <DropdownMenuItem onSelect={() => void markAllRead()}>Mark all read</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Link href={settingsTabHref("notifications")} className="nb-icon-button nb-touch-target" aria-label="Messaging preferences"><Settings size={16} aria-hidden="true" /></Link>
        <Link href="/messages/new" className="nb-icon-button nb-touch-target" aria-label="New message"><SquarePen size={16} aria-hidden="true" /></Link>
      </header>
      <div className="px-3 pb-2">
        <button
          type="button"
          onClick={() => setSwitcherOpen(true)}
          className="flex h-9 w-full items-center gap-2 rounded-[5px] bg-[var(--muted)] px-3 text-[14px] text-[var(--muted-foreground)]"
        >
          <Search size={14} aria-hidden="true" /> Find a conversation
        </button>
      </div>
      <div className="app-scroll app-scroll-y min-h-0 flex-1 px-2 pb-4">
        <ChatSections projectId={projectId} variant={variant} unreadOnly={unreadOnly} onSelect={onSelect} onCreateChannel={projectId ? onCreateChannel : undefined} onInvite={onInvite} />
      </div>
    </div>
  );
}

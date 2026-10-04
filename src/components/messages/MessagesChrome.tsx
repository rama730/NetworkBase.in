"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";

import { useChatUi } from "@/components/messages/chat-ui-store";
import { useChatShell } from "@/components/messages/ChatShellProvider";
import { QuickSwitcher } from "@/components/messages/QuickSwitcher";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { markRead, markReadMany } from "@/app/actions/chat/read";
import { escapeTaken, isTypingTarget } from "@/components/messages/keys";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { isUnread, needsAttention, sidebarOrder } from "@/lib/messaging/channel-view";
import { chatErrorMessage } from "@/lib/messaging/errors";
import { conversationHref } from "@/lib/messaging/routes";
import type { ChatChannelSummary } from "@/lib/messaging/types";

const CreateChannelDialog = dynamic(() => import("@/components/messages/CreateChannelDialog").then((m) => m.CreateChannelDialog), { ssr: false });
const InviteCollaboratorModal = dynamic(() => import("@/components/projects/dashboard/InviteCollaboratorModal"), { ssr: false });

/** A drawer (thread or details) is open: Escape closes it, nothing else. */
function drawerOpen() {
  const params = new URLSearchParams(window.location.search);
  return params.has("thread") || params.has("details");
}

/**
 * ⌘K switcher, Alt+↑/↓ next conversation needing attention (sidebar order), Shift+Esc mark the
 * visible list read (confirmed), Esc mark the open conversation read. None fire while typing.
 */
function useMessagesKeyboardShortcuts(confirmMarkAll: (rows: ChatChannelSummary[]) => void) {
  const router = useRouter();
  const pathname = usePathname();
  const { data, refresh, applyRead } = useChatShell();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        useChatUi.getState().setSwitcherOpen(true);
        return;
      }
      // Text fields keep their keys (Alt+↑/↓ moves the caret on macOS); dialogs and menus keep Escape.
      if (isTypingTarget(e.target) || escapeTaken(e)) return;
      const projectId = useChatUi.getState().projectId ?? null;
      const currentId = pathname.match(/\/messages\/([0-9a-fA-F-]{36})/)?.[1];

      if (e.altKey && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
        const list = sidebarOrder(data, projectId).filter((c) => needsAttention(c) || c.id === currentId);
        const at = list.findIndex((c) => c.id === currentId);
        const next = list.filter((c) => c.id !== currentId);
        if (!next.length) return;
        e.preventDefault();
        const step = e.key === "ArrowDown" ? 1 : -1;
        const target = at < 0 ? (step > 0 ? list[0] : list[list.length - 1]) : list[(at + step + list.length) % list.length];
        if (target && target.id !== currentId) router.push(conversationHref(target.id));
        return;
      }

      if (e.shiftKey && e.key === "Escape") {
        const rows = sidebarOrder(data, projectId).filter(isUnread);
        if (!rows.length) return;
        e.preventDefault();
        confirmMarkAll(rows);
        return;
      }

      if (e.key === "Escape" && !drawerOpen()) {
        const current = data?.channels.find((c) => c.id === currentId);
        if (!current || !isUnread(current)) return;
        e.preventDefault();
        applyRead(current.id, current.last_seq);
        void markRead({ channelId: current.id, seq: current.last_seq }).then((result) => {
          if (!result.success) {
            refresh();
            return void toast.error(chatErrorMessage(result.error));
          }
          toast.success("Conversation marked as read");
        });
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [applyRead, confirmMarkAll, data, pathname, refresh, router]);
}

function useKeyboardSafeHeight() {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const root = document.documentElement;
    const sync = () => root.style.setProperty("--chat-vvh", `${Math.round(viewport.height)}px`);
    sync();
    viewport.addEventListener("resize", sync);
    return () => {
      viewport.removeEventListener("resize", sync);
      root.style.removeProperty("--chat-vvh");
    };
  }, []);
}

/** Dialogs shared by every /messages screen; opened through the chat UI store. */
export function MessagesChrome() {
  useKeyboardSafeHeight();
  const [markAll, setMarkAll] = useState<ChatChannelSummary[] | null>(null);
  useMessagesKeyboardShortcuts(useCallback((rows: ChatChannelSummary[]) => setMarkAll(rows), []));
  const createFor = useChatUi((state) => state.createChannelFor);
  const setCreateFor = useChatUi((state) => state.setCreateChannelFor);
  const inviteFor = useChatUi((state) => state.inviteFor);
  const setInviteFor = useChatUi((state) => state.setInviteFor);
  const { data, refresh, applyRead } = useChatShell();
  const confirmMarkAll = async () => {
    const rows = markAll ?? [];
    rows.forEach((c) => applyRead(c.id, c.last_seq));
    const result = await markReadMany({ items: rows.map((c) => ({ channelId: c.id, seq: c.last_seq })) });
    refresh();
    if (!result.success) return void toast.error(chatErrorMessage(result.error));
    toast.success(`${rows.length} conversation${rows.length === 1 ? "" : "s"} marked as read`);
  };
  const inviteProject = data?.projects?.find((p) => p.id === inviteFor) ?? null;
  return (
    <>
      <QuickSwitcher />
      <ConfirmDialog
        open={Boolean(markAll)}
        onOpenChange={(open) => !open && setMarkAll(null)}
        title="Mark everything here as read?"
        description={markAll ? `${markAll.length} conversation${markAll.length === 1 ? "" : "s"} in this list will be marked as read.` : undefined}
        confirmLabel="Mark as read"
        onConfirm={confirmMarkAll}
      />
      {createFor ? <CreateChannelDialog projectId={createFor} open onOpenChange={(open) => !open && setCreateFor(null)} /> : null}
      {inviteProject ? (
        <InviteCollaboratorModal
          isOpen
          onClose={() => {
            setInviteFor(null);
            refresh();
          }}
          projectId={inviteProject.id}
          projectTitle={inviteProject.title}
          canAppointGuidance={inviteProject.role === "owner"}
        />
      ) : null}
    </>
  );
}

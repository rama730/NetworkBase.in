"use client";

import dynamic from "next/dynamic";
import { useEffect } from "react";

import { restoredWorkspace, useChatUi } from "@/components/messages/chat-ui-store";
import { useSelectedWorkspace } from "@/components/messages/useSelectedWorkspace";
import { useChatShell } from "@/components/messages/ChatShellProvider";
import { QuickSwitcher } from "@/components/messages/QuickSwitcher";
import { ShortcutsDialog } from "@/components/messages/ShortcutsDialog";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "@/lib/feedback";
import { markRead } from "@/app/actions/chat/read";
import { escapeTaken, isTypingTarget } from "@/components/messages/keys";
import { useMarkAllRead } from "@/components/messages/useMarkAllRead";
import { isUnread, MARK_ALL_LABEL, needsAttention, sidebarOrder } from "@/lib/messaging/channel-view";
import { chatErrorMessage } from "@/lib/messaging/errors";
import { conversationHref } from "@/lib/messaging/routes";
import type { ChatChannelSummary } from "@/lib/messaging/types";

const CreateChannelDialog = dynamic(() => import("@/components/messages/CreateChannelDialog").then((m) => m.CreateChannelDialog), { ssr: false });
const InviteCollaboratorModal = dynamic(() => import("@/components/workspaces/dashboard/InviteCollaboratorModal"), { ssr: false });

/** A drawer (thread or details) is open: Escape closes it, nothing else. */
function drawerOpen() {
  const params = new URLSearchParams(window.location.search);
  return params.has("thread") || params.has("details");
}

/**
 * ⌘J switcher, ⌘/ shortcuts, Alt+↑/↓ next conversation needing attention (sidebar order), Shift+Esc mark the
 * visible list read (asks first above 5), Esc mark the open conversation read. None fire while typing.
 */
function useMessagesKeyboardShortcuts(confirmMarkAll: (rows: ChatChannelSummary[], label?: string) => void) {
  const router = useRouter();
  const pathname = usePathname();
  const { data, refresh, applyRead } = useChatShell();
  const projectId = useSelectedWorkspace();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // ⌘K is the one search everywhere (global search decision 5); the chat switcher keeps its own key, ⌘J.
      if ((e.metaKey || e.ctrlKey) && (e.key === "j" || e.key === "J")) {
        e.preventDefault();
        useChatUi.getState().setSwitcherOpen(true);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "/") {
        e.preventDefault();
        useChatUi.getState().setShortcutsOpen(true);
        return;
      }
      // Text fields keep their keys (Alt+↑/↓ moves the caret on macOS); dialogs and menus keep Escape.
      if (isTypingTarget(e.target) || escapeTaken(e)) return;
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
        // The same rows the sidebar shows as needing you (muted ones stay as they are).
        const rows = sidebarOrder(data, projectId).filter(needsAttention);
        if (!rows.length) return;
        e.preventDefault();
        const project = data?.projects?.find((p) => p.id === projectId);
        confirmMarkAll(rows, project ? `Mark ${project.title} and your DMs read` : MARK_ALL_LABEL);
        return;
      }

      if (e.key === "Escape" && !drawerOpen()) {
        const current = data?.channels.find((c) => c.id === currentId);
        if (!current || !isUnread(current)) return;
        e.preventDefault();
        applyRead(current.id, current.last_seq);
        // The bold going away is the feedback; only a failure toasts.
        void markRead({ channelId: current.id, seq: current.last_seq }).then((result) => {
          if (result.success) return;
          refresh();
          toast.error(chatErrorMessage(result.error));
        });
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [applyRead, confirmMarkAll, data, pathname, projectId, refresh, router]);
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

/** Every /messages screen: the keys above, the ⌘J switcher, and the shared dialogs (opened through the chat UI store). */
export function MessagesChrome() {
  useKeyboardSafeHeight();
  // A reload keeps the project picked earlier in this tab (pages whose URL has no project).
  useEffect(() => {
    const ui = useChatUi.getState();
    const stored = restoredWorkspace();
    if (ui.projectId === undefined && stored !== undefined) ui.setProject(stored);
  }, []);
  const markAll = useMarkAllRead();
  useMessagesKeyboardShortcuts(markAll.conversations);
  const createFor = useChatUi((state) => state.createChannelFor);
  const setCreateFor = useChatUi((state) => state.setCreateChannelFor);
  const inviteFor = useChatUi((state) => state.inviteFor);
  const setInviteFor = useChatUi((state) => state.setInviteFor);
  const { data, refresh } = useChatShell();
  const inviteProject = data?.projects?.find((p) => p.id === inviteFor) ?? null;
  const shortcutsOpen = useChatUi((state) => state.shortcutsOpen);
  const setShortcutsOpen = useChatUi((state) => state.setShortcutsOpen);
  return (
    <>
      <QuickSwitcher />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      {markAll.dialog}
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

"use client";

import dynamic from "next/dynamic";
import { useEffect } from "react";

import { useChatUi } from "@/components/messages/chat-ui-store";
import { useChatShell } from "@/components/messages/ChatShellProvider";
import { QuickSwitcher } from "@/components/messages/QuickSwitcher";

const CreateChannelDialog = dynamic(() => import("@/components/messages/CreateChannelDialog").then((m) => m.CreateChannelDialog), { ssr: false });
const InviteCollaboratorModal = dynamic(() => import("@/components/projects/dashboard/InviteCollaboratorModal"), { ssr: false });

/** Dialogs shared by every /messages screen; opened through the chat UI store. */
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { markRead, markReadMany } from "@/app/actions/chat/read";
import { isUnread } from "@/lib/messaging/channel-view";

function useMessagesKeyboardShortcuts() {
  const router = useRouter();
  const pathname = usePathname();
  const { data, refresh } = useChatShell();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // 1. Cmd/Ctrl + K: Open Quick Switcher
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        useChatUi.getState().setSwitcherOpen(true);
        return;
      }

      // Do not trigger other global shortcuts when user is typing in inputs or in a dialog
      const target = e.target as HTMLElement | null;
      const isInput = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      const hasModal = Boolean(document.querySelector("[role=dialog]"));

      // 2. Alt + Up / Alt + Down: Jump between unread channels
      if (e.altKey && (e.key === "ArrowDown" || e.key === "ArrowUp") && !hasModal) {
        const unreads = (data?.channels ?? []).filter((c) => isUnread(c) && !c.channel_archived_at);
        if (unreads.length > 0) {
          e.preventDefault();
          const currentId = pathname.match(/\/messages\/([0-9a-fA-F-]+)/)?.[1];
          const currentIdx = unreads.findIndex((c) => c.id === currentId);
          const nextIdx = e.key === "ArrowDown"
            ? (currentIdx + 1) % unreads.length
            : (currentIdx - 1 + unreads.length) % unreads.length;
          const targetChannel = unreads[nextIdx];
          if (targetChannel) {
            router.push(`/messages/${targetChannel.id}`);
          }
        }
        return;
      }

      // 3. Shift + Escape: Mark all channels in project/workspace as read
      if (e.shiftKey && e.key === "Escape" && !hasModal) {
        e.preventDefault();
        const projectId = useChatUi.getState().projectId;
        const toMark = (data?.channels ?? []).filter((c) => (!projectId || c.project_id === projectId) && isUnread(c));
        if (toMark.length > 0) {
          void markReadMany({ items: toMark.map((c) => ({ channelId: c.id, seq: c.last_seq })) }).then(() => {
            refresh();
            toast.success("All channels marked as read");
          });
        }
        return;
      }

      // 4. Escape: Mark current channel read (when not typing in composer)
      if (e.key === "Escape" && !e.shiftKey && !isInput && !hasModal) {
        const currentId = pathname.match(/\/messages\/([0-9a-fA-F-]+)/)?.[1];
        const current = data?.channels.find((c) => c.id === currentId);
        if (current && isUnread(current)) {
          e.preventDefault();
          void markRead({ channelId: current.id, seq: current.last_seq }).then(() => {
            refresh();
            toast.success("Channel marked as read");
          });
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [data, pathname, refresh, router]);
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

export function MessagesChrome() {
  useKeyboardSafeHeight();
  useMessagesKeyboardShortcuts();
  const createFor = useChatUi((state) => state.createChannelFor);
  const setCreateFor = useChatUi((state) => state.setCreateChannelFor);
  const inviteFor = useChatUi((state) => state.inviteFor);
  const setInviteFor = useChatUi((state) => state.setInviteFor);
  const { data, refresh } = useChatShell();
  const inviteProject = data?.projects?.find((p) => p.id === inviteFor) ?? null;
  return (
    <>
      <QuickSwitcher />
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

"use client";

import dynamic from "next/dynamic";
import { useEffect } from "react";

import { useChatUi } from "@/components/messages/chat-ui-store";
import { useChatShell } from "@/components/messages/ChatShellProvider";
import { CreateChannelDialog } from "@/components/messages/CreateChannelDialog";
import { QuickSwitcher } from "@/components/messages/QuickSwitcher";

const InviteCollaboratorModal = dynamic(() => import("@/components/projects/dashboard/InviteCollaboratorModal"), { ssr: false });

/** Dialogs shared by every /messages screen; opened through the chat UI store. */
// ponytail: dvh + visualViewport for the soft keyboard (L-23). ceiling: iOS
// ignores interactive-widget. upgrade: a dedicated keyboard offset hook if a
// device still hides the composer.
/**
 * Browsers that don't shrink the layout viewport for the on-screen keyboard
 * would hide the composer; track visualViewport instead (report 7.12 B11).
 */
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

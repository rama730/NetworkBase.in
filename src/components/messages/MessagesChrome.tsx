"use client";

import dynamic from "next/dynamic";

import { useChatUi } from "@/components/messages/chat-ui-store";
import { useChatShell } from "@/components/messages/ChatShellProvider";
import { CreateChannelDialog } from "@/components/messages/CreateChannelDialog";
import { ProjectSwitcherSheet } from "@/components/messages/ProjectSwitcherSheet";
import { QuickSwitcher } from "@/components/messages/QuickSwitcher";

const InviteCollaboratorModal = dynamic(() => import("@/components/projects/dashboard/InviteCollaboratorModal"), { ssr: false });

/** Dialogs shared by every /messages screen; opened through the chat UI store. */
export function MessagesChrome() {
  const createFor = useChatUi((state) => state.createChannelFor);
  const setCreateFor = useChatUi((state) => state.setCreateChannelFor);
  const inviteFor = useChatUi((state) => state.inviteFor);
  const setInviteFor = useChatUi((state) => state.setInviteFor);
  const { data, refresh } = useChatShell();
  const inviteProject = data?.projects?.find((p) => p.id === inviteFor) ?? null;
  return (
    <>
      <QuickSwitcher />
      <ProjectSwitcherSheet />
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

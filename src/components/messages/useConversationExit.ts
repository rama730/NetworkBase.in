"use client";

import { useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "@/lib/feedback";

import { archiveChannel, joinChannel, leaveChannel, unarchiveChannel } from "@/app/actions/chat/channels";
import { setMemberState } from "@/app/actions/chat/members";
import { useChatShell } from "@/components/messages/ChatShellProvider";
import { chatErrorMessage } from "@/lib/messaging/errors";
import { conversationHref } from "@/lib/messaging/routes";
import { queryKeys } from "@/lib/query-keys";

type ExitTarget = { id: string; project_id: string | null; kind: string; name: string | null };

/**
 * Close (DMs, groups), leave and archive, one way everywhere (header, Details, sidebar row):
 * same destination (the project's home, else /messages) and the same Undo.
 */
export function useConversationExit(channel: ExitTarget) {
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const shell = useChatShell();
  const home = channel.project_id ? `/messages/p/${channel.project_id}` : "/messages";
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.chat.channel(channel.id) });
    shell.refresh();
  };
  // Only move away when that conversation is the one on screen. Replace, not push: Back mustn't
  // lead to the conversation you just left (or its Details on a phone).
  const leaveIfOpen = () => {
    if (pathname?.startsWith(conversationHref(channel.id))) router.replace(home);
  };
  const fail = (error: string | undefined) => {
    toast.error(chatErrorMessage(error));
    return false;
  };

  const close = async () => {
    const result = await setMemberState({ channelId: channel.id, archived: true });
    if (!result.success) return fail(result.error);
    refresh();
    leaveIfOpen();
    toast.success("Conversation closed", {
      action: {
        label: "Undo",
        onClick: () => void setMemberState({ channelId: channel.id, archived: false }).then((undo) => {
          if (!undo.success) return void toast.error(chatErrorMessage(undo.error));
          refresh();
          router.push(conversationHref(channel.id));
        }),
      },
    });
    return true;
  };

  const leave = async () => {
    const result = await leaveChannel({ channelId: channel.id });
    if (!result.success) return fail(result.error);
    refresh();
    leaveIfOpen();
    // Public channels can be rejoined straight away; private ones need an invite.
    toast.success(`You left ${channel.name ? `#${channel.name}` : "the conversation"}`, channel.kind === "public" ? {
      action: {
        label: "Undo",
        onClick: () => void joinChannel({ channelId: channel.id }).then((undo) => {
          if (!undo.success) return void toast.error(chatErrorMessage(undo.error));
          refresh();
          router.push(conversationHref(channel.id));
        }),
      },
    } : undefined);
    return true;
  };

  const unarchive = async () => {
    const result = await unarchiveChannel({ channelId: channel.id });
    if (!result.success) return fail(result.error);
    refresh();
    toast.success("Channel unarchived");
    return true;
  };

  // Archived channels stay readable in place (with Unarchive), so nothing navigates.
  const archive = async () => {
    const result = await archiveChannel({ channelId: channel.id });
    if (!result.success) return fail(result.error);
    refresh();
    toast.success("Channel archived", { action: { label: "Undo", onClick: () => void unarchive() } });
    return true;
  };

  return { close, leave, archive, unarchive };
}

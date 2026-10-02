"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { readChatUi } from "@/components/messages/chat-ui-store";
import { useChatShell } from "@/components/messages/ChatShellProvider";
import { ListOrHome } from "@/components/messages/HomePane";

/** /messages: the List screen below 1024px; at 1024px+ the last-open conversation, else Home. */
export function MessagesIndex() {
  const router = useRouter();
  const { data } = useChatShell();
  useEffect(() => {
    if (!data || !window.matchMedia("(min-width: 1024px)").matches) return;
    const last = readChatUi().last;
    if (last && data.channels.some((channel) => channel.id === last)) router.replace(`/messages/${last}`);
  }, [data, router]);
  return <ListOrHome />;
}

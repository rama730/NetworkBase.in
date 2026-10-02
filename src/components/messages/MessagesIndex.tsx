"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { readChatUi } from "@/components/messages/chat-ui-store";
import { useChatShell } from "@/components/messages/ChatShellProvider";
import { ListScreen } from "@/components/messages/ListScreen";
import { HomePane } from "@/components/messages/HomePane";

/** /messages: the List screen below 1024px; at 1024px+ the last-open conversation, else Home. */
export function MessagesIndex() {
  const router = useRouter();
  const { data } = useChatShell();
  useEffect(() => {
    if (!data || !window.matchMedia("(min-width: 1024px)").matches) return;
    const last = readChatUi().last;
    if (last && data.channels.some((channel) => channel.id === last)) router.replace(`/messages/${last}`);
  }, [data, router]);
  return (
    <div data-scroll-root="route" className="h-full min-h-0 overflow-hidden">
      <div className="h-full lg:hidden"><ListScreen /></div>
      <div className="hidden h-full lg:block"><HomePane /></div>
    </div>
  );
}

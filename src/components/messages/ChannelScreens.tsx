"use client";

import { useSearchParams } from "next/navigation";

import { ChatDrawer } from "@/components/messages/ChatDrawer";
import { ConversationView } from "@/components/messages/ConversationView";
import { usePanes } from "@/components/messages/usePanes";

/** The conversation, plus the thread/details drawer when ?thread= or ?details= is set. */
export function ChannelScreen({ channelId }: { channelId: string }) {
  const params = useSearchParams();
  const panes = usePanes(channelId);
  // ?thread=5&m=12 points at reply 12 in the thread: the timeline stays where it is (no jump).
  const around = panes.thread ? null : Number(params?.get("m")) || null;
  return (
    <div className="flex h-full min-h-0">
      <div className="h-full min-w-0 flex-1">
        <ConversationView key={channelId} channelId={channelId} around={around} />
      </div>
      {panes.thread || panes.details ? <ChatDrawer channelId={channelId} /> : null}
    </div>
  );
}

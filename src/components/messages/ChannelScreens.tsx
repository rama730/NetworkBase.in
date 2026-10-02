"use client";

import { useSearchParams } from "next/navigation";

import { ChatDrawer } from "@/components/messages/ChatDrawer";
import { ConversationView } from "@/components/messages/ConversationView";
import { DetailsPane } from "@/components/messages/DetailsPane";
import { ThreadPane } from "@/components/messages/ThreadPane";
import { useChannelDetails } from "@/components/messages/useConversation";
import { useAuth } from "@/hooks/useAuth";
import { channelTitle } from "@/lib/messaging/channel-view";

export function ChannelScreen({ channelId }: { channelId: string }) {
  const params = useSearchParams();
  const around = Number(params?.get("m")) || null;
  return <ConversationView key={channelId} channelId={channelId} around={around} />;
}

function useSubtitle(channelId: string) {
  const { user } = useAuth();
  const details = useChannelDetails(channelId);
  if (!details.data) return undefined;
  const title = channelTitle(details.data, user?.id ?? null);
  return details.data.name ? `#${title}` : title;
}

export function ThreadScreen({ channelId, rootSeq }: { channelId: string; rootSeq: number }) {
  const subtitle = useSubtitle(channelId);
  return (
    <ChatDrawer channelId={channelId} title="Thread" subtitle={subtitle}>
      <ThreadPane key={`${channelId}:${rootSeq}`} channelId={channelId} rootSeq={rootSeq} />
    </ChatDrawer>
  );
}

export function DetailsScreen({ channelId }: { channelId: string }) {
  const subtitle = useSubtitle(channelId);
  return (
    <ChatDrawer channelId={channelId} title="Details" subtitle={subtitle}>
      <DetailsPane channelId={channelId} />
    </ChatDrawer>
  );
}

"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { ConversationSkeleton } from "@/components/messages/ConversationSkeleton";
import { ChatDrawer } from "@/components/messages/ChatDrawer";
import { ConversationView } from "@/components/messages/ConversationView";
import { usePanes } from "@/components/messages/usePanes";
import { useMessageTarget } from "@/components/messages/useConversation";
import { conversationHref } from "@/lib/messaging/routes";
import { ErrorNotice } from "@/components/ui/ErrorNotice";

/** Resolve old/incomplete message links before selecting the timeline or thread. */
export function ChannelScreen({ channelId }: { channelId: string }) {
  const params = useSearchParams();
  const search = params?.toString() ?? "";
  const router = useRouter();
  const panes = usePanes(channelId);
  const target = useMessageTarget(channelId, panes.m);
  const resolved = panes.m ? target.data : undefined;
  const thread = resolved ? (resolved.threadRootSeq ?? (panes.thread === panes.m ? panes.thread : null)) : panes.thread;
  const lastReplacedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!resolved) return;
    const href = conversationHref(channelId, { thread, tab: null }, search);
    const current = `/messages/${channelId}${search ? `?${search}` : ""}`;
    if (href !== current && lastReplacedRef.current !== href) {
      lastReplacedRef.current = href;
      router.replace(href, { scroll: false });
    }
  }, [channelId, resolved, thread, search, router]);
  if (panes.m && (target.isPending || (resolved && thread !== panes.thread))) return <ConversationSkeleton />;
  const around = resolved && !resolved.threadRootSeq ? panes.m : null;
  return (
    <div className="flex h-full min-h-0">
      <div className="flex h-full min-w-0 flex-1 flex-col">
        {target.isError && panes.m ? (
          target.error.message === "chat_message_not_found"
            ? <p role="alert" className="p-3 text-[13px] text-muted-foreground">That message is unavailable. It may have been deleted or you may no longer have access.</p>
            : <ErrorNotice what="This message" onRetry={() => void target.refetch()} />
        ) : null}
        <div className="min-h-0 flex-1"><ConversationView key={channelId} channelId={channelId} around={around} /></div>
      </div>
      {(panes.thread || panes.details) && (!panes.m || Boolean(resolved) || target.isError) ? <ChatDrawer channelId={channelId} /> : null}
    </div>
  );
}

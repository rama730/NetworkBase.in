"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "@/lib/feedback";

import { getOrCreateDm } from "@/app/actions/chat/members";
import { Button } from "@/components/ui/button";
import { conversationHref } from "@/lib/messaging/routes";

import { useChatUi } from "@/components/messages/chat-ui-store";
import { ListOrHome } from "@/components/messages/HomePane";
import { chatErrorMessage } from "@/lib/messaging/errors";

/**
 * /messages: the List screen below 1024px; Home at 1024px+. `dmError`: a ?userId= link that couldn't open its DM.
 * `dmIntent`: a ?userId= link with no DM yet; the conversation is created only when the person confirms.
 */
export function MessagesIndex({ dmError = null, dmIntent = null }: { dmError?: string | null; dmIntent?: { userId: string; displayName: string | null } | null }) {
  const [starting, setStarting] = useState(false);
  const setProject = useChatUi((state) => state.setProject);
  const router = useRouter();

  useEffect(() => {
    // When visiting /messages, show full projects list by resetting any previously chosen project
    setProject(null);
  }, [setProject]);

  useEffect(() => {
    if (!dmError) return;
    toast.error(chatErrorMessage(dmError));
    // Drop ?userId= so a reload doesn't retry and toast again.
    router.replace("/messages");
  }, [dmError, router]);

  const startConversation = async () => {
    if (!dmIntent || starting) return;
    setStarting(true);
    const dm = await getOrCreateDm({ userId: dmIntent.userId });
    if (dm.success) {
      router.push(conversationHref(dm.channelId));
      return;
    }
    setStarting(false);
    toast.error(chatErrorMessage(dm.error));
    router.replace("/messages");
  };

  return (
    <>
      {dmIntent ? (
        <div role="status" className="m-3 flex items-center justify-between gap-3 rounded-md border border-border bg-card p-3">
          <p className="nb-compact text-foreground">
            Start a conversation with <strong>{dmIntent.displayName ?? "this person"}</strong>?
          </p>
          <div className="flex shrink-0 gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => router.replace("/messages")} disabled={starting}>Not now</Button>
            <Button type="button" size="sm" onClick={startConversation} disabled={starting}>{starting ? "Opening…" : "Message"}</Button>
          </div>
        </div>
      ) : null}
      <ListOrHome />
    </>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { toast } from "sonner";

import { useChatUi } from "@/components/messages/chat-ui-store";
import { ListOrHome } from "@/components/messages/HomePane";
import { chatErrorMessage } from "@/lib/messaging/errors";

/** /messages: the List screen below 1024px; Home at 1024px+. `dmError`: a ?userId= link that couldn't open its DM. */
export function MessagesIndex({ dmError = null }: { dmError?: string | null }) {
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

  return <ListOrHome />;
}

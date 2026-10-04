"use client";

import { useEffect } from "react";

import { useChatUi } from "@/components/messages/chat-ui-store";
import { ListOrHome } from "@/components/messages/HomePane";

/** /messages: the List screen below 1024px; at 1024px+ shows all projects with professional placeholder. */
export function MessagesIndex() {
  const setProject = useChatUi((state) => state.setProject);

  useEffect(() => {
    // When visiting /messages, show full projects list by resetting any previously chosen project
    setProject(null);
  }, [setProject]);

  return <ListOrHome />;
}

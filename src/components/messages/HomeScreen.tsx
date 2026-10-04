"use client";

import { useEffect } from "react";

import { useChatUi } from "@/components/messages/chat-ui-store";
import { ListOrHome } from "@/components/messages/HomePane";

/** /messages/home: selects Home (DMs, Activity, Threads, your applications). */
export function HomeScreen() {
  const setProject = useChatUi((state) => state.setProject);
  useEffect(() => setProject(null), [setProject]);
  return <ListOrHome />;
}

"use client";

import { useEffect } from "react";

import { useChatUi } from "@/components/messages/chat-ui-store";
import { HomePane } from "@/components/messages/HomePane";
import { ListScreen } from "@/components/messages/ListScreen";

/** /messages/home: selects Home (DMs, Activity, Threads, your applications). */
export function HomeScreen() {
  const setProject = useChatUi((state) => state.setProject);
  useEffect(() => setProject(null), [setProject]);
  return (
    <>
      <div className="h-full lg:hidden"><ListScreen /></div>
      <div className="hidden h-full lg:block"><HomePane /></div>
    </>
  );
}

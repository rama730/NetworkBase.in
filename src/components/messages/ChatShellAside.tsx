"use client";

import { useChatUi } from "@/components/messages/chat-ui-store";
import { ChatRail } from "@/components/messages/ChatRail";
import { ChatSidebar } from "@/components/messages/ChatSidebar";
import { useSelectedProject } from "@/components/messages/useSelectedProject";

/** Replaces the global sidebar on /messages*: 64px rail + 248px sidebar (D2). Hidden below 768px by .nb-sidebar. */
export default function ChatShellAside() {
  const projectId = useSelectedProject();
  const setCreateFor = useChatUi((state) => state.setCreateChannelFor);
  const setInviteFor = useChatUi((state) => state.setInviteFor);
  return (
    <aside className="nb-sidebar nb-chat-aside" id="application-sidebar" aria-label="Messages navigation" data-messages-surface>
      <ChatRail onCreateChannel={() => projectId && setCreateFor(projectId)} />
      <div className="nb-chat-sidebar">
        <ChatSidebar variant="sidebar" onCreateChannel={() => projectId && setCreateFor(projectId)} onInvite={() => projectId && setInviteFor(projectId)} />
      </div>
    </aside>
  );
}

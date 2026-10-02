"use client";

import { useChatUi } from "@/components/messages/chat-ui-store";
import { ChatSidebar } from "@/components/messages/ChatSidebar";
import { useSelectedProject } from "@/components/messages/useSelectedProject";

// ponytail: tablets (768–1023px) use the single-pane pattern (L-22).
// upgrade: show this sidebar from ~900px if tablet data shows wasted space.
/**
 * The chat sidebar inside /messages at 1024px+, to the right of the app's own
 * navigation. Below 1024px the List screen takes its place in the main pane.
 */
export function MessagesSidebar() {
  const projectId = useSelectedProject();
  const setCreateFor = useChatUi((state) => state.setCreateChannelFor);
  const setInviteFor = useChatUi((state) => state.setInviteFor);
  return (
    <aside className="hidden h-full w-[260px] flex-none flex-col border-r border-border bg-card lg:flex" aria-label="Conversations">
      <ChatSidebar variant="sidebar" onCreateChannel={() => projectId && setCreateFor(projectId)} onInvite={() => projectId && setInviteFor(projectId)} />
    </aside>
  );
}

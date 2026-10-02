"use client";

import Link from "next/link";
import { useEffect } from "react";
import { ArrowLeft, ExternalLink, Minus, X } from "lucide-react";

import { useChatWindow } from "@/components/messages/chat-window-store";
import { ConversationView } from "@/components/messages/ConversationView";
import { ListScreen } from "@/components/messages/ListScreen";
import { NewMessage } from "@/components/messages/NewMessage";
import { ProjectSwitcherSheet } from "@/components/messages/ProjectSwitcherSheet";
import { QuickSwitcher } from "@/components/messages/QuickSwitcher";
import { ThreadPane } from "@/components/messages/ThreadPane";

/**
 * 400px window above the launcher (C4/C5): the mobile List screen first, then
 * a conversation, then a thread, each with Back. Non-modal; Esc minimizes.
 */
export default function ChatWindow({ onMinimize }: { onMinimize: () => void }) {
  const stack = useChatWindow((state) => state.stack);
  const push = useChatWindow((state) => state.push);
  const back = useChatWindow((state) => state.back);
  const close = useChatWindow((state) => state.close);
  const screen = stack[stack.length - 1] ?? { type: "list" as const };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.querySelector("[role=dialog]")) onMinimize();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onMinimize]);

  const openChannel = (channelId: string) => push({ type: "channel", channelId });
  const fullHref = screen.type === "channel" || screen.type === "thread" ? `/messages/${screen.channelId}` : "/messages";
  const title = screen.type === "thread" ? "Thread" : screen.type === "new" ? "New message" : "Messages";
  const actions = (
    <>
      <Link href={fullHref} onClick={close} className="nb-icon-button nb-touch-target" aria-label="Open full page"><ExternalLink size={16} /></Link>
      <button type="button" onClick={onMinimize} className="nb-icon-button nb-touch-target" aria-label="Minimize"><Minus size={16} /></button>
      <button type="button" onClick={close} className="nb-icon-button nb-touch-target" aria-label="Close"><X size={16} /></button>
    </>
  );

  return (
    <section
      id="chat-window"
      aria-label="Messages window"
      data-messages-surface
      data-testid="chat-window"
      className="fixed bottom-[5.5rem] right-6 z-30 flex h-[min(640px,calc(100dvh-5.5rem))] w-[min(400px,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-md"
    >
      {screen.type === "channel" ? null : (
        <header className="flex h-14 flex-none items-center gap-1 border-b border-border px-2">
          {stack.length > 1 ? <button type="button" onClick={back} className="nb-icon-button nb-touch-target" aria-label="Back"><ArrowLeft size={18} /></button> : null}
          <h2 className="min-w-0 flex-1 truncate px-1 text-[15px] font-semibold">{title}</h2>
          {actions}
        </header>
      )}
      <div className="min-h-0 flex-1">
        {screen.type === "list" ? <ListScreen onSelect={openChannel} onNewMessage={() => push({ type: "new" })} /> : null}
        {screen.type === "new" ? <NewMessage onOpen={openChannel} /> : null}
        {screen.type === "channel" ? (
          <ConversationView
            key={screen.channelId}
            channelId={screen.channelId}
            surface="window"
            onBack={back}
            onOpenThread={(rootSeq) => push({ type: "thread", channelId: screen.channelId, rootSeq })}
            windowActions={actions}
          />
        ) : null}
        {screen.type === "thread" ? <ThreadPane key={`${screen.channelId}:${screen.rootSeq}`} channelId={screen.channelId} rootSeq={screen.rootSeq} /> : null}
      </div>
      <QuickSwitcher onSelect={openChannel} />
      <ProjectSwitcherSheet />
    </section>
  );
}

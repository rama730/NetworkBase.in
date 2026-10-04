"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { ArrowLeft, ExternalLink, Minus, X } from "lucide-react";

import { useChatWindow } from "@/components/messages/chat-window-store";
import { ConversationView } from "@/components/messages/ConversationView";
import { ListScreen } from "@/components/messages/ListScreen";
import { InboxView } from "@/components/messages/MessagesViews";
import { NewMessage } from "@/components/messages/NewMessage";
import { QuickSwitcher } from "@/components/messages/QuickSwitcher";
import { ThreadPane } from "@/components/messages/ThreadPane";
import { editingWithText, escapeTaken } from "@/components/messages/keys";
import { WindowNavContext } from "@/components/messages/window-nav";
import { threadHref } from "@/lib/messaging/routes";

// ponytail: fixed size and position, no shortcut, no auto-open (L-26).
// upgrade: a movable window or shortcut when power users ask.
/**
 * 400px window above the launcher (C4/C5): the mobile List screen first, then
 * a conversation, then a thread, each with Back. Non-modal; Esc minimizes.
 */
export default function ChatWindow({ onMinimize, onClose }: { onMinimize: () => void; onClose: () => void }) {
  const stack = useChatWindow((state) => state.stack);
  const push = useChatWindow((state) => state.push);
  const back = useChatWindow((state) => state.back);
  const screen = stack[stack.length - 1] ?? { type: "list" as const };
  const ref = useRef<HTMLElement>(null);

  // Opening moves focus into the window (unless a field inside already took it); Close/Minimize return it to the launcher.
  useEffect(() => {
    const node = ref.current;
    if (node && !node.contains(document.activeElement)) node.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Not while typing unsent text or closing a menu/dialog (the keystroke belongs to them).
      if (event.key === "Escape" && !escapeTaken(event) && !editingWithText(event.target)) onMinimize();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onMinimize]);

  const openChannel = (channelId: string) => push({ type: "channel", channelId });
  const openItem = (channelId: string, rootSeq: number | null) => push(rootSeq ? { type: "thread", channelId, rootSeq } : { type: "channel", channelId });
  const fullHref = screen.type === "thread" ? threadHref(screen.channelId, screen.rootSeq) : screen.type === "inbox" ? "/messages/inbox" : "/messages";
  const title = screen.type === "thread" ? "Thread" : "New message";
  // Minimize and Close everywhere; "Open in Messages" here, or in the conversation's ⋯.
  const controls = (
    <>
      <button type="button" onClick={onMinimize} className="nb-icon-button nb-touch-target" aria-label="Minimize"><Minus size={16} /></button>
      <button type="button" onClick={onClose} className="nb-icon-button nb-touch-target" aria-label="Close"><X size={16} /></button>
    </>
  );
  const actions = (
    <>
      <Link href={fullHref} onClick={onClose} className="nb-icon-button nb-touch-target" aria-label="Open in Messages" title="Open in Messages"><ExternalLink size={16} /></Link>
      {controls}
    </>
  );

  return (
    <section
      ref={ref}
      tabIndex={-1}
      id="chat-window"
      aria-label="Messages window"
      data-messages-surface
      data-testid="chat-window"
      className="fixed bottom-[5.5rem] right-6 z-30 flex outline-none h-[min(640px,calc(100dvh-5.5rem))] w-[min(400px,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-md"
    >
      {/* The list, Inbox and conversation screens carry their own header (one header, not two). */}
      {screen.type === "list" || screen.type === "inbox" || screen.type === "channel" ? null : (
        <header className="flex h-14 flex-none items-center gap-1 border-b border-border px-2">
          {stack.length > 1 ? <button type="button" onClick={back} className="nb-icon-button nb-touch-target" aria-label="Back"><ArrowLeft size={18} /></button> : null}
          <h2 className="min-w-0 flex-1 truncate px-1 text-[15px] font-semibold">{title}</h2>
          {actions}
        </header>
      )}
      <div className="min-h-0 flex-1">
        {screen.type === "list" ? <ListScreen onSelect={openChannel} onNewMessage={() => push({ type: "new" })} onInbox={() => push({ type: "inbox" })} actions={actions} /> : null}
        {screen.type === "inbox" ? (
          <WindowNavContext.Provider value={{ open: openItem, back, actions }}>
            <InboxView />
          </WindowNavContext.Provider>
        ) : null}
        {screen.type === "new" ? <NewMessage onOpen={openChannel} /> : null}
        {screen.type === "channel" ? (
          <ConversationView
            key={screen.channelId}
            channelId={screen.channelId}
            surface="window"
            onBack={back}
            onOpenThread={(rootSeq) => push({ type: "thread", channelId: screen.channelId, rootSeq })}
            windowActions={controls}
          />
        ) : null}
        {screen.type === "thread" ? <ThreadPane key={`${screen.channelId}:${screen.rootSeq}`} channelId={screen.channelId} rootSeq={screen.rootSeq} /> : null}
      </div>
      <QuickSwitcher onSelect={openChannel} />
    </section>
  );
}

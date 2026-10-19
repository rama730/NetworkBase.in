"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useChatShell } from "@/components/messages/ChatShellProvider";
import { useAuth } from "@/hooks/useAuth";
import { channelTitle } from "@/lib/messaging/channel-view";
import { ArrowLeft, ExternalLink, Minus, X } from "lucide-react";

import { useChatWindow } from "@/components/messages/chat-window-store";
import { useMessageTarget } from "@/components/messages/useConversation";
import { ConversationSkeleton } from "@/components/messages/ConversationSkeleton";
import { ConversationView } from "@/components/messages/ConversationView";
import { ListScreen } from "@/components/messages/ListScreen";
import { InboxView } from "@/components/messages/MessagesViews";
import { NewMessage } from "@/components/messages/NewMessage";
import { QuickSwitcher } from "@/components/messages/QuickSwitcher";
import { ThreadPane } from "@/components/messages/ThreadPane";
import { editingWithText, escapeTaken } from "@/components/messages/keys";
import { WindowNavContext } from "@/components/messages/window-nav";
import { conversationHref } from "@/lib/messaging/routes";

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
  const rawScreen = stack[stack.length - 1] ?? { type: "list" as const };
  const located = useMessageTarget("channelId" in rawScreen ? rawScreen.channelId : "", "m" in rawScreen ? rawScreen.m ?? null : null);
  const screen = located.data && "channelId" in rawScreen
    ? located.data.threadRootSeq ? { type: "thread" as const, channelId: rawScreen.channelId, rootSeq: located.data.threadRootSeq, m: located.data.seq }
      : { type: "channel" as const, channelId: rawScreen.channelId, m: located.data.seq }
    : rawScreen;
  const ref = useRef<HTMLElement>(null);

  // Opening moves focus into the window (unless a field inside already took it); Close/Minimize return it to the launcher.
  useEffect(() => {
    const node = ref.current;
    if (node && !node.contains(document.activeElement)) node.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Only from inside the window (Esc elsewhere on the page isn't for it), and not while typing
      // unsent text or closing a menu/dialog (the keystroke belongs to them).
      if (event.key !== "Escape" || !ref.current?.contains(document.activeElement)) return;
      if (!escapeTaken(event) && !editingWithText(event.target)) onMinimize();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onMinimize]);

  const openChannel = (channelId: string) => push({ type: "channel", channelId });
  // A thread reply from the Inbox opens its thread at that reply.
  const openItem = (channelId: string, rootSeq: number | null, m?: number | null) => push(rootSeq ? { type: "thread", channelId, rootSeq, m: m ?? null } : { type: "channel", channelId, m: m ?? null });
  // The thread's Follow and ⋯ go in this header (one header row, not two).
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  // "Open in Messages" keeps where you are (a thread, or the people picked for a new message).
  const fullHref = screen.type === "thread" ? conversationHref(screen.channelId, { thread: screen.rootSeq, m: screen.m }) : screen.type === "channel" ? conversationHref(screen.channelId, { m: screen.m }) : screen.type === "inbox" ? "/messages/inbox" : screen.type === "new" ? "/messages/new" : "/messages";
  const shell = useChatShell();
  const { user } = useAuth();
  const threadChannel = screen.type === "thread" ? shell.data?.channels.find((c) => c.id === screen.channelId) : undefined;
  const title = screen.type === "thread"
    ? threadChannel ? `Thread in ${threadChannel.name ? `#${threadChannel.name}` : channelTitle(threadChannel, user?.id ?? null)}` : "Thread"
    : "New message";
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
          {stack.length > 1 ? <button type="button" onClick={back} className="nb-icon-button nb-touch-target" aria-label="Back"><ArrowLeft size={16} /></button> : null}
          <h2 className="nb-card-title min-w-0 flex-1 truncate px-1">{title}</h2>
          {screen.type === "thread" ? <div ref={setSlot} className="flex flex-none items-center gap-1" /> : null}
          {actions}
        </header>
      )}
      <div className="min-h-0 flex-1">
        {located.isError ? <p role="alert" className="p-3 text-[13px]">That message is unavailable.</p> : null}
        {"m" in rawScreen && rawScreen.m && located.isPending ? <ConversationSkeleton /> : <>

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
            around={screen.m ?? null}
            surface="window"
            onBack={back}
            onOpenThread={(rootSeq) => push({ type: "thread", channelId: screen.channelId, rootSeq })}
            windowActions={controls}
          />
        ) : null}
        {screen.type === "thread" ? <ThreadPane key={`${screen.channelId}:${screen.rootSeq}`} channelId={screen.channelId} rootSeq={screen.rootSeq} focusSeq={screen.m ?? null} headerSlot={slot} autoFocus surface="window" onShowInConversation={() => useChatWindow.setState((state) => ({ stack: [...state.stack.slice(0, -1), { type: "channel", channelId: screen.channelId, m: screen.rootSeq }] }))} /> : null}
        </>}
      </div>
      <QuickSwitcher onSelect={openChannel} />
    </section>
  );
}

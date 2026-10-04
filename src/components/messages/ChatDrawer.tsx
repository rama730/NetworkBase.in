"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, X } from "lucide-react";

import { usePanes } from "@/components/messages/usePanes";
import { useChannelDetails } from "@/components/messages/useConversation";
import { useAuth } from "@/hooks/useAuth";
import { channelTitle } from "@/lib/messaging/channel-view";
import { editingWithText, escapeTaken, rovingTabKey } from "@/components/messages/keys";
import { showInConversationHref } from "@/lib/messaging/routes";

// Each pane's code loads when first opened.
const ThreadPane = dynamic(() => import("@/components/messages/ThreadPane").then((m) => m.ThreadPane), { ssr: false });
const VIEWS = ["thread", "details"] as const;
const DetailsPane = dynamic(() => import("@/components/messages/DetailsPane").then((m) => m.DetailsPane), { ssr: false });

type View = "thread" | "details";

/**
 * Thread and Details in one drawer: a 380–420px column beside the timeline at
 * 1024px+, a full screen with Back below. With both open they are tabs, so
 * checking a channel's members never closes the thread you were reading.
 */
export function ChatDrawer({ channelId }: { channelId: string }) {
  const panes = usePanes(channelId);
  const router = useRouter();
  const { user } = useAuth();
  const details = useChannelDetails(channelId);
  const heading = useRef<HTMLHeadingElement>(null);
  const [view, setView] = useState<View>(panes.thread ? "thread" : "details");
  // The thread's Follow and ⋯ render here, in the drawer's one header.
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  // Switching tabs keeps focus on the tab you pressed; only opening a pane moves it to the heading.
  const fromTab = useRef(false);

  // The pane opened last comes to the front.
  useEffect(() => { if (panes.thread) setView("thread"); }, [panes.thread]);
  useEffect(() => { if (panes.details) setView("details"); }, [panes.details]);
  const active: View = view === "thread" && panes.thread ? "thread" : panes.details ? "details" : "thread";

  useEffect(() => {
    if (fromTab.current) {
      fromTab.current = false;
      return;
    }
    // A thread focuses its reply box once that loads (ThreadPane autoFocus); Details focuses its heading.
    if (active === "details" || !window.matchMedia("(pointer: fine)").matches) heading.current?.focus();
  }, [active]);
  const pickTab = (value: View) => {
    fromTab.current = true;
    setView(value);
  };
  // ←/→, Home and End move between the two tabs.
  const tabKeys = (event: React.KeyboardEvent, index: number) => {
    const next = rovingTabKey(event, index, VIEWS.length);
    if (next === null) return;
    pickTab(VIEWS[next]!);
    document.getElementById(`drawer-tab-${VIEWS[next]}`)?.focus();
  };

  // Below 1024px the drawer covers the screen: Tab stays inside it, and closing it
  // returns focus to whatever opened it (the reply count, the Details button…).
  const aside = useRef<HTMLElement>(null);
  const [modal, setModal] = useState(false);
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const media = window.matchMedia("(max-width: 1023px)");
    const sync = () => setModal(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => {
      media.removeEventListener("change", sync);
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);
  const trapTab = (event: React.KeyboardEvent) => {
    if (!modal || event.key !== "Tab" || !aside.current) return;
    const focusable = Array.from(aside.current.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), textarea, select, [contenteditable="true"], [tabindex]:not([tabindex="-1"])',
    )).filter((el) => el.offsetParent !== null);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  const close = active === "thread" ? panes.closeThread : panes.closeDetails;
  const closeRef = useRef(close);
  useEffect(() => { closeRef.current = close; });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.shiftKey || escapeTaken(event) || editingWithText(event.target)) return;
      closeRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const channel = details.data;
  const title = channel ? channelTitle(channel, user?.id ?? null) : "";
  const where = channel ? `${channel.name ? `#${title}` : title}${channel.project_title ? ` · ${channel.project_title}` : ""}` : "";
  const both = Boolean(panes.thread && panes.details);
  const label = active === "thread" ? "Thread" : "Details";

  return (
    <aside
      ref={aside}
      data-chat-pane="drawer"
      aria-label={label}
      role={modal ? "dialog" : undefined}
      aria-modal={modal || undefined}
      onKeyDown={trapTab}
      // Below 1024px it covers the screen at the visible height, so the reply box sits above the phone's keyboard.
      className="fixed inset-x-0 top-0 z-40 flex h-[var(--chat-vvh,100dvh)] flex-col bg-card lg:relative lg:inset-auto lg:z-10 lg:w-[380px] lg:flex-none lg:border-l lg:border-border xl:w-[420px] lg:h-auto"
    >
      <header className="flex min-h-14 flex-none items-center gap-1 border-b border-border px-2">
        <span className="contents lg:hidden">
          <button type="button" onClick={close} className="nb-icon-button nb-touch-target" aria-label="Back"><ArrowLeft size={18} /></button>
        </span>
        {both ? (
          <div className="flex min-w-0 flex-1 flex-col py-1">
            <div role="tablist" aria-label="Side panel" className="flex min-w-0 items-center gap-1 px-1">
              {VIEWS.map((value, index) => (
                <button
                  key={value}
                  id={`drawer-tab-${value}`}
                  type="button"
                  role="tab"
                  aria-selected={active === value}
                  aria-controls="drawer-panel"
                  tabIndex={active === value ? 0 : -1}
                  onClick={() => pickTab(value)}
                  onKeyDown={(event) => tabKeys(event, index)}
                  className={`h-8 rounded-[5px] px-2.5 text-[14px] font-semibold capitalize ${active === value ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {value}
                </button>
              ))}
              <h2 ref={heading} tabIndex={-1} className="sr-only">{label}</h2>
            </div>
            {/* Which conversation, even with both panes open. */}
            {where ? <span className="truncate px-2.5 text-[12px] text-muted-foreground">{where}</span> : null}
          </div>
        ) : (
          <div className="flex min-w-0 flex-1 items-baseline gap-2 px-2">
            <h2 ref={heading} tabIndex={-1} className="flex-none rounded-xs text-[16px] font-semibold outline-none focus-visible:ring-1 focus-visible:ring-ring">{label}</h2>
            {where ? (
              active === "thread" && panes.thread ? (
                <Link href={showInConversationHref(channelId, panes.thread)} onClick={(event) => { event.preventDefault(); router.replace(showInConversationHref(channelId, panes.thread!), { scroll: false }); }} replace scroll={false} className="truncate text-[13px] text-muted-foreground hover:text-foreground hover:underline" title="Show in conversation">
                  {where}
                </Link>
              ) : (
                <span className="truncate text-[13px] text-muted-foreground">{where}</span>
              )
            ) : null}
          </div>
        )}
        {active === "thread" ? <div ref={setSlot} className="flex flex-none items-center gap-1" /> : null}
        <span className="hidden lg:contents">
          <button type="button" onClick={close} className="nb-icon-button nb-touch-target" aria-label={`Close ${label.toLowerCase()}`}><X size={18} /></button>
        </span>
      </header>
      <div id="drawer-panel" className="flex min-h-0 flex-1 flex-col" {...(both ? { role: "tabpanel", "aria-labelledby": `drawer-tab-${active}` } : {})}>
        {active === "thread" && panes.thread ? (
          <ThreadPane key={`${channelId}:${panes.thread}`} channelId={channelId} rootSeq={panes.thread} headerSlot={slot} focusSeq={panes.m} autoFocus onClose={panes.closeThread} />
        ) : panes.details ? (
          <DetailsPane channelId={channelId} tab={panes.details} onTab={panes.openDetails} />
        ) : null}
      </div>
    </aside>
  );
}

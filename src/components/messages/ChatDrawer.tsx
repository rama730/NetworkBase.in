"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, X } from "lucide-react";

import { usePanes } from "@/components/messages/usePanes";
import { useChannelDetails } from "@/components/messages/useConversation";
import { useAuth } from "@/hooks/useAuth";
import { channelTitle } from "@/lib/messaging/channel-view";
import { conversationHref } from "@/lib/messaging/routes";
import { editingWithText, escapeTaken } from "@/components/messages/keys";

// Each pane's code loads when first opened.
const ThreadPane = dynamic(() => import("@/components/messages/ThreadPane").then((m) => m.ThreadPane), { ssr: false });
const DetailsPane = dynamic(() => import("@/components/messages/DetailsPane").then((m) => m.DetailsPane), { ssr: false });

type View = "thread" | "details";

/**
 * Thread and Details in one drawer: a 380–420px column beside the timeline at
 * 1024px+, a full screen with Back below. With both open they are tabs, so
 * checking a channel's members never closes the thread you were reading.
 */
export function ChatDrawer({ channelId }: { channelId: string }) {
  const panes = usePanes(channelId);
  const { user } = useAuth();
  const details = useChannelDetails(channelId);
  const heading = useRef<HTMLHeadingElement>(null);
  const [view, setView] = useState<View>(panes.thread ? "thread" : "details");

  // The pane opened last comes to the front.
  useEffect(() => { if (panes.thread) setView("thread"); }, [panes.thread]);
  useEffect(() => { if (panes.details) setView("details"); }, [panes.details]);
  const active: View = view === "thread" && panes.thread ? "thread" : panes.details ? "details" : "thread";

  useEffect(() => heading.current?.focus(), [active]);
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
      data-chat-pane="drawer"
      aria-label={label}
      className="fixed inset-0 z-40 flex flex-col bg-card lg:relative lg:inset-auto lg:z-10 lg:w-[380px] lg:flex-none lg:border-l lg:border-border xl:w-[420px]"
    >
      <header className="flex h-14 flex-none items-center gap-1 border-b border-border px-2">
        <span className="contents lg:hidden">
          <button type="button" onClick={close} className="nb-icon-button nb-touch-target" aria-label="Back"><ArrowLeft size={18} /></button>
        </span>
        {both ? (
          <div role="tablist" aria-label="Side panel" className="flex min-w-0 flex-1 items-center gap-1 px-1">
            {(["thread", "details"] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={active === value}
                onClick={() => setView(value)}
                className={`h-8 rounded-[5px] px-2.5 text-[14px] font-semibold capitalize ${active === value ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                {value}
              </button>
            ))}
            <h2 ref={heading} tabIndex={-1} className="sr-only">{label}</h2>
          </div>
        ) : (
          <div className="flex min-w-0 flex-1 items-baseline gap-2 px-2">
            <h2 ref={heading} tabIndex={-1} className="flex-none text-[16px] font-semibold outline-none">{label}</h2>
            {where ? (
              active === "thread" && panes.thread ? (
                <Link href={conversationHref(channelId, { m: panes.thread, thread: panes.thread })} className="truncate text-[13px] text-muted-foreground hover:text-foreground hover:underline" title="Show in conversation">
                  {where}
                </Link>
              ) : (
                <span className="truncate text-[13px] text-muted-foreground">{where}</span>
              )
            ) : null}
          </div>
        )}
        <span className="hidden lg:contents">
          <button type="button" onClick={close} className="nb-icon-button nb-touch-target" aria-label={`Close ${label.toLowerCase()}`}><X size={18} /></button>
        </span>
      </header>
      <div className="flex min-h-0 flex-1 flex-col">
        {active === "thread" && panes.thread ? (
          <ThreadPane key={`${channelId}:${panes.thread}`} channelId={channelId} rootSeq={panes.thread} />
        ) : panes.details ? (
          <DetailsPane channelId={channelId} tab={panes.details} onTab={panes.openDetails} />
        ) : null}
      </div>
    </aside>
  );
}

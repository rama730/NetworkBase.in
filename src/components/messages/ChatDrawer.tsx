"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { ArrowLeft, X } from "lucide-react";

/**
 * Thread and details: a 320px drawer over the timeline at 1024px+, a full
 * screen with Back below (report 7.12). Same route either way.
 */
export function ChatDrawer({ channelId, title, subtitle, children }: { channelId: string; title: string; subtitle?: string; children: React.ReactNode }) {
  const router = useRouter();
  const heading = useRef<HTMLHeadingElement>(null);
  const close = () => router.push(`/messages/${channelId}`);
  useEffect(() => heading.current?.focus(), []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.querySelector("[role=dialog]")) router.push(`/messages/${channelId}`);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [channelId, router]);
  return (
    <aside
      data-chat-pane="drawer"
      aria-label={title}
      className="fixed inset-0 z-40 flex flex-col bg-card lg:absolute lg:inset-y-0 lg:left-auto lg:right-0 lg:z-30 lg:w-[320px] lg:border-l lg:border-border lg:shadow-md"
    >
      <header className="flex h-14 flex-none items-center gap-1 border-b border-border px-2">
        <button type="button" onClick={close} className="nb-icon-button nb-touch-target lg:hidden" aria-label="Back"><ArrowLeft size={18} /></button>
        <div className="min-w-0 flex-1 px-1">
          <h2 ref={heading} tabIndex={-1} className="truncate text-[17px] font-semibold outline-none">{title}</h2>
          {subtitle ? <p className="truncate text-[13px] text-muted-foreground">{subtitle}</p> : null}
        </div>
        <button type="button" onClick={close} className="nb-icon-button nb-touch-target hidden lg:grid" aria-label="Close"><X size={18} /></button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </aside>
  );
}

"use client";

import { ArrowLeft, X } from "lucide-react";

import { useBack } from "@/components/messages/useBack";
import { useWindowNav } from "@/components/messages/window-nav";

/**
 * Full-page views (Inbox, Saved, Drafts, Search, Browse, New message): 56px header with Back below 1024px.
 * `closable` screens (New message, Browse, Search) also get a × at 1024px+ that goes back.
 */
export function ViewScreen({ title, action, closable, children }: { title: string; action?: React.ReactNode; closable?: boolean; children: React.ReactNode }) {
  const goBack = useBack();
  const win = useWindowNav();
  if (win) {
    // In the floating window: always a Back (to the window's list), then the window's own controls.
    return (
      <section className="flex h-full min-h-0 flex-col overflow-hidden bg-card" aria-label={title}>
        <header className="flex h-14 flex-none items-center gap-1 border-b border-border px-2">
          <button type="button" onClick={win.back} className="nb-icon-button nb-touch-target" aria-label="Back"><ArrowLeft size={18} /></button>
          <h2 className="min-w-0 flex-1 truncate px-1 text-[15px] font-semibold">{title}</h2>
          {action}
          {win.actions}
        </header>
        <div className="app-scroll app-scroll-y flex min-h-0 flex-1 flex-col">{children}</div>
      </section>
    );
  }
  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden bg-card" aria-label={title}>
      <header className="flex h-14 flex-none items-center gap-1 border-b border-border px-2 sm:px-4">
        <span className="contents lg:hidden">
          <button type="button" onClick={goBack} className="nb-icon-button nb-touch-target" aria-label="Back"><ArrowLeft size={18} /></button>
        </span>
        <h1 className="min-w-0 flex-1 truncate text-[17px] font-semibold">{title}</h1>
        {action}
        {closable ? (
          <span className="hidden lg:contents">
            <button type="button" onClick={goBack} className="nb-icon-button" aria-label={`Close ${title}`} title="Close"><X size={18} /></button>
          </span>
        ) : null}
      </header>
      <div className="app-scroll app-scroll-y flex min-h-0 flex-1 flex-col">{children}</div>
    </section>
  );
}

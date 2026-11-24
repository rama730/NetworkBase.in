"use client";

import { ArrowLeft, X } from "@/components/ui/icons";

import { ConnectionBanner } from "@/components/messages/ConnectionBanner";
import { useBack } from "@/hooks/useBack";
import { useWindowNav } from "@/components/messages/window-nav";

/**
 * Full-page views (Inbox, Saved, Drafts, Search, Browse, New message): 56px header with Back below 1024px.
 * `closable` screens (New message, Browse, Search) also get a × at 1024px+ that goes back.
 */
export function ViewScreen({ title, action, closable, children, back }: { title: string; action?: React.ReactNode; closable?: boolean; children: React.ReactNode; back?: string }) {
  // `back`: where Back goes when there's no in-app history (Browse goes to its project).
  const goBack = useBack(back ?? "/messages");
  const win = useWindowNav();
  if (win) {
    // In the floating window: always a Back (to the window's list), then the window's own controls.
    return (
      <section className="flex h-full min-h-0 flex-col overflow-hidden bg-card" aria-label={title}>
        <header className="flex h-14 flex-none items-center gap-1 border-b border-border px-2">
          <button type="button" onClick={win.back} className="nb-icon-button nb-touch-target" aria-label="Back"><ArrowLeft size={16} /></button>
          <h2 className="nb-card-title min-w-0 flex-1 truncate px-1">{title}</h2>
          {action}
          {win.actions}
        </header>
        <ConnectionBanner />
        <div className="app-scroll app-scroll-y flex min-h-0 flex-1 flex-col">{children}</div>
      </section>
    );
  }
  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden bg-card" aria-label={title}>
      <header className="flex h-14 flex-none items-center gap-1 border-b border-border px-2 sm:px-4">
        <span className="contents lg:hidden">
          <button type="button" onClick={goBack} className="nb-icon-button nb-touch-target" aria-label="Back"><ArrowLeft size={16} /></button>
        </span>
        <h1 className="nb-card-title min-w-0 flex-1 truncate">{title}</h1>
        {action}
        {closable ? (
          <span className="hidden lg:contents">
            <button type="button" onClick={goBack} className="nb-icon-button nb-touch-target" aria-label={`Close ${title}`} title="Close"><X size={16} /></button>
          </span>
        ) : null}
      </header>
      {/* Offline shows on every screen, not only in a conversation. */}
      <ConnectionBanner />
      <div className="app-scroll app-scroll-y flex min-h-0 flex-1 flex-col">{children}</div>
    </section>
  );
}

"use client";

import { ArrowLeft } from "lucide-react";

import { useBack } from "@/components/messages/useBack";

/** Full-page views (Inbox, Saved, Drafts, Search, Browse, New message): 56px header with Back below 1024px. */
export function ViewScreen({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  const goBack = useBack();
  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden bg-card" aria-label={title}>
      <header className="flex h-14 flex-none items-center gap-1 border-b border-border px-2 sm:px-4">
        <span className="contents lg:hidden">
          <button type="button" onClick={goBack} className="nb-icon-button nb-touch-target" aria-label="Back"><ArrowLeft size={18} /></button>
        </span>
        <h1 className="min-w-0 flex-1 truncate text-[17px] font-semibold">{title}</h1>
        {action}
      </header>
      <div className="app-scroll app-scroll-y flex min-h-0 flex-1 flex-col">{children}</div>
    </section>
  );
}

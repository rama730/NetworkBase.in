"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";

/** Full-page views (Activity, Threads, DMs, Browse, New message): 56px header with Back below 1024px. */
export function ViewScreen({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden bg-card" aria-label={title}>
      <header className="flex h-14 flex-none items-center gap-1 border-b border-border px-2 sm:px-4">
        <Link href="/messages" className="nb-icon-button nb-touch-target lg:hidden" aria-label="Back"><ArrowLeft size={18} /></Link>
        <h1 className="min-w-0 flex-1 truncate text-[17px] font-semibold">{title}</h1>
        {action}
      </header>
      <div className="app-scroll app-scroll-y min-h-0 flex-1">{children}</div>
    </section>
  );
}

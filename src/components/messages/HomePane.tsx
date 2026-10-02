"use client";

import Link from "next/link";
import { MessageSquare } from "lucide-react";

import { ListScreen } from "@/components/messages/ListScreen";

/** The main pane when no conversation is open (desktop). */
export function HomePane() {
  return (
    <div className="grid h-full place-items-center bg-card p-6 text-center">
      <div className="max-w-sm space-y-3">
        <MessageSquare size={28} aria-hidden="true" className="mx-auto text-muted-foreground" />
        <h1 className="text-[17px] font-semibold">Pick a conversation</h1>
        <p className="text-[13px] text-muted-foreground">Choose a channel or direct message from the sidebar, or start a new one.</p>
        <Link href="/messages/new" className="inline-flex h-[var(--ui-control-height)] items-center rounded-[5px] bg-primary px-4 text-[13px] font-medium text-primary-foreground">New message</Link>
      </div>
    </div>
  );
}

/** The List screen below 1024px; the empty main pane at 1024px+ (the sidebar lists conversations). */
export function ListOrHome() {
  return (
    <>
      <div className="h-full lg:hidden"><ListScreen /></div>
      <div className="hidden h-full lg:block"><HomePane /></div>
    </>
  );
}

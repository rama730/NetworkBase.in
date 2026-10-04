"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo } from "react";

import { asDetailsTab, conversationHref, type DetailsTab, type Panes } from "@/lib/messaging/routes";

// Set when a drawer was opened with push (phones), so closing it can go Back.
let pushedDrawer = false;

/** The open conversation's drawers (thread, details), read from and written to the URL. */
export function usePanes(channelId: string) {
  const router = useRouter();
  const params = useSearchParams();
  const thread = Number(params?.get("thread")) || null;
  const details = asDetailsTab(params?.get("details"));
  // The jumped-to message (?m=) stays, so opening a pane never re-positions the timeline.
  const m = Number(params?.get("m")) || null;
  // The phone's own Back closed it: nothing left to go back from.
  useEffect(() => {
    if (!thread && !details) pushedDrawer = false;
  }, [details, thread]);
  // At 1024px+ the drawer sits beside the timeline: replace, so Back leaves the conversation
  // instead of reopening a drawer you closed. Below that it covers the screen like a page:
  // opening pushes, so the phone's Back closes it; closing a pushed drawer goes back.
  const go = useCallback((next: Panes, closing = false) => {
    const href = conversationHref(channelId, { m, ...next });
    const narrow = !window.matchMedia("(min-width: 1024px)").matches;
    if (narrow && closing && pushedDrawer) {
      pushedDrawer = false;
      router.back();
    } else if (narrow && !closing && !thread && !details) {
      pushedDrawer = true;
      router.push(href, { scroll: false });
    } else router.replace(href, { scroll: false });
  }, [channelId, details, m, router, thread]);
  return useMemo(() => ({
    thread,
    details,
    m,
    openThread: (rootSeq: number) => go({ thread: rootSeq, details }),
    openDetails: (tab: DetailsTab = "about") => go({ thread, details: tab }),
    closeThread: () => go({ details }, !details),
    closeDetails: () => go({ thread }, !thread),
    closeAll: () => go({}, true),
  }), [details, go, m, thread]);
}

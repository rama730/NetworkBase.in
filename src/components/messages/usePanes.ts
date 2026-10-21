"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef } from "react";

import { readPanes, conversationHref, type DetailsTab, type Panes } from "@/lib/messaging/routes";

// Stored in this history entry, shared by hook callers but scoped to this conversation.
const DRAWER_HISTORY_KEY = "nbChatDrawer";

/** The open conversation's drawers (thread, details), read from and written to the URL. */
export function usePanes(channelId: string, enabled = true) {
  const router = useRouter();
  const pathname = usePathname();
  const active = enabled && pathname === `/messages/${channelId}`;
  const params = useSearchParams();
  const search = active ? params?.toString() ?? "" : "";
  const { thread = null, details = null, m = null, tab = null, pane = null } = readPanes(new URLSearchParams(search));
  const lastReplacedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!active) return;
    const href = conversationHref(channelId, {}, search);
    const current = `/messages/${channelId}${search ? `?${search}` : ""}`;
    if (href !== current && lastReplacedRef.current !== href) {
      lastReplacedRef.current = href;
      router.replace(href, { scroll: false });
    }
  }, [active, channelId, search, router]);
  // At 1024px+ the drawer sits beside the timeline: replace, so Back leaves the conversation
  // instead of reopening a drawer you closed. Below that it covers the screen like a page:
  // opening pushes, so the phone's Back closes it; closing a pushed drawer goes back.
  const go = useCallback((next: Panes, closing = false) => {
    if (!active) return;
    const href = conversationHref(channelId, next, search);
    const narrow = !window.matchMedia("(min-width: 1024px)").matches;
    if (narrow && closing && window.history.state?.[DRAWER_HISTORY_KEY] === channelId) {
      router.back();
    } else if (narrow && !closing && !thread && !details) {
      // Native history writes integrate with Next's URL hooks and keep an ownership marker.
      window.history.pushState({ ...window.history.state, [DRAWER_HISTORY_KEY]: channelId }, "", href);
    } else if (narrow && window.history.state?.[DRAWER_HISTORY_KEY] === channelId) {
      window.history.replaceState(window.history.state, "", href);
    } else router.replace(href, { scroll: false });
  }, [active, channelId, details, search, router, thread]);
  return useMemo(() => ({
    thread,
    details,
    m, tab, pane,
    openThread: (rootSeq: number) => go({ thread: rootSeq, m: null, pane: "thread" }),
    openDetails: (tab: DetailsTab = "about") => go({ details: tab, pane: "details" }),
    closeThread: () => go({ thread: null, m: null }, !details),
    closeDetails: () => go({ details: null }, !thread),
    closeAll: () => go({ thread: null, details: null, m: null }, true),
    selectPane: (pane: "thread" | "details") => go({ pane }),
  }), [details, go, m, thread, tab, pane]);
}

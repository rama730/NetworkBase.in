"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";

import { asDetailsTab, conversationHref, type DetailsTab, type Panes } from "@/lib/messaging/routes";

/** The open conversation's drawers (thread, details), read from and written to the URL. */
export function usePanes(channelId: string) {
  const router = useRouter();
  const params = useSearchParams();
  const thread = Number(params?.get("thread")) || null;
  const details = asDetailsTab(params?.get("details"));
  // The jumped-to message (?m=) stays, so opening a pane never re-positions the timeline.
  const m = Number(params?.get("m")) || null;
  const go = useCallback((next: Panes) => {
    router.push(conversationHref(channelId, { m, ...next }), { scroll: false });
  }, [channelId, m, router]);
  return useMemo(() => ({
    thread,
    details,
    openThread: (rootSeq: number) => go({ thread: rootSeq, details }),
    openDetails: (tab: DetailsTab = "about") => go({ thread, details: tab }),
    closeThread: () => go({ details }),
    closeDetails: () => go({ thread }),
    closeAll: () => go({}),
  }), [details, go, thread]);
}

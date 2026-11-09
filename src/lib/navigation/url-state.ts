"use client";

import { useEffect, useRef } from "react";

import { keepStamp } from "@/lib/navigation/in-app-history";

// Page settings (searches, filters, sorts, views) live in the address, so going back to a page
// brings them back exactly (unified back R3). Writes replace the entry: no extra back steps.

/** Settings each workspace/organization tab keeps in the address; switching tabs clears the old tab's. */
export const TAB_STATE_PARAMS: Record<string, readonly string[]> = {
  members: ["mq", "mrole", "msort", "mproject", "mstatus", "minv", "mout", "mformer"],
  tasks: ["rqlate", "rqmine", "rqq", "rqsort", "rtq", "rtsort", "rtlate", "team"],
  files: ["ofstatus", "ofq", "ofonly", "ofsort", "ofdir", "ofphase", "ofmq", "ofstate", "offq"],
  sprints: ["tlby", "tlmine"],
};

type HistoryWin = {
  history: { state: any; replaceState(state: any, title: string, url?: string): void; pushState(state: any, title: string, url?: string): void };
  location: { pathname: string; search: string };
};

/** `?a=1` + `{ b: "2", a: null }` → `?b=2`. Untouched keys keep their order. */
export function patchSearch(search: string, patch: Record<string, string | null>): string {
  const params = new URLSearchParams(search);
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === "") params.delete(key);
    else params.set(key, value);
  }
  const next = params.toString();
  return next ? `?${next}` : "";
}

/** Change the address without a server round trip, keeping our history stamp. */
export function writeUrl(win: HistoryWin, href: string, mode: "push" | "replace") {
  const state = keepStamp(win.history.state);
  if (mode === "push") win.history.pushState(state, "", href);
  else win.history.replaceState(state, "", href);
}

/** Read one setting from the address (null on the server or when absent). */
export function readUrlParam(name: string): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(name);
}

/** Mirror these settings into the address (replace, debounced for typing). `null` removes a key. */
export function useUrlMirror(values: Record<string, string | null>, debounceMs = 300) {
  const key = JSON.stringify(values);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; } // the first render read them from the address
    const timer = window.setTimeout(() => {
      const search = patchSearch(window.location.search, JSON.parse(key));
      if (search === window.location.search) return;
      writeUrl(window, `${window.location.pathname}${search}${window.location.hash}`, "replace");
    }, debounceMs);
    return () => window.clearTimeout(timer);
  }, [key, debounceMs]);
}

"use client";

// Back closes what's open over the page first (unified back A3): opening a drawer, thread or viewer
// pushes one history entry marked as that overlay's; switching to another item of the same overlay
// replaces it; closing goes back when the entry is ours (so one more back leaves the page), and
// replaces when the overlay came in on a deep link.

import { useEffect, useRef } from "react";

import { arrivedByTraverse, currentEntry, markNextPushAsOverlay, subscribeEntry } from "@/lib/navigation/in-app-history";
import { patchSearch, writeUrl } from "@/lib/navigation/url-state";

export function isOverlayEntry(key: string) {
  return currentEntry()?.overlay === key;
}

/** Open (or switch) the overlay; `go` performs the address change with the mode given. */
export function openOverlay(key: string, go: (mode: "push" | "replace") => void) {
  if (isOverlayEntry(key)) return go("replace");
  markNextPushAsOverlay(key);
  go("push");
}

/** Close the overlay: back when we pushed it, else `replace` (deep link: nothing of ours behind). */
export function closeOverlay(key: string, replace: () => void, back: () => void = () => window.history.back()) {
  if (isOverlayEntry(key)) back();
  else replace();
}

/**
 * For a drawer or viewer held in component state: opening adds one entry (`?ov=<key>`, so the
 * address is a real step), closing it yourself goes back, and back or swipe closes it.
 */
export function useOverlayHistory(key: string, open: boolean, onBackClose: () => void) {
  const wasOpen = useRef(open);
  const closeRef = useRef(onBackClose);
  useEffect(() => { closeRef.current = onBackClose; });
  useEffect(() => {
    if (open === wasOpen.current) return;
    wasOpen.current = open;
    const href = (value: string | null) => `${window.location.pathname}${patchSearch(window.location.search, { ov: value })}${window.location.hash}`;
    if (open) {
      if (!isOverlayEntry(key)) openOverlay(key, (mode) => writeUrl(window, href(key), mode));
    } else if (isOverlayEntry(key)) {
      window.history.back();
    } else if (new URLSearchParams(window.location.search).get("ov") === key) {
      // Not our history step (a reload or a deep link): take the marker out of the address instead.
      writeUrl(window, href(null), "replace");
    }
  }, [key, open]);
  useEffect(() => subscribeEntry((entry) => {
    // Only back/forward closes it: a link opened from inside the overlay leaves it as the page left it.
    if (wasOpen.current && entry.overlay !== key && arrivedByTraverse()) {
      wasOpen.current = false;
      closeRef.current();
    }
  }), [key]);
}

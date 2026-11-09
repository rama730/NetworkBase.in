"use client";

import { useEffect } from "react";

import { arrivedByTraverse, currentEntry, subscribeEntry } from "@/lib/navigation/in-app-history";
import { chooseAnchors, loadRecord, pickAnchor, saveRecord, type ScrollRecord } from "@/lib/navigation/scroll-memory";

/** How long to wait for the page to come back (a slow load shows its loading screen first). */
const ARRIVE_WINDOW_MS = 5000;
/** After it lands, how long the card is held in place while late rows and images settle. */
const HOLD_WINDOW_MS = 1500;
const RETURNED_TINT_MS = 1000;

const routeRoot = () => document.querySelector<HTMLElement>('#main-content [data-scroll-root="route"]');
const byRestoreId = (root: ParentNode, id: string) => root.querySelector<HTMLElement>(`[data-restore-id="${CSS.escape(id)}"]`);

function snapshot(root: HTMLElement, opened: string | null): ScrollRecord {
  const box = root.getBoundingClientRect();
  const items = Array.from(root.querySelectorAll<HTMLElement>("[data-restore-id]"), (el) => {
    const rect = el.getBoundingClientRect();
    return { id: el.dataset.restoreId ?? "", top: rect.top - box.top, bottom: rect.bottom - box.top };
  }).filter((item) => item.id && item.bottom > item.top).sort((a, b) => a.top - b.top);
  const areas: ScrollRecord["areas"] = {};
  document.querySelectorAll<HTMLElement>("#main-content [data-scroll-memory]").forEach((el) => {
    areas[el.dataset.scrollMemory ?? ""] = { top: el.scrollTop, left: el.scrollLeft };
  });
  return { top: root.scrollTop, ...chooseAnchors(items, 0), opened, areas };
}

/** Bring the page back to where you were: the remembered card at the same spot, inner areas, focus. */
let restoring = false;

function restore(record: ScrollRecord) {
  restoring = true;
  const start = performance.now();
  let lastTop = -1;
  let stable = 0;
  let settled = false;
  let settledAt = 0;
  let stopped = false;
  const stop = () => { stopped = true; };
  const inputs = ["wheel", "touchstart", "keydown", "pointerdown"] as const;
  inputs.forEach((type) => window.addEventListener(type, stop, { passive: true, capture: true, once: true }));
  const done = () => {
    restoring = false;
    inputs.forEach((type) => window.removeEventListener(type, stop, { capture: true }));
  };

  const settle = (root: HTMLElement) => {
    settled = true;
    settledAt = performance.now();
    for (const [name, pos] of Object.entries(record.areas)) {
      const area = document.querySelector<HTMLElement>(`#main-content [data-scroll-memory="${CSS.escape(name)}"]`);
      if (area) { area.scrollTop = pos.top; area.scrollLeft = pos.left; }
    }
    const opened = record.opened ? byRestoreId(root, record.opened) : null;
    if (!opened) return;
    const target = opened.matches("a[href],button,[tabindex]") ? opened : opened.querySelector<HTMLElement>('a[href],button,[tabindex]:not([tabindex="-1"])');
    target?.focus({ preventScroll: true });
    opened.setAttribute("data-returned", "");
    window.setTimeout(() => opened.removeAttribute("data-returned"), RETURNED_TINT_MS);
  };

  const step = () => {
    const root = routeRoot();
    const now = performance.now();
    if (stopped || (settled ? now - settledAt > HOLD_WINDOW_MS : now - start > ARRIVE_WINDOW_MS)) return done();
    if (root) {
      const tallEnough = root.scrollHeight - root.clientHeight >= record.top - 1;
      // The card that was at the top, once drawn. A later one only when the list is long enough and
      // the first is still missing (deleted meanwhile, R10).
      const first = record.anchors[0] && byRestoreId(root, record.anchors[0]) ? record.anchors[0] : null;
      const anchor = first ?? (tallEnough ? pickAnchor(record.anchors.slice(1), (id) => Boolean(byRestoreId(root, id))) : null);
      if (anchor) {
        const el = byRestoreId(root, anchor)!;
        const delta = el.getBoundingClientRect().top - root.getBoundingClientRect().top - (anchor === first ? record.anchorOffset : 0);
        if (Math.abs(delta) > 1) root.scrollTop += delta;
      } else if (Math.abs(root.scrollTop - record.top) > 1) {
        // Not drawn yet: the pixel position makes lazy lists draw that region.
        root.scrollTop = record.top;
      }
      stable = Math.abs(root.scrollTop - lastTop) < 1 ? stable + 1 : 0;
      lastTop = root.scrollTop;
      const reached = anchor !== null || tallEnough;
      // Keep correcting through the window (a background refresh may add rows above), settle once.
      if (stable >= 2 && reached && !settled) settle(root);
    }
    requestAnimationFrame(step);
  };
  // First try right away: the page is already on screen when it's stamped; frames can be throttled.
  step();
}

/**
 * One scroll memory for every page (unified back §3.1): saved per history entry while you scroll or
 * open a card, restored when you come back by back/forward or swipe. Any other arrival starts at the top.
 */
export function useScrollMemory() {
  useEffect(() => {
    let opened: string | null = null;
    let frame = 0;
    const save = () => {
      if (restoring) return; // the restore's own scrolling isn't where you were
      const id = currentEntry()?.id;
      const root = routeRoot();
      if (id && root) saveRecord(window.sessionStorage, id, snapshot(root, opened));
    };
    const onScroll = (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (!target?.matches?.('[data-scroll-root="route"], [data-scroll-memory]')) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(save);
    };
    const onClick = (event: MouseEvent) => {
      const card = (event.target as Element | null)?.closest?.<HTMLElement>("#main-content [data-restore-id]");
      opened = card?.dataset.restoreId ?? opened;
      save(); // before the next page replaces this one
    };
    const unsubscribe = subscribeEntry((entry) => {
      opened = null;
      if (!arrivedByTraverse()) return;
      const record = loadRecord(window.sessionStorage, entry.id);
      if (record) restore(record);
    });
    // A full page load back (no in-memory page) stamps before this effect subscribes.
    const first = currentEntry();
    if (first && arrivedByTraverse()) {
      const record = loadRecord(window.sessionStorage, first.id);
      if (record) restore(record);
    }
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    document.addEventListener("click", onClick, { capture: true });
    return () => {
      cancelAnimationFrame(frame);
      unsubscribe();
      document.removeEventListener("scroll", onScroll, { capture: true });
      document.removeEventListener("click", onClick, { capture: true });
    };
  }, []);
}

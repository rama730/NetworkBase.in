// Where this tab is in its in-app history, exactly (unified back, A7). Every history entry
// carries a stamp in `history.state.nb`: its id, how many of our pages sit behind it, and the
// page it was opened from. Back/forward and reloads read the stamp back, so the count never
// drifts. MainLayout stamps after each URL change; instrumentation-client reports each router
// transition so a stamp-less entry is known to be a push or a replace.

import { rememberDeparture, takeDeparture } from "@/lib/navigation/external-return";

export type HistoryEntry = {
  id: string;
  depth: number;
  from: { path: string; title: string } | null;
  /** Entries to skip on in-app Back (another site sits behind this one, R4). */
  skip?: number;
  /** This entry was pushed to show a drawer or viewer over the page; back closes it (A3). */
  overlay?: string;
};

type TransitionType = "push" | "replace" | "traverse";

export type WinLike = {
  history: { state: any; length: number; replaceState(state: any, title: string, url?: string): void };
  location: { pathname: string; search: string; href: string };
  document?: { title: string };
};


let current: HistoryEntry | null = null;
let currentPath = "";
let currentTitle = "";
let lastLength = 0;
let pending: TransitionType | null = null;
let leavingTitle: string | null = null;
let pendingOverlay: string | null = null;
/** A back/forward is under way; the entry it lands on is stamped as reached by traverse (no time limit). */
let traversing = false;
let arrivedTraverse = false;
let counter = 0;
const listeners = new Set<(entry: HistoryEntry) => void>();

if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => { traversing = true; });
}

const newId = () => `${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function isEntry(value: unknown): value is HistoryEntry {
  const v = value as HistoryEntry | null;
  return Boolean(v && typeof v.id === "string" && typeof v.depth === "number");
}

/** Leaving the app for another site that sends you back (OAuth): remember where you were (R4). */
export function noteExternalDeparture() {
  if (!current || typeof sessionStorage === "undefined" || typeof window === "undefined") return;
  rememberDeparture(sessionStorage, window.history.length, Date.now(), { path: currentPath, title: document.title });
}

/** The next pushed entry shows a drawer or viewer over this page (A3). */
export function markNextPushAsOverlay(key: string) {
  pendingOverlay = key;
}

/** A router navigation is starting (from `onRouterTransitionStart`). */
export function noteTransition(type: TransitionType) {
  pending = type;
  if (type === "traverse") traversing = true;
  else if (typeof document !== "undefined") leavingTitle = document.title;
}

/** Stamp (or adopt the stamp of) the entry the tab is on now. Safe to call repeatedly. */
export function stampEntry(win: WinLike): HistoryEntry {
  const stored = win.history.state?.nb;
  let entry: HistoryEntry;
  if (isEntry(stored)) {
    entry = stored;
  } else if (!current) {
    // A fresh page load. Back from another site (GitHub)? Skip that site's entries (R4).
    const returned = typeof sessionStorage === "undefined" ? null : takeDeparture(sessionStorage, win.history.length, Date.now());
    entry = returned ? { id: newId(), depth: 0, from: returned.from, skip: returned.skip } : { id: newId(), depth: 0, from: null };
  } else {
    const type = pending ?? (win.history.length > lastLength ? "push" : "replace");
    entry = type === "push"
      ? { id: newId(), depth: current.depth + 1, from: { path: currentPath, title: leavingTitle ?? currentTitle }, ...(pendingOverlay ? { overlay: pendingOverlay } : {}) }
      : { ...current };
  }
  pending = null;
  leavingTitle = null;
  pendingOverlay = null;
  lastLength = win.history.length;
  if (stored !== entry) {
    // Next's patched replaceState copies its own internals into a state without them.
    win.history.replaceState({ ...(win.history.state ?? {}), nb: entry }, "", win.location.href);
  }
  const changed = current?.id !== entry.id;
  if (changed) {
    // A fresh page load counts as traverse when the browser itself came back to it.
    arrivedTraverse = current ? traversing : loadedByBackForward();
    traversing = false;
  }
  current = entry;
  currentPath = `${win.location.pathname}${win.location.search}`;
  currentTitle = win.document?.title ?? "";
  if (changed) listeners.forEach((fn) => fn(entry));
  return entry;
}

/**
 * State for a raw history.pushState/replaceState: our stamp only. Next's patched history copies its own
 * current internals in; passing the old state would keep Next's stale route tree for the new address.
 */
export function keepStamp(state: unknown): { nb?: HistoryEntry } {
  const nb = (state as { nb?: unknown } | null)?.nb;
  return isEntry(nb) ? { nb } : {};
}

export function currentEntry(): HistoryEntry | null {
  return current;
}

/** True when one of our pages sits behind this one, so Back never leaves the site. */
export function canGoBackInApp() {
  return Boolean(current && (current.depth > 0 || current.skip));
}

function loadedByBackForward() {
  if (typeof performance === "undefined" || typeof performance.getEntriesByType !== "function") return false;
  const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  return nav?.type === "back_forward";
}

/** The entry the tab is on now was reached by back/forward (or swipe), however long it took to render. */
export function arrivedByTraverse() {
  return arrivedTraverse;
}

export function subscribeEntry(fn: (entry: HistoryEntry) => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Tests only (and a reload, which starts with fresh module state). */
export function resetInAppHistory() {
  current = null;
  currentPath = "";
  currentTitle = "";
  lastLength = 0;
  pending = null;
  leavingTitle = null;
  pendingOverlay = null;
  traversing = false;
  arrivedTraverse = false;
}

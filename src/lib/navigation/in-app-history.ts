// Where this tab is in its in-app history, exactly (unified back, A7). Every history entry
// carries a stamp in `history.state.nb`: its id, how many of our pages sit behind it, and the
// page it was opened from. Back/forward and reloads read the stamp back, so the count never
// drifts. MainLayout stamps after each URL change; instrumentation-client reports each router
// transition so a stamp-less entry is known to be a push or a replace.

export type HistoryEntry = {
  id: string;
  depth: number;
  from: { path: string; title: string } | null;
  /** Entries to skip on in-app Back (another site sits behind this one, R4). */
  skip?: number;
};

type TransitionType = "push" | "replace" | "traverse";

export type WinLike = {
  history: { state: any; length: number; replaceState(state: any, title: string, url?: string): void };
  location: { pathname: string; search: string; href: string };
  document?: { title: string };
};

const TRAVERSE_WINDOW_MS = 1500;

let current: HistoryEntry | null = null;
let currentPath = "";
let currentTitle = "";
let lastLength = 0;
let pending: TransitionType | null = null;
let leavingTitle: string | null = null;
let lastTraverseAt = Number.NEGATIVE_INFINITY;
let counter = 0;
const listeners = new Set<(entry: HistoryEntry) => void>();

if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => { lastTraverseAt = Date.now(); });
}

const newId = () => `${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function isEntry(value: unknown): value is HistoryEntry {
  const v = value as HistoryEntry | null;
  return Boolean(v && typeof v.id === "string" && typeof v.depth === "number");
}

/** A router navigation is starting (from `onRouterTransitionStart`). */
export function noteTransition(type: TransitionType) {
  pending = type;
  if (type === "traverse") lastTraverseAt = Date.now();
  else if (typeof document !== "undefined") leavingTitle = document.title;
}

/** Stamp (or adopt the stamp of) the entry the tab is on now. Safe to call repeatedly. */
export function stampEntry(win: WinLike): HistoryEntry {
  const stored = win.history.state?.nb;
  let entry: HistoryEntry;
  if (isEntry(stored)) {
    entry = stored;
  } else if (!current) {
    entry = { id: newId(), depth: 0, from: null };
  } else {
    const type = pending ?? (win.history.length > lastLength ? "push" : "replace");
    entry = type === "push"
      ? { id: newId(), depth: current.depth + 1, from: { path: currentPath, title: leavingTitle ?? currentTitle } }
      : { ...current };
  }
  pending = null;
  leavingTitle = null;
  lastLength = win.history.length;
  if (stored !== entry) {
    // Next's patched replaceState copies its own internals into a state without them.
    win.history.replaceState({ ...(win.history.state ?? {}), nb: entry }, "", win.location.href);
  }
  const changed = current?.id !== entry.id;
  current = entry;
  currentPath = `${win.location.pathname}${win.location.search}`;
  currentTitle = win.document?.title ?? "";
  if (changed) listeners.forEach((fn) => fn(entry));
  return entry;
}

export function currentEntry(): HistoryEntry | null {
  return current;
}

/** True when one of our pages sits behind this one, so Back never leaves the site. */
export function canGoBackInApp() {
  return Boolean(current && (current.depth > 0 || current.skip));
}

/** This arrival was a back/forward (or a restore of a back/forward page load). */
export function arrivedByTraverse(now = Date.now()) {
  if (now - lastTraverseAt < TRAVERSE_WINDOW_MS) return true;
  if (typeof performance === "undefined" || typeof performance.getEntriesByType !== "function") return false;
  const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  return nav?.type === "back_forward" && performance.now() < 5000;
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
  lastTraverseAt = Number.NEGATIVE_INFINITY;
}

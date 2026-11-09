// Round trips to another site (unified back R4): connecting or importing from GitHub leaves the app
// and comes back as a new page load, with GitHub's pages sitting in the browser history between.
// Leaving records how long the history was; the return page works out how many entries to skip,
// so the in-app arrow lands where you were. (The browser's own back may still show GitHub once.)
// Assumes no Forward entries existed when leaving, which is normal right after clicking Connect.

import type { StorageLike } from "@/lib/navigation/scroll-memory";

type Departure = { length: number; at: number; from: { path: string; title: string } };

const KEY = "nb-external-departure";
const MAX_AGE_MS = 10 * 60_000;

export function rememberDeparture(store: StorageLike, historyLength: number, now: number, from: Departure["from"]) {
  try {
    store.setItem(KEY, JSON.stringify({ length: historyLength, at: now, from } satisfies Departure));
  } catch {
    // Storage blocked: the arrow falls back as from any fresh page.
  }
}

/** Entries to skip back to the departure page, once; null when there is none, it's stale, or nothing to skip. */
export function takeDeparture(store: StorageLike, historyLength: number, now: number): { skip: number; from: Departure["from"] } | null {
  try {
    const raw = store.getItem(KEY);
    if (!raw) return null;
    store.removeItem(KEY);
    const departure = JSON.parse(raw) as Departure;
    // Departure entry index = saved length − 1; this page's index = now length − 1.
    const skip = historyLength - departure.length;
    if (now - departure.at > MAX_AGE_MS || skip <= 0) return null;
    return { skip, from: departure.from };
  } catch {
    return null;
  }
}

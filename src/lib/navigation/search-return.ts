// Back to your search results (unified back R2): opening a result from the top search remembers
// the query and the result, for this tab only. Going back to the page you searched from reopens
// the search with them; Esc or a click outside closes it, and Forward still reaches the result.

import type { StorageLike } from "@/lib/navigation/scroll-memory";

export type SearchReturn = { entryId: string; query: string; context?: string; activeIndex: number };

const KEY = "nb-search-return";

export function rememberSearchReturn(store: StorageLike, value: SearchReturn) {
  try {
    store.setItem(KEY, JSON.stringify(value));
  } catch {
    // Storage blocked: back simply doesn't reopen the search.
  }
}

/** The search to reopen on this entry, once; null for any other entry. */
export function takeSearchReturn(store: StorageLike, entryId: string): SearchReturn | null {
  try {
    const raw = store.getItem(KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as SearchReturn;
    if (value.entryId !== entryId || typeof value.query !== "string") return null;
    store.removeItem(KEY);
    return value;
  } catch {
    return null;
  }
}

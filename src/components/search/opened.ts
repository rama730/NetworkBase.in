import type { StorageLike } from "@/lib/navigation/scroll-memory";

// Back puts you where you were (round two item 11): the card you opened from these results is marked again.
export const openedKey = (state: string) => `nb-search-opened:${state}`;

export function rememberOpened(store: StorageLike, state: string, id: string) {
    try { store.setItem(openedKey(state), id); } catch { /* storage blocked: nothing is marked */ }
}

export function readOpened(store: StorageLike, state: string): string | null {
    try { return store.getItem(openedKey(state)); } catch { return null; }
}

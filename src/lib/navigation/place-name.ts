import { useSyncExternalStore } from "react";

// The name of the workspace or organization the page is showing, for the top bar's path. The page knows it (the
// sidebar only knows places you're in), so the page writes it here and the top bar reads it.
type PlaceName = { paths: string[]; title: string };
let current: PlaceName | null = null;
const listeners = new Set<() => void>();

export function setPlaceName(paths: string[], title: string) {
    current = { paths, title };
    listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

/** The page's place name when `pathname` is under one of its addresses, otherwise null. */
export function usePlaceName(pathname: string): string | null {
    const now = useSyncExternalStore(subscribe, () => current, () => null);
    return now?.paths.some((path) => pathname === path || pathname.startsWith(`${path}/`)) ? now.title : null;
}

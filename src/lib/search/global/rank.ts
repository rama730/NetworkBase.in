import type { SearchContextKey, SearchKind } from "./parse";

export type SearchTab = "discover" | "people" | "msgs" | "goto";

const DISCOVER_ORDER: SearchKind[] = ["orgs", "workspaces", "posts", "people", "messages", "goto"];

/** The order of kinds in the box, per page (report §3 table). A workspace or org puts its own results first, above these. */
export const ORDER: Record<SearchContextKey, SearchKind[]> = {
    discover: DISCOVER_ORDER,
    workspace: DISCOVER_ORDER,
    org: DISCOVER_ORDER,
    network: ["people", "orgs", "workspaces", "posts", "messages", "goto"],
    messages: ["messages", "people", "workspaces", "orgs", "posts", "goto"],
    settings: ["goto", ...DISCOVER_ORDER.filter((kind) => kind !== "goto")],
};

/** The results page's tab order, per page you came from. */
export const TAB_ORDER: Record<SearchContextKey, SearchTab[]> = {
    discover: ["discover", "people", "msgs", "goto"],
    workspace: ["discover", "people", "msgs", "goto"],
    org: ["discover", "people", "msgs", "goto"],
    settings: ["goto", "discover", "people", "msgs"],
    network: ["people", "discover", "msgs", "goto"],
    messages: ["msgs", "people", "discover", "goto"],
};

/** exact 0 · prefix 1 · a word starts with it 2 · contains 3 · no match 4. Lower ranks first. */
export function matchScore(name: string, q: string): 0 | 1 | 2 | 3 | 4 {
    const n = name.trim().toLocaleLowerCase();
    const query = q.trim().toLocaleLowerCase();
    if (!query || !n) return 4;
    if (n === query) return 0;
    if (n.startsWith(query)) return 1;
    if (n.split(/[\s\-_./·]+/).some((word) => word.startsWith(query))) return 2;
    if (n.includes(query)) return 3;
    return 4;
}

/** The text around the first match, so the matched letters can be marked. */
export function splitMatch(text: string, q: string): { a: string; m: string; b: string } {
    const query = q.trim().split(/\s+/)[0] ?? "";
    const at = query ? text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase()) : -1;
    if (at < 0) return { a: text, m: "", b: "" };
    return { a: text.slice(0, at), m: text.slice(at, at + query.length), b: text.slice(at + query.length) };
}

import { normalizeSearchQuery } from "@/lib/search/query";

/** The kinds one search returns (report §3). */
export type SearchKind = "orgs" | "workspaces" | "posts" | "people" | "messages" | "goto";

/** The page you search from; it sets the order, never what is searched. */
export type SearchContextKey = "discover" | "network" | "messages" | "workspace" | "org" | "settings";

export type SearchScope =
    | { kind: "people" }
    | { kind: "channels" }
    | { kind: "actions" }
    | { kind: "in"; place: string }
    | { kind: "only"; only: SearchKind };

/** `@` people, `#` channels, `>` actions and settings, `in:<slug>` one workspace or org (States board, Shortcuts). */
export function parseSearchInput(raw: string): { text: string; scope: SearchScope | null } {
    const value = normalizeSearchQuery(raw);
    const inMatch = value.match(/^in:([^\s]+)\s*(.*)$/i);
    if (inMatch) return { text: normalizeSearchQuery(inMatch[2]), scope: { kind: "in", place: inMatch[1]!.toLowerCase() } };
    const prefix = value[0];
    const rest = () => normalizeSearchQuery(value.slice(1));
    if (prefix === "@") return { text: rest(), scope: { kind: "people" } };
    if (prefix === "#") return { text: rest(), scope: { kind: "channels" } };
    if (prefix === ">") return { text: rest(), scope: { kind: "actions" } };
    return { text: value, scope: null };
}

export function contextFromPath(pathname: string | null): { key: SearchContextKey; place: string | null } {
    const path = (pathname ?? "/").split("?")[0] ?? "/";
    const segments = path.split("/").filter(Boolean);
    const decode = (value: string) => {
        try { return decodeURIComponent(value); } catch { return value; }
    };
    if (segments.length >= 2 && segments[0] === "org") return { key: "org", place: decode(segments[1]!) };
    if (segments.length >= 2 && segments[0] === "workspaces" && segments[1] !== "new") return { key: "workspace", place: decode(segments[1]!) };
    if (segments[0] === "network") return { key: "network", place: null };
    if (segments[0] === "messages") return { key: "messages", place: null };
    if (segments[0] === "settings") return { key: "settings", place: null };
    return { key: "discover", place: null };
}

export function isEmailQuery(q: string) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(q.trim());
}

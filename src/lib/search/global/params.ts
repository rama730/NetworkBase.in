import { normalizeSearchQuery } from "@/lib/search/query";

import { parseSearchInput, type SearchContextKey, type SearchKind, type SearchScope } from "./parse";

const CONTEXTS: readonly SearchContextKey[] = ["discover", "network", "messages", "workspace", "org", "settings"];
const KINDS: readonly SearchKind[] = ["orgs", "workspaces", "posts", "people", "messages", "goto"];

export type SearchParams = { q: string; ctx: SearchContextKey; place: string | null; per: number; exact: boolean; log: boolean; scope: SearchScope | null };

/** `GET /api/v1/search` input: `q` (1–100), `ctx`, `place?`, `per` (1–60, default 3), `only?`, `exact=1`, `log=1`. */
export function parseSearchParams(params: URLSearchParams): { ok: true; value: SearchParams } | { ok: false; error: string } {
    const raw = params.get("q") ?? "";
    if (raw.length > 100) return { ok: false, error: "Search words are at most 100 characters" };
    const { text, scope: typed } = parseSearchInput(raw);
    const ctx = (params.get("ctx") ?? "discover") as SearchContextKey;
    if (!CONTEXTS.includes(ctx)) return { ok: false, error: "Unknown page" };
    const only = params.get("only");
    if (only && !KINDS.includes(only as SearchKind)) return { ok: false, error: "Unknown kind" };
    const scope: SearchScope | null = typed ?? (only ? { kind: "only", only: only as SearchKind } : null);
    if (!text && scope?.kind !== "channels") return { ok: false, error: "Type something to search" };
    const per = Math.min(60, Math.max(1, Number.parseInt(params.get("per") ?? "3", 10) || 3));
    const place = normalizeSearchQuery(params.get("place") ?? "", 200) || null;
    return { ok: true, value: { q: text, ctx, place, per, exact: params.get("exact") === "1", log: params.get("log") === "1", scope } };
}

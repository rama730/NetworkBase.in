import { ORDER } from "@/lib/search/global/rank";
import type { SearchContextKey } from "@/lib/search/global/parse";
import type { GlobalSearchResult, SearchHit } from "@/lib/search/global/types";

export type BoxGroupKind = SearchHit["kind"];
export type BoxGroup = { kind: BoxGroupKind; label: string; count: number; rows: SearchHit[]; hasMore: boolean };
export type BoxGroups = { best: SearchHit | null; groups: BoxGroup[]; flat: SearchHit[]; total: number };

export const GROUP_LABEL: Record<BoxGroupKind, string> = {
    orgs: "Organizations",
    workspaces: "Workspaces",
    posts: "Posts",
    people: "People",
    messages: "Your messages",
    goto: "Go to",
    channels: "Channels",
    scope: "In this place",
};

const ROWS = 3;
const BEST_KINDS: BoxGroupKind[] = ["people", "orgs", "workspaces"];

/** The box's groups in the page's order (report §3): the place you're in first, then kinds, 3 rows each. */
export function buildBoxGroups(
    result: GlobalSearchResult,
    ctx: SearchContextKey,
    extra: { goto?: SearchHit[]; placeName?: string | null } = {},
): BoxGroups {
    const order: BoxGroupKind[] = ["scope", "channels", ...ORDER[ctx]];
    const lists: Partial<Record<BoxGroupKind, SearchHit[]>> = { ...result.groups, goto: extra.goto ?? [] };
    const best = order.filter((kind) => BEST_KINDS.includes(kind))
        .map((kind) => lists[kind]?.find((row) => row.score === 0))
        .find(Boolean) ?? null;
    const groups: BoxGroup[] = [];
    for (const kind of order) {
        const all = (lists[kind] ?? []).filter((row) => row.id !== best?.id);
        if (!all.length) continue;
        const count = Math.max(result.counts[kind] ?? 0, (lists[kind] ?? []).length) - (best && best.kind === kind ? 1 : 0);
        const rows = all.slice(0, ROWS);
        const label = kind === "scope" && extra.placeName ? `In ${extra.placeName}` : GROUP_LABEL[kind];
        groups.push({ kind, label, count, rows, hasMore: count > rows.length && kind !== "goto" && kind !== "scope" });
    }
    const flat = [...(best ? [best] : []), ...groups.flatMap((group) => group.rows)];
    const total = (best ? 1 : 0) + groups.reduce((sum, group) => sum + group.count, 0);
    return { best, groups, flat, total };
}

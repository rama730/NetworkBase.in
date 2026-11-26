import "server-only";

import { logger } from "@/lib/logger";
import { normalizeSearchQuery } from "@/lib/search/query";

import { correctTypo, skillCard, suggestions } from "./extras";
import { searchChannels, searchEmail, searchMessageHits, searchPeople, searchPlaces, searchPosts } from "./kinds";
import { isEmailQuery, type SearchContextKey, type SearchKind, type SearchScope } from "./parse";
import type { GlobalSearchResult, SearchHit } from "./types";

export type RunGlobalSearchInput = {
    viewerId: string;
    q: string;
    ctx: SearchContextKey;
    /** The workspace or org you're in (its slug or id), for "In {name}" results first. */
    place: string | null;
    scope: SearchScope | null;
    /** Rows kept per kind: 3 in the box, up to 60 on the results page. */
    perKind: number;
    /** "Search “reakt” instead": no typo correction. */
    exact?: boolean;
};

type GroupKey = SearchHit["kind"];
// ponytail: counts are of what was fetched (21 for the box, 60 for the page). Upgrade: COUNT queries if people need exact totals.
const fetchLimit = (perKind: number) => (perKind <= 6 ? 21 : 60);

const safely = async (kind: string, read: () => Promise<SearchHit[]>) => {
    try {
        return await read();
    } catch (error) {
        logger.warn("global_search.kind_failed", { kind, error: error instanceof Error ? error.message : String(error) });
        return [];
    }
};

/** Results inside the workspace or org you're in: the org's own search, or the workspace's tasks and links. */
async function searchScope(q: string, ctx: SearchContextKey, place: string): Promise<SearchHit[]> {
    if (ctx === "org") {
        const { searchOrgPreviewsAction } = await import("@/app/actions/org-workspace");
        const found = await searchOrgPreviewsAction(q, place);
        return found.filter((row) => row.kind !== "org").map((row) => ({
            id: `scope:${row.kind}:${row.id}`, kind: "scope", title: row.title, sub: row.subtitle, href: row.href, why: row.chip,
            score: 3, createdAt: null, avatarUrl: null, tags: [], act: null, meta: { scopeKind: row.kind },
        }));
    }
    const { fetchWorkspaceLinkPreviewsAction, fetchWorkspaceTaskPreviewsAction } = await import("@/app/actions/workspace");
    const [tasks, links] = await Promise.all([
        fetchWorkspaceTaskPreviewsAction({ slugOrId: place, search: q, limit: 6 }),
        fetchWorkspaceLinkPreviewsAction({ slugOrId: place, search: q, limit: 6 }),
    ]);
    const taskHits: SearchHit[] = tasks.success ? tasks.tasks.map((task) => {
        const code = task.projectKey && task.taskNumber ? `${task.projectKey}-${task.taskNumber}` : task.id;
        return {
            id: `scope:task:${task.id}`, kind: "scope", title: task.title, sub: `${code} · ${task.status.replaceAll("_", " ")}`,
            href: `/workspaces/${encodeURIComponent(place)}?tab=tasks&drawerType=task&drawerId=${encodeURIComponent(code)}`,
            why: null, score: 3, createdAt: null, avatarUrl: null, tags: [], act: null, meta: { scopeKind: "task" },
        };
    }) : [];
    const linkHits: SearchHit[] = links.success ? links.links.map((link) => ({
        id: `scope:link:${link.id}`, kind: "scope", title: link.title, sub: link.subtitle, href: link.href, why: null,
        score: 3, createdAt: null, avatarUrl: null, tags: [], act: null, meta: { scopeKind: "link", external: true },
    })) : [];
    return [...taskHits, ...linkHits];
}

function kindsFor(scope: SearchScope | null): Array<SearchKind | "channels" | "scope"> {
    if (!scope) return ["orgs", "workspaces", "posts", "people", "messages"];
    if (scope.kind === "people") return ["people"];
    if (scope.kind === "channels") return ["channels"];
    if (scope.kind === "actions") return [];
    if (scope.kind === "in") return ["scope"];
    return scope.only === "goto" ? [] : [scope.only];
}

async function fanOut(input: RunGlobalSearchInput, q: string) {
    const limit = fetchLimit(input.perKind);
    const place = input.scope?.kind === "in" ? input.scope.place : input.place;
    const wanted = kindsFor(input.scope);
    const read = (kind: GroupKey): Promise<SearchHit[]> => {
        switch (kind) {
            case "orgs": return safely(kind, () => searchPlaces(input.viewerId, q, "organization", limit));
            case "workspaces": return safely(kind, () => searchPlaces(input.viewerId, q, "workspace", limit));
            case "posts": return safely(kind, () => searchPosts(input.viewerId, q, Math.min(limit, 12)));
            case "people": return safely(kind, () => searchPeople(input.viewerId, q, limit));
            case "messages": return safely(kind, () => searchMessageHits(input.viewerId, q, Math.min(limit, 50)));
            case "channels": return safely(kind, () => searchChannels(input.viewerId, q, limit));
            case "scope": return place && (input.ctx === "org" || input.ctx === "workspace" || input.scope?.kind === "in")
                ? safely(kind, () => searchScope(q, input.ctx === "org" ? "org" : "workspace", place)) : Promise.resolve([]);
            default: return Promise.resolve([]);
        }
    };
    // The place you're in comes first in the box, above Everywhere.
    const kinds = place && !input.scope && (input.ctx === "org" || input.ctx === "workspace") ? ["scope" as const, ...wanted] : wanted;
    const found = await Promise.all(kinds.map(async (kind) => [kind, await read(kind)] as const));
    const groups: GlobalSearchResult["groups"] = {};
    const counts: GlobalSearchResult["counts"] = {};
    for (const [kind, hits] of found) {
        counts[kind] = hits.length;
        groups[kind] = hits.slice(0, input.perKind);
    }
    return { groups, counts };
}

/** One search for everything the viewer may see (report §3–§6). The page sets the order on the client, not here. */
export async function runGlobalSearch(input: RunGlobalSearchInput): Promise<GlobalSearchResult> {
    const started = Date.now();
    const typed = normalizeSearchQuery(input.q);
    const empty: GlobalSearchResult = { q: typed, fixedFrom: null, groups: {}, counts: {}, skill: null, suggestions: [], email: null, tookMs: 0 };
    if (!typed && input.scope?.kind !== "channels") return empty;

    if (isEmailQuery(typed) && !input.scope) {
        const person = await searchEmail(input.viewerId, typed).catch(() => null);
        return { ...empty, email: person ? { kind: "person", hit: person } : { kind: "invite", address: typed }, tookMs: Date.now() - started };
    }

    const [first, skill, words] = await Promise.all([
        fanOut(input, typed),
        input.scope ? Promise.resolve(null) : skillCard(typed).catch(() => null),
        input.scope ? Promise.resolve([]) : suggestions(typed).catch(() => []),
    ]);
    const nothing = Object.values(first.counts).every((count) => !count);
    if (nothing && !input.exact && !input.scope) {
        const fixed = await correctTypo(typed).catch(() => null);
        if (fixed) {
            const [second, fixedSkill] = await Promise.all([fanOut(input, fixed), skillCard(fixed).catch(() => null)]);
            if (Object.values(second.counts).some(Boolean)) {
                return { q: fixed, fixedFrom: typed, ...second, skill: fixedSkill, suggestions: words, email: null, tookMs: Date.now() - started };
            }
        }
    }
    return { q: typed, fixedFrom: null, ...first, skill, suggestions: words, email: null, tookMs: Date.now() - started };
}

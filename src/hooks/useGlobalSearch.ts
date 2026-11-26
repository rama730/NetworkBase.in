"use client";

import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useDebounce } from "use-debounce";
import { get as getIdb, set as setIdb } from "idb-keyval";

import { queryKeys } from "@/lib/query-keys";
import { normalizeSearchQuery } from "@/lib/search/query";
import type { SearchContextKey, SearchKind } from "@/lib/search/global/parse";
import type { GlobalSearchResult } from "@/lib/search/global/types";

export type SearchRequest = { q: string; ctx: SearchContextKey; place?: string | null; per: number; only?: SearchKind | null; exact?: boolean; log?: boolean };

export function searchUrl(request: SearchRequest) {
    const params = new URLSearchParams({ q: request.q, ctx: request.ctx, per: String(request.per) });
    if (request.place) params.set("place", request.place);
    if (request.only) params.set("only", request.only);
    if (request.exact) params.set("exact", "1");
    if (request.log) params.set("log", "1");
    return `/api/v1/search?${params.toString()}`;
}

/** "Showing results from 2 minutes ago" (States board, Busy or offline). */
export function ageLabel(at: number, now = Date.now()) {
    const seconds = Math.max(0, Math.round((now - at) / 1000));
    if (seconds < 60) return "a moment ago";
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
    const hours = Math.round(minutes / 60);
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
}

export class GlobalSearchError extends Error {
    constructor(message: string, readonly status: number) { super(message); }
}

type Answer = { result: GlobalSearchResult; staleAt: number | null };
const cacheKey = (url: string) => `global-search:v2:${url}`;

/**
 * The box's one read (global search mix §5, speed budget): 120 ms after typing, one GET, older calls aborted, the
 * same words cached 60 s. While new results come the old ones stay (dimmed); when the line is busy or offline the
 * last answer for these words is served with its age.
 */
export function useGlobalSearch({ q, ctx, place = null, enabled, per = 3, only = null, exact = false, log = false }: SearchRequest & { enabled: boolean }) {
    const [debounced] = useDebounce(normalizeSearchQuery(q), 120);
    const url = searchUrl({ q: debounced, ctx, place, per, only, exact, log });
    const query = useQuery<Answer, GlobalSearchError>({
        queryKey: queryKeys.globalSearch.all(ctx, place, debounced.toLowerCase(), per, only, exact),
        queryFn: async ({ signal }) => {
            try {
                const response = await fetch(url, { signal, headers: { accept: "application/json" } });
                const body = await response.json().catch(() => null) as { success?: boolean; data?: GlobalSearchResult; message?: string } | null;
                if (!response.ok || !body?.success || !body.data) throw new GlobalSearchError(body?.message || "Couldn’t search just now", response.status);
                void setIdb(cacheKey(url), { at: Date.now(), result: body.data }).catch(() => undefined);
                return { result: body.data, staleAt: null };
            } catch (error) {
                if (signal.aborted) throw error;
                const kept = await getIdb<{ at: number; result: GlobalSearchResult }>(cacheKey(url)).catch(() => undefined);
                if (kept) return { result: kept.result, staleAt: kept.at };
                throw error instanceof GlobalSearchError ? error : new GlobalSearchError("Couldn’t search just now", 0);
            }
        },
        enabled: enabled && (debounced.length >= 1),
        placeholderData: keepPreviousData,
        staleTime: 60_000,
        gcTime: 5 * 60_000,
        retry: false,
        refetchOnWindowFocus: false,
    });

    // "Still searching" after 2 s of waiting (States board, Loading and a slow line).
    const [slow, setSlow] = useState(false);
    useEffect(() => {
        if (!query.isFetching) { setSlow(false); return; }
        const timer = window.setTimeout(() => setSlow(true), 2000);
        return () => window.clearTimeout(timer);
    }, [query.isFetching]);

    const typed = normalizeSearchQuery(q);
    return {
        result: query.data?.result ?? null,
        staleAt: query.data?.staleAt ?? null,
        error: query.error,
        isFetching: query.isFetching || typed !== debounced,
        /** Nothing to show yet: skeleton rows (first search only). */
        isFirstLoad: !query.data && (query.isFetching || typed !== debounced) && typed.length > 0,
        /** The rows on screen are for older words: dim them. */
        isPlaceholder: query.isPlaceholderData || (typed !== debounced && Boolean(query.data)),
        slow,
        retry: () => void query.refetch(),
    };
}

"use client";

import { Bookmark, TrendingUp } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

import type { SavedSearch } from "@/lib/search/global/saved";
import { savedSearchHref } from "@/lib/search/global/saved-href";

type Extras = { saved: SavedSearch[]; trending: string[] };
const NOTIFY_LABEL = { weekly: "Weekly", daily: "Daily", off: "No alerts" } as const;

/** Saved searches with what's new, and "Trending near you" (BoxMore board, Saved and trending). */
export function useBoxExtras({ enabled, ownerId }: { enabled: boolean; ownerId: string }) {
    return useQuery<Extras>({
        queryKey: ["global-search", "extras", ownerId],
        queryFn: async ({ signal }) => {
            const response = await fetch("/api/v1/search/saved", { signal });
            const body = await response.json().catch(() => null) as { success?: boolean; data?: Extras } | null;
            return body?.success && body.data ? body.data : { saved: [], trending: [] };
        },
        enabled: enabled && Boolean(ownerId),
        staleTime: 60_000,
        refetchOnWindowFocus: false,
    }).data ?? { saved: [], trending: [] };
}

export function BoxExtras({ extras, onPick, onOpenSaved }: { extras: Extras; onPick: (value: string) => void; onOpenSaved: (href: string) => void }) {
    return (
        <>
            {extras.saved.length ? (
                <section>
                    <div className="nb-sx-glabel nb-micro"><b>Saved</b><span className="nb-sx-rule" /></div>
                    {extras.saved.map((item) => (
                        <div key={item.id} className="nb-sx-row">
                            <button type="button" className="nb-sx-row-main" onClick={() => {
                                void fetch("/api/v1/search/saved", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: item.id, seen: true }) }).catch(() => undefined);
                                onOpenSaved(savedSearchHref(item.query, item.tab, item.filters));
                            }}>
                                <span className="nb-sx-icon" aria-hidden><Bookmark className="size-4" /></span>
                                <span className="nb-sx-tx"><span className="nb-sx-t1 nb-ui-label">{item.query}</span><span className="nb-sx-t2 nb-meta">{item.tab === "people" ? "People" : item.tab === "msgs" ? "Messages" : "Discover"} · {NOTIFY_LABEL[item.notify]}</span></span>
                            </button>
                            {item.newCount ? <span className="nb-sx-new">{item.newCount} NEW</span> : null}
                        </div>
                    ))}
                </section>
            ) : null}
            {extras.trending.length ? (
                <section>
                    <div className="nb-sx-glabel nb-micro"><b>Trending near you</b><span className="nb-sx-rule" /></div>
                    <div className="nb-sx-chips">
                        {extras.trending.map((word) => (
                            <button key={word} type="button" className="nb-tag nb-sx-chip" onClick={() => onPick(word)}><TrendingUp className="size-3.5" aria-hidden />{word}</button>
                        ))}
                    </div>
                </section>
            ) : null}
        </>
    );
}

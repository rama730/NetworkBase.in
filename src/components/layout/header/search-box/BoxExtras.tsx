"use client";

import type { ReactNode } from "react";
import { Bookmark, TrendingUp } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

import type { SavedSearch } from "@/lib/search/global/saved";
import type { SearchHit } from "@/lib/search/global/types";
import { HitAvatar, KIND_LABEL, Marked } from "./BoxRow";

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

export function BoxExtras({ extras, onPick, onOpenSaved }: { extras: Extras; onPick: (value: string) => void; onOpenSaved: (value: string) => void }) {
    return (
        <>
            {extras.saved.length ? (
                <section>
                    <div className="nb-sx-glabel"><b>Saved</b><span className="nb-sx-rule" /></div>
                    {extras.saved.map((item) => (
                        <div key={item.id} className="nb-sx-row">
                            <button type="button" className="nb-sx-row-main" onClick={() => {
                                void fetch("/api/v1/search/saved", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: item.id, seen: true }) }).catch(() => undefined);
                                onOpenSaved(item.query);
                            }}>
                                <span className="nb-sx-icon" aria-hidden><Bookmark className="size-4" /></span>
                                <span className="nb-sx-tx"><span className="nb-sx-t1">{item.query}</span><span className="nb-sx-t2">{item.tab === "people" ? "People" : item.tab === "msgs" ? "Messages" : "Discover"} · {NOTIFY_LABEL[item.notify]}</span></span>
                            </button>
                            {item.newCount ? <span className="nb-sx-new">{item.newCount} NEW</span> : null}
                        </div>
                    ))}
                </section>
            ) : null}
            {extras.trending.length ? (
                <section>
                    <div className="nb-sx-glabel"><b>Trending near you</b><span className="nb-sx-rule" /></div>
                    <div className="nb-sx-chips">
                        {extras.trending.map((word) => (
                            <button key={word} type="button" className="nb-sx-chip" onClick={() => onPick(word)}><TrendingUp className="size-3.5" aria-hidden />{word}</button>
                        ))}
                    </div>
                </section>
            ) : null}
        </>
    );
}

/** Wide screens: the row you're on, with its facts and main action, beside the list (BoxMore board, Preview while you move). */
export function BoxPreview({ hit, q, action, onOpen }: { hit: SearchHit; q: string; action: ReactNode; onOpen: () => void }) {
    const facts: Array<[string, string]> = [];
    const m = hit.meta;
    if (hit.kind === "people") {
        if (m.relation) facts.push(["Relationship", String(m.relation)]);
        if (m.mutual) facts.push(["Mutual", String(m.mutual)]);
        if (m.location) facts.push(["Location", String(m.location)]);
    } else if (hit.kind === "orgs" || hit.kind === "workspaces") {
        if (m.updatedBy) facts.push(["Updated by", String(m.updatedBy)]);
        facts.push(["Followers", String(m.followers ?? 0)]);
        if (Number(m.openRoles)) facts.push(["Open roles", String(m.openRoles)]);
        if (m.openToCollaborate) facts.push(["Status", "Open to collaborate"]);
    } else if (hit.kind === "posts") {
        if (m.place) facts.push(["In", String(m.place)]);
        facts.push(["Likes", String(m.likes ?? 0)]);
    } else if (hit.kind === "messages") {
        if (m.place) facts.push(["Conversation", String(m.place)]);
        if (m.hasFile) facts.push(["Has", "A file"]);
    }
    return (
        <aside className="nb-sx-preview" aria-label={`Preview of ${hit.title}`}>
            <div className="nb-sx-preview-hd">
                <HitAvatar hit={hit} size={48} />
                <span className="nb-sx-tx">
                    <span className="nb-sx-best-t"><Marked text={hit.title} q={q} /></span>
                    <span className="nb-sx-t2">{KIND_LABEL[hit.kind]}{hit.kind === "people" && m.headline ? ` · ${String(m.headline)}` : ""}</span>
                </span>
            </div>
            {hit.kind !== "people" ? <p className="nb-sx-preview-text">{hit.sub}</p> : null}
            {facts.length ? <dl className="nb-sx-facts">{facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl> : null}
            {hit.tags.length ? <div className="nb-sx-chips">{hit.tags.map((tag) => <span key={tag} className="nb-sx-tag">{tag}</span>)}</div> : null}
            <div className="nb-sx-preview-acts">
                {action}
                <button type="button" className="nb-sx-btn" onClick={onOpen}>{hit.kind === "people" ? "View profile" : hit.kind === "messages" ? "Jump to message" : "Open"} <kbd className="nb-sx-kbd">↵</kbd></button>
            </div>
        </aside>
    );
}

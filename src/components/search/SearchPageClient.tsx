"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Bell, LayoutGrid, Link2, List, Search, SlidersHorizontal, X } from "lucide-react";

import { BoxPreview } from "@/components/layout/header/search-box/BoxExtras";
import { HitAvatar, KIND_LABEL, Marked } from "@/components/layout/header/search-box/BoxRow";
import { SettingControl } from "@/components/layout/header/search-box/SettingControl";
import "@/components/layout/header/search-box/search-box.css";
import { CONNECTION_COPY } from "@/lib/connections/copy";
import { copyText } from "@/lib/clipboard";
import { toast } from "@/lib/feedback";
import { confirmAppNavigation } from "@/lib/navigation/confirm-navigation";
import { getConnectionRequestSuccessMessage, useConnectionMutations } from "@/hooks/useConnections";
import { searchGoto } from "@/lib/search/global/goto";
import { TAB_ORDER, type SearchTab } from "@/lib/search/global/rank";
import type { GlobalSearchResult, SearchHit } from "@/lib/search/global/types";
import { applyFilters, clearFilters, nextPeek, ORG_TYPE_LABEL, serializeSearchPageState, SORTS, toggleFacet, type FacetKey, type SearchPageState } from "@/lib/search/global/url-state";
import { formatDistanceToNow } from "@/lib/utils/date";
import { TabMarker } from "@/components/ui/TabMarker";
import { readOpened, rememberOpened } from "./opened";
import "./search-page.css";

type Saved = { id: string; notify: "weekly" | "daily" | "off" } | null;
const TAB_LABEL: Record<SearchTab, string> = { discover: "Discover", people: "People", msgs: "Messages", goto: "Go to" };
const NOTIFY: Array<"weekly" | "daily" | "off"> = ["weekly", "daily", "off"];
const ORDER_LINE: Record<SearchTab, string> = {
    discover: "Organizations, workspaces and posts first, because you searched from Discover.",
    people: "People first, because you searched from Network.",
    msgs: "Your messages first, because you searched from Messages.",
    goto: "Settings and pages first, because you searched from Settings.",
};
const when = (at: string | null) => (at ? formatDistanceToNow(new Date(at), { addSuffix: true }) : "");

export default function SearchPageClient({ initialState, result, saved }: { initialState: SearchPageState; result: GlobalSearchResult | null; saved: Saved }) {
    const router = useRouter();
    const [state, setState] = useState<SearchPageState>({ ...initialState, peek: null });
    const [savedRow, setSavedRow] = useState<Saved>(saved);
    const [opened, setOpened] = useState<string | null>(null);
    const [filtersOpen, setFiltersOpen] = useState(false);
    const [typed, setTyped] = useState(initialState.q);
    const resultsRef = useRef<HTMLDivElement>(null);
    const { sendRequest } = useConnectionMutations();
    const address = serializeSearchPageState(state);

    useEffect(() => { setOpened(readOpened(window.sessionStorage, address)); }, [address]);
    const update = (next: SearchPageState) => {
        setState(next);
        // Filters, tabs and sorts change the address only: the results are already here (Next keeps useSearchParams in step).
        window.history.replaceState(null, "", `/search?${serializeSearchPageState(next)}`);
    };
    const facet = (key: FacetKey, value: string) => update(toggleFacet(state, key, value));

    const goto = useMemo(() => searchGoto(state.q, { place: null }), [state.q]);
    const view = useMemo(() => (result ? applyFilters(result, state, goto) : null), [goto, result, state]);
    const tabs = TAB_ORDER[state.ctx];
    const total = view ? Object.values(view.tabCounts).reduce((sum, count) => sum + count, 0) : 0;
    const hits = (view?.rows ?? []).flatMap((row) => (row.type === "hit" && row.hit.kind !== "goto" ? [row.hit] : []));
    const pool = result ? [...(result.groups.people ?? []), ...(result.groups.orgs ?? []), ...(result.groups.workspaces ?? []), ...(result.groups.posts ?? []), ...(result.groups.messages ?? [])] : [];
    const peek = state.peek ? pool.find((hit) => hit.id === state.peek) ?? null : null;
    const top = state.tab === "discover" && result ? [...(result.groups.people ?? []), ...(result.groups.orgs ?? []), ...(result.groups.workspaces ?? [])].find((hit) => hit.score === 0) ?? null : null;
    const showSkill = Boolean(result?.skill) && (state.tab === "discover" || state.tab === "people");
    const railPeople = state.tab !== "people";
    const rail = result ? (railPeople ? (result.groups.people ?? []) : [...(result.groups.orgs ?? []), ...(result.groups.workspaces ?? [])]).slice(0, 4) : [];
    const related = Array.from(new Set([...(result?.suggestions ?? []), ...(view?.facets.find((f) => f.key === "skill")?.opts.map((o) => o.value.toLowerCase()) ?? [])]))
        .filter((word) => word && word !== state.q.toLowerCase()).slice(0, 6);

    const open = (hit: SearchHit) => {
        if (hit.meta.external) { window.open(hit.href, "_blank", "noopener,noreferrer"); return; }
        rememberOpened(window.sessionStorage, address, hit.id);
        confirmAppNavigation(() => router.push(hit.href));
    };
    const newSearch = (q: string, extra: Record<string, string> = {}) => {
        const params = new URLSearchParams({ q, ...extra });
        if (state.ctx !== "discover") params.set("ctx", state.ctx);
        confirmAppNavigation(() => router.push(`/search?${params.toString()}`));
    };
    const connect = async (hit: SearchHit) => {
        try {
            await toast.promise(sendRequest.mutateAsync({ userId: String(hit.meta.userId) }), {
                loading: CONNECTION_COPY.sending,
                success: (response) => getConnectionRequestSuccessMessage(response.status),
                error: (error) => (error instanceof Error ? error.message : CONNECTION_COPY.sendFailed),
            }).unwrap();
        } catch { /* the shared toast reports it */ }
    };
    const action = (hit: SearchHit) => {
        if (hit.kind === "people" && hit.act === "Connect") return <button type="button" className="nb-sx-btn nb-sp-pri" onClick={(e) => { e.stopPropagation(); void connect(hit); }}>Connect</button>;
        if (hit.kind === "people" && hit.act === "Message") return <Link className="nb-sx-btn" href={`/messages?userId=${encodeURIComponent(String(hit.meta.userId))}`} onClick={(e) => e.stopPropagation()}>Message</Link>;
        if (hit.kind === "people" && hit.act === "Pending") return <span className="nb-sx-btn" aria-disabled="true">Pending</span>;
        if (hit.kind === "orgs" || hit.kind === "workspaces") return <Link className="nb-sx-btn" href={hit.href} onClick={(e) => { e.stopPropagation(); rememberOpened(window.sessionStorage, address, hit.id); }}>{hit.meta.mine ? "Open" : "View"}</Link>;
        return null;
    };

    const save = async () => {
        if (savedRow) {
            const response = await fetch(`/api/v1/search/saved?id=${encodeURIComponent(savedRow.id)}`, { method: "DELETE" }).catch(() => null);
            if (response?.ok) { setSavedRow(null); toast.success("Removed from saved searches"); } else toast.error("Couldn’t remove it just now");
            return;
        }
        const filters = Object.fromEntries(new URLSearchParams(address).entries());
        delete filters.q; delete filters.tab; delete filters.more; delete filters.sort; delete filters.view;
        const response = await fetch("/api/v1/search/saved", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: state.q, tab: state.tab, filters, notify: "weekly" }) }).catch(() => null);
        const body = await response?.json().catch(() => null) as { data?: { id: string }; message?: string } | null;
        if (response?.ok && body?.data?.id) {
            setSavedRow({ id: body.data.id, notify: "weekly" });
            toast.success(`Saved. New matches for “${state.q}” reach you weekly; it’s also under Saved in the search box.`);
        } else toast.error(body?.message ?? "Couldn’t save this search");
    };
    const cycleNotify = async () => {
        if (!savedRow) return;
        const notify = NOTIFY[(NOTIFY.indexOf(savedRow.notify) + 1) % NOTIFY.length]!;
        const response = await fetch("/api/v1/search/saved", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: savedRow.id, notify }) }).catch(() => null);
        if (response?.ok) { setSavedRow({ ...savedRow, notify }); toast.success(`New matches: ${notify}`); } else toast.error("Couldn’t change the alerts");
    };

    const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if ((event.target as HTMLElement).closest("input, textarea, select, [contenteditable]")) return;
        if (event.key === "Enter" && peek) { event.preventDefault(); open(peek); return; }
        if (!["j", "k", "ArrowDown", "ArrowUp", " ", "Escape"].includes(event.key)) return;
        event.preventDefault();
        setState((current) => ({ ...current, peek: nextPeek(hits.map((hit) => hit.id), current.peek ?? null, event.key) }));
    };

    if (!state.q) {
        return (
            <div data-scroll-root="route" className="nb-sp-scroll"><div className="nb-sp">
                <h1 className="nb-sp-title">Search NetworkBase</h1>
                <p className="nb-sp-why">Type in the box above, or press ⌘K anywhere.</p>
            </div></div>
        );
    }

    return (
        <div data-scroll-root="route" className="nb-sp-scroll">
            <div className="nb-sp">
                <form className="nb-sp-box" onSubmit={(event) => { event.preventDefault(); if (typed.trim()) newSearch(typed.trim()); }}>
                    <Search className="size-4 text-muted-foreground" aria-hidden />
                    <input type="search" aria-label="Search NetworkBase" value={typed} onChange={(event) => setTyped(event.target.value)} maxLength={100} placeholder="Search people, workspaces, organizations, posts…" />
                </form>

                <header className="nb-sp-head">
                    <div className="min-w-0">
                        <h1 className="nb-sp-title">Results for “{state.q}”</h1>
                        <p className="nb-sp-why">{total} results · {ORDER_LINE[tabs[0]!]}</p>
                    </div>
                    <div className="nb-sp-acts">
                        <button type="button" className={savedRow ? "nb-sx-btn nb-sp-pri" : "nb-sx-btn"} onClick={() => void save()} aria-pressed={Boolean(savedRow)}>{savedRow ? "Saved search" : "Save search"}</button>
                        {savedRow ? <button type="button" className="nb-sx-btn" onClick={() => void cycleNotify()}><Bell className="size-3.5" aria-hidden />New matches: {savedRow.notify}</button> : null}
                        <button type="button" className="nb-sx-btn" onClick={() => { void copyText(window.location.href).then(() => toast.success("Link copied · it opens these same results; private ones drop out for others"), () => toast.error("Couldn’t copy the link")); }}><Link2 className="size-3.5" aria-hidden />Copy link</button>
                    </div>
                </header>

                {result?.fixedFrom ? (
                    <p className="nb-sp-typo">Showing results for <b>{result.q}</b> · <button type="button" className="nb-sx-link" onClick={() => newSearch(result.fixedFrom!, { exact: "1" })}>Search “{result.fixedFrom}” instead</button></p>
                ) : null}

                <div className="nb-sp-tabs" role="tablist" aria-label="Result kinds">
                    <TabMarker overlap />
                    {tabs.map((tab) => (
                        <button key={tab} type="button" role="tab" aria-selected={state.tab === tab} className="nb-sp-tab" onClick={() => update({ ...state, tab, sort: 0, more: 0, peek: null })}>
                            {TAB_LABEL[tab]}<span className="nb-sx-count">{view?.tabCounts[tab] ?? 0}</span>
                        </button>
                    ))}
                </div>

                <div className="nb-sp-bar">
                    <button type="button" className="nb-sx-btn nb-sp-filters-btn" onClick={() => setFiltersOpen((value) => !value)} aria-expanded={filtersOpen}><SlidersHorizontal className="size-3.5" aria-hidden />Filters</button>
                    {view?.chips.map((chip) => (
                        <span key={`${chip.key}:${chip.value}:${chip.label}`} className="nb-sp-chip">{chip.label}<button type="button" aria-label={`Remove ${chip.label}`} onClick={() => facet(chip.key, chip.value)}><X className="size-3" aria-hidden /></button></span>
                    ))}
                    {view?.chips.length ? <button type="button" className="nb-sx-link" onClick={() => update(clearFilters(state))}>Clear all</button> : <span className="nb-sp-meta">No filters · pick filters on the left, or a skill</span>}
                    <span className="nb-sp-bar-end">
                        {SORTS[state.tab].length > 1 ? <button type="button" className="nb-sx-btn" onClick={() => update({ ...state, sort: (state.sort + 1) % SORTS[state.tab].length, more: 0 })}>Sort: {view?.sortLabel}</button> : null}
                        <span className="nb-sx-seg" role="group" aria-label="View">
                            <button type="button" aria-pressed={state.view === "cards"} onClick={() => update({ ...state, view: "cards" })}><LayoutGrid className="size-3.5" aria-hidden /><span className="sr-only">Cards</span></button>
                            <button type="button" aria-pressed={state.view === "list"} onClick={() => update({ ...state, view: "list" })}><List className="size-3.5" aria-hidden /><span className="sr-only">List</span></button>
                        </span>
                    </span>
                </div>

                <div className="nb-sp-cols">
                    <aside className="nb-sp-facets" data-open={filtersOpen || undefined} aria-label="Filters">
                        {view?.facets.map((group) => group.opts.length ? (
                            <section key={group.key} className="nb-sp-facet">
                                {group.title ? <h2>{group.title}</h2> : null}
                                {group.opts.map((option) => (
                                    <button key={option.value} type="button" className="nb-sp-fopt" data-zero={option.zero || undefined} aria-pressed={option.on} onClick={() => facet(group.key, option.value)}>
                                        <span>{option.label}</span><span className="nb-sx-count">{option.count}</span>
                                    </button>
                                ))}
                            </section>
                        ) : null)}
                        {state.tab === "msgs" ? <p className="nb-sp-meta">Only conversations you’re in.</p> : null}
                    </aside>

                    <div className="nb-sp-main" ref={resultsRef} tabIndex={-1} onKeyDown={onKeyDown} aria-label="Results. J and K move, Space opens quick look.">
                        {showSkill && result?.skill ? (
                            <div className="nb-sp-skill">
                                <span className="nb-sx-icon nb-sp-skill-ic" aria-hidden>{result.skill.name.slice(0, 2).toUpperCase()}</span>
                                <span className="min-w-0 flex-1"><b>{result.skill.name}</b><span className="nb-sp-meta"> · {result.skill.people >= 100 ? "100+" : result.skill.people} people · {result.skill.workspaces} workspaces · {result.skill.orgs} organizations</span></span>
                                <button type="button" className={state.skills.includes(result.skill.name) ? "nb-sx-btn nb-sp-pri" : "nb-sx-btn"} onClick={() => facet("skill", result.skill!.name)}>
                                    {state.skills.includes(result.skill.name) ? `Filtering by ${result.skill.name}` : `Only things tagged ${result.skill.name}`}
                                </button>
                            </div>
                        ) : null}
                        {top ? (
                            <div className="nb-sp-top" data-picked={state.peek === top.id || undefined}>
                                <HitAvatar hit={top} size={48} />
                                <button type="button" className="nb-sp-top-tx" onClick={() => setState({ ...state, peek: top.id })}>
                                    <span className="nb-sp-meta">Top hit · {KIND_LABEL[top.kind]}</span>
                                    <b>{top.title}</b>
                                    <span className="nb-sp-meta">{top.sub}{top.meta.relation ? ` · ${String(top.meta.relation)}` : ""}</span>
                                </button>
                                {action(top)}
                            </div>
                        ) : null}

                        {view?.rows.map((row, index) => {
                            if (row.type === "head") return <div key={`h:${row.label}`} className="nb-sx-glabel"><b>{row.label}</b><span className="nb-sx-count">{row.count}</span><span className="nb-sx-rule" /></div>;
                            if (row.type === "conv") return <div key={`c:${row.label}:${index}`} className="nb-sp-conv">{row.label}</div>;
                            const hit = row.hit;
                            if (hit.kind === "goto") {
                                return (
                                    <div key={hit.id} className="nb-sp-go">
                                        <span className="min-w-0 flex-1"><b><Marked text={hit.title} q={state.q} /></b><span className="nb-sp-meta block">{hit.sub}</span></span>
                                        {hit.meta.control === "theme" || hit.meta.control === "findMe" ? <SettingControl control={hit.meta.control} /> : null}
                                        <Link className="nb-sx-btn" href={hit.href}>Open</Link>
                                    </div>
                                );
                            }
                            return <ResultItem key={hit.id} hit={hit} q={state.q} list={state.view === "list"} picked={state.peek === hit.id || opened === hit.id} onPeek={() => setState({ ...state, peek: state.peek === hit.id ? null : hit.id })} onOpen={() => open(hit)} action={action(hit)} />;
                        })}

                        {view && view.tabTotal > view.shown && state.tab !== "goto" ? (
                            <button type="button" className="nb-sx-btn nb-sp-more" onClick={() => update({ ...state, more: state.more + 1 })}>Show more · Showing {view.shown} of {view.tabTotal}</button>
                        ) : null}
                        {view && !view.rows.length ? (
                            total === 0 ? (
                                <div className="nb-sx-empty">
                                    <b>Nothing called “{state.q}” yet</b>
                                    <span className="nb-sx-t2">Searched people, workspaces, organizations, posts, your messages and pages.</span>
                                    <span className="nb-sx-chips"><Link className="nb-sx-btn" href={`/workspaces/new?title=${encodeURIComponent(state.q)}`}>New workspace “{state.q}”</Link>{state.q.includes(" ") ? <button type="button" className="nb-sx-btn" onClick={() => newSearch(state.q.split(" ").slice(0, -1).join(" "))}>Try fewer words</button> : null}</span>
                                </div>
                            ) : (
                                <div className="nb-sx-empty"><b>Nothing here with these filters</b><span className="nb-sx-t2">{state.tab === "people" ? "Try Anyone, or another location." : "Try Any time, or fewer skills."}</span></div>
                            )
                        ) : null}
                    </div>

                    <aside className="nb-sp-rail" aria-label={peek ? "Quick look" : railPeople ? "People" : "Workspaces and organizations"}>
                        {peek ? (
                            <div className="nb-sp-peek">
                                <button type="button" className="nb-sx-ib nb-sp-peek-x" aria-label="Close quick look" onClick={() => setState({ ...state, peek: null })}><X className="size-4" aria-hidden /></button>
                                <BoxPreview hit={peek} q={state.q} action={action(peek)} onOpen={() => open(peek)} />
                            </div>
                        ) : rail.length ? (
                            <section className="nb-sp-railbox">
                                <div className="nb-sx-glabel"><b>{railPeople ? "People" : "Workspaces & orgs"}</b><span className="nb-sx-count">{railPeople ? view?.tabCounts.people : view?.tabCounts.discover}</span><span className="nb-sx-rule" /></div>
                                {rail.map((hit) => (
                                    <div key={hit.id} className="nb-sp-mini">
                                        <HitAvatar hit={hit} />
                                        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => open(hit)}><b className="block truncate">{hit.title}</b><span className="nb-sp-meta block truncate">{String(hit.meta.relation ?? hit.sub)}</span></button>
                                        {action(hit)}
                                    </div>
                                ))}
                                <button type="button" className="nb-sx-btn w-full" onClick={() => update({ ...state, tab: railPeople ? "people" : "discover", sort: 0, more: 0, peek: null })}>{railPeople ? `See all ${view?.tabCounts.people ?? 0} people` : "See workspaces and posts"}</button>
                            </section>
                        ) : null}
                        {related.length ? (
                            <section className="nb-sp-railbox">
                                <div className="nb-sx-glabel"><b>Related searches</b><span className="nb-sx-rule" /></div>
                                <div className="nb-sx-chips">{related.map((word) => <button key={word} type="button" className="nb-sx-chip" onClick={() => newSearch(word)}>{word}</button>)}</div>
                                <p className="nb-sp-meta">In the box: <kbd className="nb-sx-kbd">@</kbd> people · <kbd className="nb-sx-kbd">#</kbd> channels · <kbd className="nb-sx-kbd">in:</kbd> one workspace · <kbd className="nb-sx-kbd">&gt;</kbd> actions</p>
                            </section>
                        ) : null}
                    </aside>
                </div>
            </div>
        </div>
    );
}

function ResultItem({ hit, q, list, picked, onPeek, onOpen, action }: { hit: SearchHit; q: string; list: boolean; picked: boolean; onPeek: () => void; onOpen: () => void; action: React.ReactNode }) {
    const m = hit.meta;
    if (list) {
        return (
            <div className="nb-sp-row" data-picked={picked || undefined} onClick={onPeek}>
                <HitAvatar hit={hit} />
                <span className="min-w-0 flex-1"><button type="button" className="nb-sp-name" onClick={(e) => { e.stopPropagation(); onOpen(); }}><Marked text={hit.title} q={q} /></button><span className="nb-sp-meta block truncate">{hit.why ?? hit.sub}</span></span>
                <span className="nb-sx-kind">{KIND_LABEL[hit.kind]}</span>
                {action}
            </div>
        );
    }
    return (
        <article className="nb-sp-card" data-picked={picked || undefined} onClick={onPeek}>
            <div className="nb-sp-card-hd">
                <HitAvatar hit={hit} size={hit.kind === "people" ? 48 : 36} />
                <span className="min-w-0 flex-1">
                    <button type="button" className="nb-sp-name" onClick={(e) => { e.stopPropagation(); onOpen(); }}><Marked text={hit.title} q={q} /></button>
                    <span className="nb-sp-meta block">
                        {hit.kind === "posts" ? `in ${String(m.place ?? "")} · ${when(hit.createdAt)}`
                            : hit.kind === "messages" ? when(hit.createdAt)
                                : hit.kind === "people" ? [m.headline, m.location].filter(Boolean).join(" · ")
                                    : hit.kind === "orgs" ? `Organization${m.orgType ? ` · ${ORG_TYPE_LABEL[String(m.orgType)] ?? String(m.orgType)}` : ""}` : m.openToCollaborate ? "Open to collaborate" : "Workspace"}
                    </span>
                </span>
                {m.isNew ? <span className="nb-sp-new">{hit.kind === "posts" ? "New" : "New this week"}</span> : null}
                {hit.kind === "messages" && m.hasFile ? <span className="nb-sx-kind">File</span> : null}
            </div>
            {hit.kind !== "people" ? <p className="nb-sp-text">{hit.kind === "posts" || hit.kind === "messages" ? <Marked text={hit.sub} q={q} /> : hit.sub}</p> : null}
            {hit.kind === "people" && m.relation ? <p className="nb-sp-rel">{String(m.relation)}</p> : null}
            {hit.tags.length || Number(m.openRoles) > 0 ? (
                <div className="nb-sx-chips nb-sp-tags">
                    {hit.tags.map((tag) => <span key={tag} className="nb-sx-tag">{tag}</span>)}
                    {Number(m.openRoles) > 0 ? <span className="nb-sp-roles">{String(m.openRoles)} open {Number(m.openRoles) === 1 ? "role" : "roles"}</span> : null}
                </div>
            ) : null}
            {hit.kind === "orgs" || hit.kind === "workspaces" || hit.kind === "people" ? (
                <div className="nb-sp-foot">
                    <span className="nb-sp-meta flex-1">{hit.kind === "people" ? (m.mutual ? `${String(m.mutual)} mutual` : "") : `${m.updatedBy ? `Updated by ${String(m.updatedBy)} · ` : ""}${String(m.followers ?? 0)} followers`}</span>
                    {hit.why ? <span className="nb-sp-whyline">{hit.why}</span> : null}
                    {action}
                </div>
            ) : null}
        </article>
    );
}

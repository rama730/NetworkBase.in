"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useDebounce } from "use-debounce";
import { Bell, Link2, MessageSquare, Search, SlidersHorizontal } from "lucide-react";

import DiscoverClient from "@/components/discover/DiscoverClient";
import { DiscoverFilterTags, type DiscoverHeaderProps } from "@/components/discover/DiscoverHeader";
import { SettingControl } from "@/components/layout/header/search-box/SettingControl";
import { LegalLinks } from "@/components/legal/LegalLinks";
import PersonCard, { PersonCardGrid } from "@/components/network/PersonCard";
import { PersonCardSkeleton } from "@/components/network/PersonCardSkeleton";
import { NetworkFilterChips, NetworkFilters } from "@/components/network/NetworkFilters";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/EmptyState";
import { FilterPanel } from "@/components/ui/filter-panel";
import { RailSection } from "@/components/ui/rail-section";
import { SearchField } from "@/components/ui/SearchField";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TabMarker } from "@/components/ui/TabMarker";
import { UserAvatar } from "@/components/ui/UserAvatar";
import type { SuggestedProfile } from "@/app/actions/connections";
import { getConnectionRequestSuccessMessage, useConnectionMutations } from "@/hooks/useConnections";
import { useBottomStickyRail } from "@/hooks/useBottomStickyRail";
import { CONNECTION_COPY } from "@/lib/connections/copy";
import { copyText } from "@/lib/clipboard";
import { toast } from "@/lib/feedback";
import { normalizeNetworkQuery, type NetworkBrowseQuery } from "@/lib/network/browse-query";
import { searchGoto } from "@/lib/search/global/goto";
import { TAB_ORDER, type SearchTab } from "@/lib/search/global/rank";
import type { SearchContextKey } from "@/lib/search/global/parse";
import type { GlobalSearchResult, SearchHit } from "@/lib/search/global/types";
import { formatDistanceToNow } from "@/lib/utils/date";
import { cn } from "@/lib/utils";

type Saved = { id: string; notify: "weekly" | "daily" | "off" } | null;
type HeaderControls = { filters: ReactNode; tags?: ReactNode };
const TABS: SearchTab[] = ["discover", "people", "msgs", "goto"];
const CONTEXTS: SearchContextKey[] = ["discover", "network", "messages", "workspace", "org", "settings"];
const TAB_LABEL: Record<SearchTab, string> = { discover: "Discover", people: "People", msgs: "Messages", goto: "Go to" };
const ORDER_LINE: Record<SearchTab, string> = {
    discover: "Organizations, workspaces and posts first, because you searched from Discover.",
    people: "People first, because you searched from Network.",
    msgs: "Your messages first, because you searched from Messages.",
    goto: "Settings and pages first, because you searched from Settings.",
};
const NOTIFY_LABEL = { weekly: "Weekly", daily: "Daily", off: "Off" } as const;
/** People-tab filters keep their own address keys, apart from Discover's (`tech`, `status`…). */
const PEOPLE_KEYS = { skills: "pskills", location: "ploc", hasMutuals: "pmutual", openToCollaborate: "popen" } as const;

/** Writes the address in place (Next keeps useSearchParams in step): tabs and filters never re-run the server page. */
function writeParams(patch: Record<string, string | null>) {
    const params = new URLSearchParams(window.location.search);
    for (const [key, value] of Object.entries(patch)) {
        if (value) params.set(key, value);
        else params.delete(key);
    }
    window.history.replaceState(window.history.state, "", `/search?${params.toString()}`);
}

async function getJson<T>(url: string, signal: AbortSignal): Promise<T> {
    const response = await fetch(url, { signal });
    const body = await response.json().catch(() => null) as { success?: boolean; data?: T; message?: string } | null;
    if (!response.ok || !body?.success || !body.data) throw new Error(body?.message || "Couldn’t search just now");
    return body.data;
}

/**
 * The results page (global search mix), built from Discover's and Network's own parts (design spec §15, §16): the
 * page title, underlined tabs with mono counts, the 256px search and Filters, Discover's feed and cards on the
 * Discover tab, Network's person cards on People, and the 320px rail.
 */
export default function SearchPageClient({ saved: initialSaved }: { saved: Saved }) {
    const searchParams = useSearchParams();
    const q = searchParams.get("q") ?? "";
    const tabParam = (searchParams.get("tab") ?? "") as SearchTab;
    const ctxParam = (searchParams.get("ctx") ?? "") as SearchContextKey;
    const ctx = CONTEXTS.includes(ctxParam) ? ctxParam : "discover";
    const tabs = TAB_ORDER[ctx];
    const tab = TABS.includes(tabParam) ? tabParam : tabs[0]!;
    const exact = searchParams.get("exact") === "1";
    const [saved, setSaved] = useState<Saved>(initialSaved);
    const [typedFrom, setTypedFrom] = useState<string | null>(null);
    const searchable = q.trim().length >= 2;

    const overview = useQuery({
        queryKey: ["global-search", "page-overview", q, ctx, exact],
        queryFn: ({ signal }) => getJson<GlobalSearchResult>(`/api/v1/search?${new URLSearchParams({ q, ctx, per: "4", ...(exact ? { exact: "1" } : {}), log: "1" })}`, signal),
        enabled: searchable,
        staleTime: 60_000,
    });
    const result = overview.data ?? null;
    // A typo: search the corrected words everywhere (Discover's feed reads them from the address), and say so.
    useEffect(() => {
        if (result?.fixedFrom && !exact && result.q !== q) {
            setTypedFrom(result.fixedFrom);
            writeParams({ q: result.q });
        }
    }, [exact, q, result]);

    const people = useQuery({
        queryKey: ["global-search", "page-people", q],
        queryFn: ({ signal }) => getJson<{ people: SuggestedProfile[] }>(`/api/v1/search/people?${new URLSearchParams({ q })}`, signal).then((data) => data.people),
        enabled: searchable,
        staleTime: 30_000,
    });
    const goto = useMemo(() => searchGoto(q, { place: null }), [q]);
    const counts: Record<SearchTab, number | null> = {
        discover: result ? (result.counts.orgs ?? 0) + (result.counts.workspaces ?? 0) + (result.counts.posts ?? 0) : null,
        people: people.data ? people.data.length : null,
        msgs: result ? result.counts.messages ?? 0 : null,
        goto: goto.length,
    };
    const total = Object.values(counts).reduce<number>((sum, count) => sum + (count ?? 0), 0);

    const setTab = (next: SearchTab) => writeParams({ tab: next === tabs[0] ? null : next });
    const setQuery = (next: string) => {
        setTypedFrom(null);
        writeParams({ q: next.trim() || null, exact: null });
    };

    const header = (controls: HeaderControls) => (
        <SearchHeader
            q={q} total={total} orderLine={ORDER_LINE[tabs[0]!]} typedFrom={typedFrom}
            onSearchInstead={() => { if (typedFrom) { writeParams({ q: typedFrom, exact: "1" }); setTypedFrom(null); } }}
            tabs={tabs} tab={tab} counts={counts} onTab={setTab}
            onSearch={setQuery} filters={controls.filters} tags={controls.tags}
            saved={saved} onSaved={setSaved} skill={tab === "discover" || tab === "people" ? result?.skill ?? null : null}
        />
    );

    if (!searchable) {
        return (
            <SearchPageFrame rail={null}>
                <header className="min-w-0">
                    <h1 className="nb-page-title">Search</h1>
                    <p className="nb-body mt-1 text-muted-foreground">Type at least two letters in the search at the top, or press ⌘K anywhere.</p>
                </header>
            </SearchPageFrame>
        );
    }

    if (tab === "discover") {
        return (
            <DiscoverClient
                key={`search:${q}`}
                returnUserData={null}
                rail={<PeopleRail people={people.data ?? null} onSeeAll={() => setTab("people")} />}
                renderHeader={(props: DiscoverHeaderProps) => header({
                    filters: <FiltersButton count={props.activeFilters} onClick={props.onOpenFilters} buttonRef={props.filtersButtonRef} />,
                    tags: props.activeFilters ? <DiscoverFilterTags query={props.query} onChange={props.onChange} onClearFilters={props.onClearFilters} filtersButtonRef={props.filtersButtonRef} /> : null,
                })}
            />
        );
    }

    if (tab === "people") {
        return <PeopleTab q={q} people={people} header={header} places={result ? [...(result.groups.orgs ?? []), ...(result.groups.workspaces ?? [])] : []} onDiscover={() => setTab("discover")} />;
    }

    if (tab === "msgs") return <MessagesTab q={q} header={header} />;

    return (
        <SearchPageFrame rail={<RelatedRail words={result?.suggestions ?? []} onPick={setQuery} />}>
            {header({ filters: null })}
            <div className="pt-4">
                {goto.length ? (
                    <div className="nb-tool-surface divide-y divide-border">
                        {goto.map((item) => (
                            <div key={item.id} className="flex min-h-14 flex-wrap items-center gap-3 px-4 py-3">
                                <span className="min-w-0 flex-1">
                                    <span className="nb-ui-label block text-foreground">{item.title}</span>
                                    <span className="nb-compact block text-muted-foreground">{item.sub}</span>
                                </span>
                                {item.meta.control === "theme" || item.meta.control === "findMe" ? <SettingControl control={item.meta.control} /> : null}
                                <Button asChild variant="outline" size="sm"><Link href={item.href}>Open</Link></Button>
                            </div>
                        ))}
                    </div>
                ) : <EmptyState icon={Search} title="No pages or settings match" description="Try a setting’s name, like Appearance or Privacy." />}
            </div>
        </SearchPageFrame>
    );
}

/** Network's page frame (spec §16): 1240px, 24px gutters and top inset, the main column and the 320px sticky rail. */
function SearchPageFrame({ children, rail }: { children: ReactNode; rail: ReactNode }) {
    const stickyRail = useBottomStickyRail();
    return (
        <div data-scroll-root="route" className="h-full min-h-0 app-scroll app-scroll-y app-scroll-gutter bg-background">
            <div className="nb-network-page min-h-full bg-background px-4 sm:px-6">
                <div className="mx-auto w-full max-w-[1240px] pb-8 pt-6">
                    <div className="nb-network-columns">
                        <div className="nb-network-main min-w-0">
                            {children}
                            <div className="nb-network-mobile-footer pt-6"><LegalLinks align="start" showCopyright className="text-[11px]" /></div>
                        </div>
                        <aside {...stickyRail} aria-label="About this search" className="nb-network-rail sticky self-start space-y-4">
                            {rail}
                            <LegalLinks align="start" showCopyright className="text-[11px]" />
                        </aside>
                    </div>
                </div>
            </div>
        </div>
    );
}

function FiltersButton({ count, onClick, buttonRef }: { count: number; onClick?: () => void; buttonRef?: DiscoverHeaderProps["filtersButtonRef"] }) {
    return (
        <Button ref={buttonRef} type="button" variant="outline" onClick={onClick} aria-haspopup="dialog" className="bg-card pointer-coarse:h-11">
            <SlidersHorizontal className="size-4" aria-hidden="true" />
            Filters
            {count ? <span className="nb-tab-count">{count}<span className="sr-only"> active</span></span> : null}
        </Button>
    );
}

function SearchHeader({ q, total, orderLine, typedFrom, onSearchInstead, tabs, tab, counts, onTab, onSearch, filters, tags, saved, onSaved, skill }: {
    q: string; total: number; orderLine: string; typedFrom: string | null; onSearchInstead: () => void;
    tabs: SearchTab[]; tab: SearchTab; counts: Record<SearchTab, number | null>; onTab: (tab: SearchTab) => void;
    onSearch: (q: string) => void; filters: ReactNode; tags?: ReactNode;
    saved: Saved; onSaved: (saved: Saved) => void; skill: GlobalSearchResult["skill"];
}) {
    const [value, setValue] = useState(q);
    const [debounced] = useDebounce(value, 400);
    useEffect(() => { setValue(q); }, [q]);
    useEffect(() => { if (debounced.trim().length >= 2 && debounced.trim() !== q) onSearch(debounced); }, [debounced]); // eslint-disable-line react-hooks/exhaustive-deps

    const save = async () => {
        if (saved) {
            const response = await fetch(`/api/v1/search/saved?id=${encodeURIComponent(saved.id)}`, { method: "DELETE" }).catch(() => null);
            if (response?.ok) { onSaved(null); toast.success("Removed from saved searches"); } else toast.error("Couldn’t remove it just now");
            return;
        }
        const filters: Record<string, string> = {};
        for (const [key, val] of new URLSearchParams(window.location.search)) if (!["q", "tab", "ctx", "exact"].includes(key)) filters[key] = val;
        const response = await fetch("/api/v1/search/saved", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: q, tab, filters, notify: "weekly" }) }).catch(() => null);
        const body = await response?.json().catch(() => null) as { data?: { id: string }; message?: string } | null;
        if (response?.ok && body?.data?.id) {
            onSaved({ id: body.data.id, notify: "weekly" });
            toast.success(`Saved. New matches for “${q}” reach you weekly; it’s also under Saved in the search box.`);
        } else toast.error(body?.message ?? "Couldn’t save this search");
    };
    const setNotify = async (notify: "weekly" | "daily" | "off") => {
        if (!saved) return;
        const response = await fetch("/api/v1/search/saved", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: saved.id, notify }) }).catch(() => null);
        if (response?.ok) onSaved({ ...saved, notify }); else toast.error("Couldn’t change the alerts");
    };

    return (
        <div className="min-w-0">
            <header className="flex min-w-0 flex-wrap items-start justify-between gap-x-6 gap-y-3">
                <div className="min-w-0">
                    <h1 className="nb-page-title">Results for “{q}”</h1>
                    <p className="nb-body mt-1 text-muted-foreground">{total ? `${total} ${total === 1 ? "result" : "results"} · ` : ""}{orderLine}</p>
                    {typedFrom ? (
                        <p className="nb-compact mt-1 text-muted-foreground">
                            Showing results for <span className="font-medium text-foreground">{q}</span> · <button type="button" className="text-primary hover:underline" onClick={onSearchInstead}>Search “{typedFrom}” instead</button>
                        </p>
                    ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <Button type="button" variant="outline" onClick={() => void save()} aria-pressed={Boolean(saved)} className="bg-card pointer-coarse:h-11">
                        <Bell className="size-4" aria-hidden="true" />{saved ? "Saved search" : "Save search"}
                    </Button>
                    {saved ? (
                        <Select value={saved.notify} onValueChange={(next) => void setNotify(next as "weekly" | "daily" | "off")}>
                            <SelectTrigger aria-label="New matches" className="w-auto min-w-[150px] bg-card pointer-coarse:h-11"><span className="text-muted-foreground">New matches:</span><SelectValue /></SelectTrigger>
                            <SelectContent>{(["weekly", "daily", "off"] as const).map((option) => <SelectItem key={option} value={option}>{NOTIFY_LABEL[option]}</SelectItem>)}</SelectContent>
                        </Select>
                    ) : null}
                    <Button type="button" variant="outline" className="bg-card pointer-coarse:h-11" onClick={() => { void copyText(window.location.href).then(() => toast.success("Link copied"), () => toast.error("Couldn’t copy the link")); }}>
                        <Link2 className="size-4" aria-hidden="true" />Copy link
                    </Button>
                </div>
            </header>

            {/* Network's toolbar (spec §16): underlined tabs with mono counts on the divider, then the 256px search and Filters. */}
            <div className="nb-network-toolbar mt-4 flex min-w-0 flex-wrap-reverse items-start gap-2 border-b border-border">
                <div className="-mb-px self-end flex max-w-full min-w-0 shrink-0 items-stretch gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist" aria-label="Result kinds">
                    {tabs.map((key) => {
                        const selected = key === tab;
                        const count = counts[key];
                        return (
                            <button key={key} id={`search-tab-${key}`} type="button" role="tab" aria-selected={selected} tabIndex={selected ? 0 : -1} onClick={() => onTab(key)}
                                className={cn("nb-ui-label inline-flex min-h-11 shrink-0 items-center gap-2 border-b-2 px-2 py-3 transition-colors", selected ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
                                {TAB_LABEL[key]}
                                {count !== null ? <span className="nb-meta"><span aria-hidden="true">{count}</span><span className="sr-only">{count} results</span></span> : null}
                            </button>
                        );
                    })}
                    <TabMarker overlap />
                </div>
                <div className="nb-network-controls mb-2 flex max-w-full min-w-0 flex-wrap items-center gap-2">
                    <SearchField value={value} onChange={setValue} onEnter={(input) => onSearch(input.value)} label="Search everything" className="w-64 max-w-full" />
                    {filters}
                </div>
            </div>
            {tags ? <div className="mt-4">{tags}</div> : null}
            {skill ? (
                <div className="nb-tool-surface mt-4 flex flex-wrap items-center gap-3 p-4">
                    <span className="min-w-0 flex-1">
                        <span className="nb-card-title block">{skill.name}</span>
                        <span className="nb-meta">{skill.people >= 100 ? "100+" : skill.people} people · {skill.workspaces} workspaces · {skill.orgs} organizations</span>
                    </span>
                    <Button asChild variant="outline" size="sm"><Link href={`/discover?tech=${encodeURIComponent(skill.name)}`}>Workspaces using {skill.name}</Link></Button>
                </div>
            ) : null}
        </div>
    );
}

/** The Discover tab's rail: the people who match, as compact identity rows (spec §12 rail). */
function PeopleRail({ people, onSeeAll }: { people: SuggestedProfile[] | null; onSeeAll: () => void }) {
    if (!people?.length) return null;
    return (
        <RailSection title="People">
            <div className="space-y-1">
                {people.slice(0, 4).map((person) => (
                    <Link key={person.id} href={person.username ? `/u/${person.username}` : `/u/${person.id}`} className="flex min-h-11 items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted">
                        <UserAvatar identity={person} size={34} roundedClassName="rounded-[5px]" />
                        <span className="min-w-0 flex-1">
                            <span className="nb-person-name block truncate">{person.fullName ?? person.username}</span>
                            <span className="nb-compact block truncate text-muted-foreground">{person.headline ?? person.location ?? ""}</span>
                        </span>
                    </Link>
                ))}
                <Button type="button" variant="outline" className="mt-2 w-full bg-card" onClick={onSeeAll}>See all {people.length} people</Button>
            </div>
        </RailSection>
    );
}

function RelatedRail({ words, onPick }: { words: string[]; onPick: (word: string) => void }) {
    if (!words.length) return null;
    return (
        <RailSection title="Related searches">
            <div className="flex flex-wrap gap-1.5">
                {words.map((word) => <button key={word} type="button" className="nb-tag hover:bg-muted" onClick={() => onPick(word)}>{word}</button>)}
            </div>
        </RailSection>
    );
}

function PeopleTab({ q, people, header, places, onDiscover }: {
    q: string;
    people: { data?: SuggestedProfile[]; isLoading: boolean; isError: boolean; refetch: () => unknown };
    header: (controls: HeaderControls) => ReactNode;
    places: SearchHit[];
    onDiscover: () => void;
}) {
    const searchParams = useSearchParams();
    const query: NetworkBrowseQuery = normalizeNetworkQuery("suggested", {
        q,
        skills: (searchParams.get(PEOPLE_KEYS.skills) ?? "").split(",").filter(Boolean),
        location: searchParams.get(PEOPLE_KEYS.location) ?? "",
        hasMutuals: searchParams.get(PEOPLE_KEYS.hasMutuals) === "1",
        openToCollaborate: searchParams.get(PEOPLE_KEYS.openToCollaborate) === "1",
    });
    const apply = (patch: Partial<NetworkBrowseQuery>) => writeParams({
        ...(patch.skills !== undefined ? { [PEOPLE_KEYS.skills]: patch.skills.join(",") || null } : {}),
        ...(patch.location !== undefined ? { [PEOPLE_KEYS.location]: patch.location || null } : {}),
        ...(patch.hasMutuals !== undefined ? { [PEOPLE_KEYS.hasMutuals]: patch.hasMutuals ? "1" : null } : {}),
        ...(patch.openToCollaborate !== undefined ? { [PEOPLE_KEYS.openToCollaborate]: patch.openToCollaborate ? "1" : null } : {}),
    });
    // ponytail: the filters run on the matched people (up to 60) in the browser. Upgrade: server filters if needed.
    const shown = (people.data ?? []).filter((person) =>
        query.skills.every((skill) => (person.skills ?? []).some((value) => value.toLowerCase() === skill.toLowerCase()))
        && (!query.location || (person.location ?? "").toLowerCase().includes(query.location.toLowerCase()))
        && (!query.hasMutuals || (person.mutualConnections ?? 0) > 0)
        && (!query.openToCollaborate || Boolean(person.openToCollaborate)));
    const { sendRequest } = useConnectionMutations();
    const connect = (userId: string) => toast.promise(sendRequest.mutateAsync({ userId }), {
        loading: CONNECTION_COPY.sending,
        success: (response) => getConnectionRequestSuccessMessage(response.status),
        error: (error) => (error instanceof Error ? error.message : CONNECTION_COPY.sendFailed),
    }).unwrap();

    const rail = places.length ? (
        <RailSection title="Workspaces and organizations">
            <div className="space-y-1">
                {places.slice(0, 4).map((place) => (
                    <Link key={place.id} href={place.href} className="flex min-h-11 flex-col justify-center rounded-md px-2 py-1.5 hover:bg-muted">
                        <span className="nb-ui-label truncate text-foreground">{place.title}</span>
                        <span className="nb-meta truncate">{place.kind === "orgs" ? "Organization" : "Workspace"}</span>
                    </Link>
                ))}
                <Button type="button" variant="outline" className="mt-2 w-full bg-card" onClick={onDiscover}>See workspaces and posts</Button>
            </div>
        </RailSection>
    ) : null;

    return (
        <SearchPageFrame rail={rail}>
            {header({
                filters: <NetworkFilters tab="suggested" query={query} onApply={apply} />,
                tags: <NetworkFilterChips query={query} onChange={apply} />,
            })}
            <div className="pt-4">
                {people.isLoading ? (
                    <div className="nb-person-card-grid grid gap-4">{[0, 1, 2, 3].map((item) => <PersonCardSkeleton key={item} />)}</div>
                ) : people.isError ? (
                    <EmptyState icon={Search} title="People didn’t load" description="Check your connection and try again." action={<Button type="button" variant="outline" onClick={() => void people.refetch()}>Try again</Button>} />
                ) : shown.length ? (
                    <PersonCardGrid items={shown} getKey={(person) => person.id} renderItem={(person, index) => <PersonCard profile={person} onConnect={connect} priority={index < 6} />} hasNextPage={false} isFetchingNextPage={false} fetchNextPage={() => undefined} loadingLabel="Loading more people" />
                ) : (
                    <EmptyState figure="person" title={people.data?.length ? "No one matches these filters" : `No people match “${q}”`} description={people.data?.length ? "Try fewer filters." : "People who keep their search private don’t show up here."} />
                )}
            </div>
        </SearchPageFrame>
    );
}

function MessagesTab({ q, header }: { q: string; header: (controls: HeaderControls) => ReactNode }) {
    const [open, setOpen] = useState(false);
    const [from, setFrom] = useState<string[]>([]);
    const [file, setFile] = useState(false);
    const messages = useQuery({
        queryKey: ["global-search", "page-messages", q],
        queryFn: ({ signal }) => getJson<GlobalSearchResult>(`/api/v1/search?${new URLSearchParams({ q, ctx: "messages", per: "50", only: "messages" })}`, signal).then((data) => data.groups.messages ?? []),
        staleTime: 30_000,
    });
    const all = messages.data ?? [];
    const authors = [...new Set(all.map((hit) => String(hit.meta.author ?? "")))].filter(Boolean);
    const shown = all.filter((hit) => (!from.length || from.includes(String(hit.meta.author))) && (!file || hit.meta.hasFile));
    // One heading per conversation, newest first inside it.
    const byPlace = new Map<string, SearchHit[]>();
    for (const hit of shown) byPlace.set(String(hit.meta.place ?? ""), [...(byPlace.get(String(hit.meta.place ?? "")) ?? []), hit]);
    const count = from.length + Number(file);

    return (
        <SearchPageFrame rail={null}>
            {header({
                filters: (
                    <FilterPanel open={open} onOpenChange={setOpen} activeFilters={count} onClear={() => { setFrom([]); setFile(false); }} trigger={<FiltersButton count={count} />}>
                        <fieldset>
                            <legend className="nb-ui-label mb-2">From</legend>
                            {authors.map((author) => (
                                <label key={author} className="flex min-h-11 cursor-pointer items-center gap-3">
                                    <Checkbox checked={from.includes(author)} onCheckedChange={(on) => setFrom(on === true ? [...from, author] : from.filter((value) => value !== author))} />
                                    <span className="nb-compact">{author}</span>
                                </label>
                            ))}
                        </fieldset>
                        <label className="flex min-h-11 cursor-pointer items-center gap-3">
                            <Checkbox checked={file} onCheckedChange={(on) => setFile(on === true)} />
                            <span className="nb-compact">Has a file</span>
                        </label>
                        <p className="nb-compact text-muted-foreground">Only conversations you’re in.</p>
                    </FilterPanel>
                ),
            })}
            <div className="space-y-6 pt-4">
                {messages.isLoading ? <p role="status" className="nb-meta">Searching your messages…</p> : null}
                {[...byPlace].map(([place, hits]) => (
                    <section key={place} aria-label={place}>
                        <h2 className="nb-micro mb-2">{place}</h2>
                        <div className="nb-tool-surface divide-y divide-border">
                            {hits.map((hit) => (
                                <Link key={hit.id} href={hit.href} className="flex gap-3 px-4 py-3 hover:bg-muted">
                                    <UserAvatar identity={{ id: hit.id, fullName: hit.title, avatarUrl: hit.avatarUrl }} size={34} roundedClassName="rounded-[5px]" />
                                    <span className="min-w-0 flex-1">
                                        <span className="flex flex-wrap items-baseline gap-2">
                                            <span className="nb-ui-label text-foreground">{hit.title}</span>
                                            <span className="nb-meta">{hit.createdAt ? formatDistanceToNow(new Date(hit.createdAt), { addSuffix: true }) : ""}</span>
                                            {hit.meta.hasFile ? <span className="nb-status text-muted-foreground">File</span> : null}
                                        </span>
                                        <span className="nb-compact block text-foreground">{hit.sub}</span>
                                    </span>
                                </Link>
                            ))}
                        </div>
                    </section>
                ))}
                {!messages.isLoading && !shown.length ? <EmptyState icon={MessageSquare} title={all.length ? "No messages match these filters" : `No messages mention “${q}”`} description="Messages search only covers conversations you’re in." /> : null}
            </div>
        </SearchPageFrame>
    );
}

"use client";

import { confirmAppNavigation } from "@/lib/navigation/confirm-navigation";

import { CONNECTION_COPY } from "@/lib/connections/copy";
import { History, Search, ShieldCheck, X } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "@/lib/feedback";
import { copyText } from "@/lib/clipboard";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { PixelBeat } from "@/components/ui/PixelBeat";
import { Skeleton } from "@/components/ui/skeleton";
import { useSidebarWorkspacesQuery } from "@/components/layout/AppSidebar";
import { placeForPath } from "@/components/layout/SidebarWorkspaces";
import { getConnectionRequestSuccessMessage, useConnectionMutations } from "@/hooks/useConnections";
import { ageLabel, useGlobalSearch } from "@/hooks/useGlobalSearch";
import { currentEntry } from "@/lib/navigation/in-app-history";
import { rememberSearchReturn } from "@/lib/navigation/search-return";
import { usePlaceName } from "@/lib/navigation/place-name";
import { queryKeys } from "@/lib/query-keys";
import { searchGoto, type GotoPlace } from "@/lib/search/global/goto";
import { contextFromPath, type SearchKind } from "@/lib/search/global/parse";
import type { SearchHit } from "@/lib/search/global/types";
import { BoxRow, HitAvatar, KIND_LABEL, Marked } from "./search-box/BoxRow";
import { SettingControl } from "./search-box/SettingControl";
import { BoxExtras, BoxPreview, useBoxExtras } from "./search-box/BoxExtras";
import { buildBoxGroups, type BoxGroupKind } from "./search-box/groups";
import { acceptsSuggestion, isStoredHit } from "./search-box/recent";
import "./search-box/search-box.css";
import {
    readRecentGlobalSearches,
    removeRecentGlobalSearch,
    rememberRecentGlobalSearch,
    rememberRecentGlobalSearchPreview,
    type GlobalSearchContext,
    type RecentGlobalSearchItem,
} from "./global-search";

type CommandPaletteProps = {
    isOpen: boolean;
    onClose: () => void;
    initialQuery?: string;
    /** Back to your search (R2): the result you opened is highlighted again. */
    initialActiveIndex?: number;
    context?: GlobalSearchContext;
    recentSearchOwnerId?: string;
};

/** Recent searches are one list for every page (report §4 item 1). */
export const RECENT_SCOPE = "everywhere";
type Chip = { kind: "only"; only: SearchKind } | { kind: "channels" } | { kind: "actions" };
const ONLY_CHIPS: Array<{ only: SearchKind; label: string }> = [
    { only: "people", label: "People" }, { only: "workspaces", label: "Workspaces" }, { only: "orgs", label: "Orgs" },
    { only: "posts", label: "Posts" }, { only: "messages", label: "Messages" },
];
const chipLabel = (chip: Chip) => chip.kind === "channels" ? "Channels" : chip.kind === "actions" ? "Actions and settings" : ONLY_CHIPS.find((c) => c.only === chip.only)?.label ?? chip.only;
const TAB_FOR: Partial<Record<BoxGroupKind, string>> = { people: "people", messages: "msgs", goto: "goto", orgs: "discover", workspaces: "discover", posts: "discover" };
const KIND_FOR_TAB: Partial<Record<BoxGroupKind, string>> = { orgs: "orgs", workspaces: "spaces", posts: "posts" };
const domId = (hit: SearchHit) => `nb-sx-${hit.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;

export default function CommandPalette({ isOpen, onClose, initialQuery = "", initialActiveIndex, recentSearchOwnerId = "" }: CommandPaletteProps) {
    const queryClient = useQueryClient();
    const pathname = usePathname() ?? "/";
    const router = useRouter();
    const { key: ctx, place: placeSlug } = contextFromPath(pathname);
    const { data: sidebar } = useSidebarWorkspacesQuery();
    const sidebarPlace = useMemo(() => placeForPath(sidebar, pathname), [sidebar, pathname]);
    const placeName = usePlaceName(pathname) ?? sidebarPlace?.title ?? null;
    const place: GotoPlace | null = placeSlug && (ctx === "workspace" || ctx === "org")
        ? { kind: ctx === "org" ? "org" : "workspace", name: placeName ?? placeSlug, href: `/${ctx === "org" ? "org" : "workspaces"}/${encodeURIComponent(placeSlug)}` }
        : null;

    const [text, setText] = useState(initialQuery);
    const [chip, setChip] = useState<Chip | null>(null);
    const [inPlace, setInPlace] = useState(true);
    const [exact, setExact] = useState(false);
    const [activeIndex, setActiveIndex] = useState(-1);
    const [recents, setRecents] = useState<RecentGlobalSearchItem[]>([]);
    const { sendRequest } = useConnectionMutations();
    const panelRef = useRef<HTMLDivElement>(null);
    const [left, setLeft] = useState<number | null>(null);

    // Staff only (trust and safety C2): "trust" or a case number opens the console. Asked once per opening.
    const [isStaff, setIsStaff] = useState(false);
    useEffect(() => {
        if (!isOpen || !recentSearchOwnerId) return;
        void import("@/app/actions/moderation-staff").then(({ staffBadgeAction }) => staffBadgeAction()).then((badge) => setIsStaff(Boolean(badge)), () => setIsStaff(false));
    }, [isOpen, recentSearchOwnerId]);
    const staffCommand = useMemo(() => {
        if (!isStaff) return null;
        const q = text.trim();
        const caseNumber = q.match(/^nb-?(\d{1,9})$/i)?.[1];
        if (caseNumber) return { label: `Open case NB-${caseNumber}`, href: `/admin/trust?case=NB-${caseNumber}` };
        return q.length >= 2 && /^(t(r(u(st?)?)?)?|safety|report|reports|moderation|case|cases)/i.test(q) ? { label: "Open Trust and safety", href: "/admin/trust" } : null;
    }, [isStaff, text]);

    useEffect(() => {
        if (!isOpen) return;
        setText(initialQuery);
        setChip(null);
        setInPlace(true);
        setExact(false);
        setActiveIndex(initialActiveIndex ?? -1);
        lastReset.current = `${initialQuery.trim()}||true`;
        setRecents(readRecentGlobalSearches(recentSearchOwnerId, RECENT_SCOPE));
        // The box hangs under the top bar's search cell (Main board), clear of the window's edge.
        const cell = document.querySelector(".nb-cell-search")?.getBoundingClientRect();
        const width = Math.min(window.innerWidth >= 1100 ? 1040 : 720, window.innerWidth - 32);
        setLeft(cell ? Math.max(16, Math.min(cell.left, window.innerWidth - width - 16)) : null);
    }, [initialActiveIndex, initialQuery, isOpen, recentSearchOwnerId]);

    const q = text.trim();
    const actionsOnly = chip?.kind === "actions";
    const search = useGlobalSearch({
        q: chip?.kind === "channels" ? `#${q}` : q,
        ctx,
        place: inPlace && place ? placeSlug : null,
        per: 3,
        only: chip?.kind === "only" ? chip.only : null,
        exact,
        enabled: isOpen && !actionsOnly && (q.length > 0 || chip?.kind === "channels"),
        viewerId: recentSearchOwnerId,
    });
    const extras = useBoxExtras({ enabled: isOpen && !q, ownerId: recentSearchOwnerId });
    const goto = useMemo(() => (chip && !actionsOnly ? [] : searchGoto(q, { place })), [actionsOnly, chip, place, q]);
    const result = q ? search.result : null;
    const box = useMemo(() => result || goto.length
        ? buildBoxGroups(result ?? { q, fixedFrom: null, groups: {}, counts: {}, skill: null, suggestions: [], email: null, tookMs: 0 }, ctx, { goto, placeName: place?.name })
        : null, [ctx, goto, place?.name, q, result]);
    const emailHit = result?.email?.kind === "person" ? result.email.hit : null;
    const invite = result?.email?.kind === "invite" ? result.email.address : null;
    const flat = useMemo(() => [...(emailHit ? [emailHit] : []), ...(box?.flat ?? [])], [box, emailHit]);
    const total = (box?.total ?? 0) + (emailHit ? 1 : 0);
    const active = flat[activeIndex] ?? null;
    const nothing = Boolean(q) && !search.isFetching && !search.error && !search.isFirstLoad && total === 0 && !invite && (result || actionsOnly);

    // New words or scope clear the highlight; opening the box doesn't, so back-to-search marks the result you opened.
    const resetKey = `${q}|${chip ? chipLabel(chip) : ""}|${inPlace}`;
    const lastReset = useRef(resetKey);
    useEffect(() => {
        if (lastReset.current === resetKey) return;
        lastReset.current = resetKey;
        setActiveIndex(-1);
    }, [resetKey]);
    useEffect(() => {
        if (active) document.getElementById(domId(active))?.scrollIntoView({ block: "nearest" });
    }, [active]);
    useEffect(() => {
        if (!isOpen || !active || active.meta.external) return;
        const timer = window.setTimeout(() => router.prefetch(active.href), 150);
        return () => window.clearTimeout(timer);
    }, [active, isOpen, router]);

    const record = (value: string) => setRecents(rememberRecentGlobalSearch(recentSearchOwnerId, RECENT_SCOPE, value));
    const rememberForBack = (index: number) => {
        const entryId = currentEntry()?.id;
        if (entryId) rememberSearchReturn(window.sessionStorage, { entryId, query: text, activeIndex: index });
    };

    const openHit = (hit: SearchHit) => {
        const go = () => {
            if (q) record(q);
            if (hit.kind !== "goto") setRecents(rememberRecentGlobalSearchPreview(recentSearchOwnerId, RECENT_SCOPE, { ...hit, id: hit.id, title: hit.title }));
            if (hit.meta.external) window.open(hit.href, "_blank", "noopener,noreferrer");
            else {
                rememberForBack(flat.indexOf(hit));
                router.push(hit.href);
            }
            onClose();
        };
        if (hit.meta.external) go();
        else confirmAppNavigation(go);
    };

    const seeAll = (kind?: BoxGroupKind) => {
        if (!q) return;
        const params = new URLSearchParams({ q, ctx });
        if (kind && TAB_FOR[kind]) params.set("tab", TAB_FOR[kind]!);
        if (kind && KIND_FOR_TAB[kind]) params.set("kind", KIND_FOR_TAB[kind]!);
        if (exact) params.set("exact", "1");
        confirmAppNavigation(() => {
            record(q);
            rememberForBack(-1);
            router.push(`/search?${params.toString()}`);
            onClose();
        });
    };

    const connect = async (hit: SearchHit) => {
        const userId = String(hit.meta.userId ?? "");
        if (!userId) return;
        try {
            await toast.promise(sendRequest.mutateAsync({ userId }), {
                loading: CONNECTION_COPY.sending,
                success: (response) => getConnectionRequestSuccessMessage(response.status),
                error: (error) => error instanceof Error ? error.message : CONNECTION_COPY.sendFailed,
            }).unwrap();
            void queryClient.invalidateQueries({ queryKey: queryKeys.globalSearch.root() });
        } catch {
            // The shared mutation and toast already report the failed state.
        }
    };

    const rowAction = (hit: SearchHit) => {
        if (hit.kind === "people" && hit.act === "Connect") {
            const busy = sendRequest.isPending && sendRequest.variables?.userId === hit.meta.userId;
            return <button type="button" className="nb-sx-btn" disabled={busy} onClick={(event) => { event.stopPropagation(); void connect(hit); }}>{busy ? "Sending…" : "Connect"}</button>;
        }
        if (hit.kind === "people" && hit.act === "Message") {
            return <button type="button" className="nb-sx-btn" onClick={(event) => { event.stopPropagation(); confirmAppNavigation(() => { router.push(`/messages?userId=${encodeURIComponent(String(hit.meta.userId))}`); onClose(); }); }}>Message</button>;
        }
        if (hit.meta.control === "theme" || hit.meta.control === "findMe") return <SettingControl control={hit.meta.control} />;
        return null;
    };

    const onInput = (value: string) => {
        // A typed shortcut turns into the scope chip, so it's visible and one Backspace undoes it (States board).
        const typed = value.match(/^([@#>])\s?([\s\S]*)$/);
        if (typed && !chip) {
            setChip(typed[1] === "@" ? { kind: "only", only: "people" } : typed[1] === "#" ? { kind: "channels" } : { kind: "actions" });
            setText(typed[2] ?? "");
        } else setText(value);
        setExact(false);
    };

    const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (!flat.length) return;
            const step = event.key === "ArrowDown" ? 1 : -1;
            setActiveIndex((current) => current < 0 ? (step === 1 ? 0 : flat.length - 1) : (current + step + flat.length) % flat.length);
        } else if (event.key === "Enter") {
            // An input method is still choosing the word: Enter belongs to it.
            if (event.nativeEvent.isComposing) return;
            event.preventDefault();
            if (event.metaKey || event.ctrlKey) seeAll();
            else if (active) openHit(active);
            else if (staffCommand) { onClose(); router.push(staffCommand.href); }
            else seeAll();
        } else if (event.key === "Backspace" && !text) {
            if (chip) setChip(null);
            else if (place && inPlace) setInPlace(false);
        } else if (event.key === "Tab" && !event.shiftKey) {
            const word = acceptsSuggestion({ q, suggestions: result?.suggestions ?? [], shown: Boolean(result && !result.fixedFrom) });
            if (word) { event.preventDefault(); setText(word); }
        }
    };

    const removeRecent = (key: string) => setRecents(removeRecentGlobalSearch(recentSearchOwnerId, RECENT_SCOPE, key));
    const clearRecents = () => {
        let next = recents;
        for (const item of recents.filter((recent) => recent.kind === "query")) next = removeRecentGlobalSearch(recentSearchOwnerId, RECENT_SCOPE, item.key);
        setRecents(next);
    };
    const recentQueries = recents.filter((item) => item.kind === "query");
    const viewed = recents.flatMap((item) => (item.kind === "preview" && isStoredHit(item.preview) ? [{ key: item.key, hit: item.preview }] : []));

    const placeholder = place && inPlace ? `Search ${place.name}, or everywhere` : "Search people, workspaces, organizations, posts…";
    const showPreview = Boolean(active) && typeof window !== "undefined" && window.innerWidth >= 1100;

    return (
        <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
            <DialogContent size="wide"
                showCloseButton={false}
                data-command-palette-dialog=""
                overlayClassName="bg-black/35"
                className="nb-sx-panel left-0 top-0 flex h-dvh w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 p-0 duration-[130ms] motion-reduce:duration-0 focus:outline-none focus-visible:outline-none focus-visible:ring-0 sm:h-auto sm:max-h-[min(640px,calc(100dvh-var(--ui-topnav-height)-24px))] sm:rounded-[6px] sm:border sm:border-border sm:bg-card"
                style={{ outline: "none", ...(left !== null ? { "--nb-sx-left": `${left}px` } : {}) } as React.CSSProperties}
                aria-describedby="topnav-search-description"
            >
                <DialogTitle className="sr-only">Search NetworkBase</DialogTitle>
                <DialogDescription id="topnav-search-description" className="sr-only">One search for people, workspaces, organizations, posts, your messages and pages. The page you are on sets the order.</DialogDescription>
                <form ref={undefined} onSubmit={(event) => event.preventDefault()} className="flex min-h-0 min-w-0 flex-1 flex-col">
                    <div className="nb-sx-input">
                        <Search className="size-[18px] shrink-0 text-muted-foreground" aria-hidden />
                        {place && inPlace && !chip ? (
                            <span className="nb-sx-scope">In {place.name}<button type="button" aria-label="Search everywhere" onClick={() => setInPlace(false)}><X className="size-3" aria-hidden /></button></span>
                        ) : null}
                        {chip ? <span className="nb-sx-scope">{chipLabel(chip)}<button type="button" aria-label={`Stop searching only ${chipLabel(chip)}`} onClick={() => setChip(null)}><X className="size-3" aria-hidden /></button></span> : null}
                        <input
                            autoFocus
                            type="search"
                            autoComplete="off"
                            maxLength={100}
                            value={text}
                            onChange={(event) => onInput(event.target.value)}
                            onKeyDown={onKeyDown}
                            placeholder={placeholder}
                            className="nb-command-input h-full min-w-0 flex-1 border-0 bg-transparent text-[15px] font-medium text-foreground outline-none ring-0 shadow-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 placeholder:font-normal placeholder:text-muted-foreground/70 [&::-webkit-search-cancel-button]:hidden"
                            style={{ outline: "none", boxShadow: "none" }}
                            aria-label="Search NetworkBase"
                            role="combobox"
                            aria-expanded={isOpen}
                            aria-autocomplete="list"
                            aria-busy={search.isFetching}
                            aria-controls="nb-sx-results"
                            aria-activedescendant={active ? domId(active) : undefined}
                        />
                        {q ? <button type="button" onClick={() => setText("")} className="nb-sx-ib" aria-label="Clear search"><X className="size-4" aria-hidden /></button> : null}
                        <button type="button" onClick={onClose} className="nb-sx-cancel sm:hidden">Cancel</button>
                        <kbd className="nb-sx-kbd max-sm:hidden" aria-hidden>esc</kbd>
                    </div>

                    <div className="sr-only" aria-live="polite">{q ? (search.isFetching && !result ? "Searching" : `${total} results`) : ""}</div>

                    <div className="nb-sx-split">
                        <div id="nb-sx-results" role="listbox" aria-label="Search results" className="nb-sx-body">
                            {staffCommand ? (
                                <button type="button" className="nb-sx-row nb-sx-row-main" onClick={() => { onClose(); router.push(staffCommand.href); }}>
                                    <span className="nb-sx-icon" aria-hidden><ShieldCheck className="size-4" /></span>
                                    <span className="nb-sx-tx"><span className="nb-sx-t1">{staffCommand.label}</span><span className="nb-sx-t2">Staff</span></span>
                                </button>
                            ) : null}

                            {!q ? (
                                <>
                                    {recentQueries.length ? (
                                        <section>
                                            <div className="nb-sx-glabel"><b>Recent</b><span className="nb-sx-rule" /><button type="button" className="nb-sx-link" onClick={clearRecents}>Clear</button></div>
                                            {recentQueries.map((recent) => (
                                                <div key={recent.key} className="nb-sx-row">
                                                    <button type="button" className="nb-sx-row-main" onClick={() => setText(recent.label)} aria-label={`Use recent search ${recent.label}`}>
                                                        <span className="nb-sx-icon" aria-hidden><History className="size-4" /></span>
                                                        <span className="nb-sx-tx"><span className="nb-sx-t1">{recent.label}</span></span>
                                                    </button>
                                                    <button type="button" className="nb-sx-ib" onClick={() => removeRecent(recent.key)} aria-label={`Remove ${recent.label} from recent searches`}><X className="size-3.5" aria-hidden /></button>
                                                </div>
                                            ))}
                                        </section>
                                    ) : null}
                                    {viewed.length ? (
                                        <section>
                                            <div className="nb-sx-glabel"><b>Recently viewed</b><span className="nb-sx-rule" /></div>
                                            {viewed.slice(0, 3).map(({ key, hit }) => (
                                                <div key={key} className="nb-sx-row">
                                                    <button type="button" className="nb-sx-row-main" onClick={() => openHit(hit)}>
                                                        <HitAvatar hit={hit} />
                                                        <span className="nb-sx-tx"><span className="nb-sx-t1">{hit.title}</span><span className="nb-sx-t2">{hit.sub}</span></span>
                                                    </button>
                                                    <span className="nb-sx-kind">{KIND_LABEL[hit.kind]}</span>
                                                    <button type="button" className="nb-sx-ib" onClick={() => removeRecent(key)} aria-label={`Remove ${hit.title} from recently viewed`}><X className="size-3.5" aria-hidden /></button>
                                                </div>
                                            ))}
                                        </section>
                                    ) : null}
                                    <BoxExtras extras={extras} onPick={(value) => setText(value)} onOpenSaved={(href) => confirmAppNavigation(() => { router.push(href); onClose(); })} />
                                    <section>
                                        <div className="nb-sx-glabel"><b>Search only</b><span className="nb-sx-rule" /></div>
                                        <div className="nb-sx-chips">
                                            {ONLY_CHIPS.map((item) => <button key={item.only} type="button" className="nb-sx-chip" onClick={() => setChip({ kind: "only", only: item.only })}>{item.label}</button>)}
                                        </div>
                                        <p className="nb-sx-hint"><kbd className="nb-sx-kbd">@</kbd> people · <kbd className="nb-sx-kbd">#</kbd> channels · <kbd className="nb-sx-kbd">in:</kbd> one workspace · <kbd className="nb-sx-kbd">&gt;</kbd> actions and settings</p>
                                    </section>
                                </>
                            ) : (
                                <>
                                    {search.staleAt || (search.error && !result) ? (
                                        <div className="nb-sx-banner" role="status">
                                            <span>{search.staleAt ? `Couldn’t search just now. Showing results from ${ageLabel(search.staleAt)}.` : "Couldn’t search just now."}</span>
                                            <button type="button" className="nb-sx-btn" onClick={search.retry}>Retry</button>
                                        </div>
                                    ) : null}
                                    {result?.fixedFrom ? (
                                        <div className="nb-sx-note">Showing results for <b>{result.q}</b> · <button type="button" className="nb-sx-link" onClick={() => setExact(true)}>Search “{result.fixedFrom}” instead</button></div>
                                    ) : null}
                                    {result?.suggestions.length && !result.fixedFrom ? (
                                        <section aria-label="Finish your words">
                                            {result.suggestions.map((word) => (
                                                <button key={word} type="button" className="nb-sx-row nb-sx-row-main nb-sx-suggest" onClick={() => setText(word)}>
                                                    <span className="nb-sx-icon" aria-hidden><Search className="size-3.5" /></span>
                                                    <span className="nb-sx-tx"><span className="nb-sx-t1">{word.toLowerCase().startsWith(q.toLowerCase()) ? <>{word.slice(0, q.length)}<b>{word.slice(q.length)}</b></> : word}</span></span>
                                                    <kbd className="nb-sx-kbd" aria-hidden>tab</kbd>
                                                </button>
                                            ))}
                                        </section>
                                    ) : null}
                                    {search.isFirstLoad && !box?.groups.length ? (
                                        <div className="nb-sx-skel" role="status" aria-label="Searching">
                                            {[60, 72, 48].map((width) => <div key={width} className="nb-sx-row nb-sx-skel-row"><Skeleton kind="tile" className="size-7 shrink-0 rounded-[4px]" /><span className="nb-sx-tx gap-1.5"><Skeleton className="h-2.5 rounded-[2px]" style={{ width: `${width}%` }} /><Skeleton className="h-2.5 rounded-[2px]" style={{ width: `${width - 24}%` }} /></span></div>)}
                                        </div>
                                    ) : null}
                                    <div className={search.isPlaceholder ? "nb-sx-dim" : undefined}>
                                        {invite ? (
                                            <div className="nb-sx-row">
                                                <span className="nb-sx-icon" aria-hidden>@</span>
                                                <span className="nb-sx-tx"><span className="nb-sx-t1">Invite {invite}</span><span className="nb-sx-t2">Copy a sign-up link to send them</span></span>
                                                <button type="button" className="nb-sx-btn" onClick={() => { void copyText(`${window.location.origin}/signup?ref=invite`).then(() => toast.success("Invite link copied"), () => toast.error("Couldn’t copy the link")); }}>Copy invite link</button>
                                            </div>
                                        ) : null}
                                        {emailHit ? <BoxRow hit={emailHit} q={q} active={active?.id === emailHit.id} domId={domId(emailHit)} onHover={() => setActiveIndex(0)} onOpen={() => openHit(emailHit)} action={rowAction(emailHit)} /> : null}
                                        {box?.best ? (
                                            <div id={domId(box.best)} role="option" aria-selected={active?.id === box.best.id} data-active={active?.id === box.best.id || undefined} className="nb-sx-best" onMouseMove={() => setActiveIndex(flat.indexOf(box.best!))}>
                                                <button type="button" tabIndex={-1} className="nb-sx-row-main" onClick={() => openHit(box.best!)}>
                                                    <HitAvatar hit={box.best} size={40} />
                                                    <span className="nb-sx-tx">
                                                        <span className="nb-sx-best-t"><Marked text={box.best.title} q={q} /> <span className="nb-sx-kind">{KIND_LABEL[box.best.kind]}</span></span>
                                                        <span className="nb-sx-t2">{box.best.sub}</span>
                                                        {box.best.meta.relation ? <span className="nb-sx-t2">{String(box.best.meta.relation)}</span> : null}
                                                    </span>
                                                </button>
                                                <span className="nb-sx-end">{rowAction(box.best)}<span className="nb-sx-kind">Best match</span></span>
                                            </div>
                                        ) : null}
                                        {box?.groups.map((group) => (
                                            <section key={group.kind} aria-label={group.label}>
                                                <div className="nb-sx-glabel"><b>{group.label}</b><span className="nb-sx-count">{group.count}</span><span className="nb-sx-rule" />{group.hasMore ? <button type="button" className="nb-sx-link" onClick={() => seeAll(group.kind)}>See all</button> : null}</div>
                                                {group.rows.map((hit) => (
                                                    <Fragment key={hit.id}>
                                                        <BoxRow hit={hit} q={q} active={active?.id === hit.id} domId={domId(hit)} onHover={() => setActiveIndex(flat.indexOf(hit))} onOpen={() => openHit(hit)} action={rowAction(hit)} />
                                                    </Fragment>
                                                ))}
                                            </section>
                                        ))}
                                    </div>
                                    {nothing ? (
                                        <div className="nb-sx-empty">
                                            <b>Nothing called “{q}” yet</b>
                                            <span className="nb-sx-t2">Searched people, workspaces, organizations, posts, your messages and pages.</span>
                                            <span className="nb-sx-chips">
                                                <button type="button" className="nb-sx-btn" onClick={() => confirmAppNavigation(() => { router.push(`/workspaces/new?title=${encodeURIComponent(q)}`); onClose(); })}>New workspace “{q}”</button>
                                                {q.includes(" ") ? <button type="button" className="nb-sx-btn" onClick={() => setText(q.split(" ").slice(0, -1).join(" "))}>Try fewer words</button> : null}
                                            </span>
                                        </div>
                                    ) : null}
                                </>
                            )}
                        </div>
                        {showPreview && active ? <BoxPreview hit={active} q={q} action={rowAction(active)} onOpen={() => openHit(active)} /> : null}
                    </div>

                    <div className="nb-sx-foot">
                        {q ? (
                            <button type="button" className="nb-sx-all" onClick={() => seeAll()}>
                                <Search className="size-3.5" aria-hidden />See all {total} results for “{q}”<kbd className="nb-sx-kbd" data-testid="global-search-enter-hint">⌘↵</kbd>
                            </button>
                        ) : <span>Type to search everything</span>}
                        {search.slow ? <span className="nb-sx-slow"><PixelBeat />STILL SEARCHING</span> : null}
                        <span className="nb-sx-keys max-sm:hidden"><kbd className="nb-sx-kbd">↑↓</kbd> move <kbd className="nb-sx-kbd">↵</kbd> open <kbd className="nb-sx-kbd">tab</kbd> finish</span>
                    </div>
                </form>
                <div ref={panelRef} hidden />
            </DialogContent>
        </Dialog>
    );
}


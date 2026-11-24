"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, ExternalLink, Link2, MoreHorizontal, Pin, PinOff, Plus, Search } from "@/components/ui/icons";

import { setSidebarPinAction, type SidebarOrg, type SidebarRow, type SidebarWorkspaces as Data } from "@/app/actions/org-workspace";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { toast } from "@/lib/feedback";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import { copyText } from "@/lib/clipboard";
import { coverThumbUrl } from "@/lib/workspaces/cover-thumb";
import { PixelPlace } from "@/components/ui/PixelPerson";
import { useChanged } from "@/hooks/useChanged";

// Workspaces in the left navigation (docs/superpowers/plans/2026-11-05-sidebar-workspaces-findings.md): names only,
// each organization a group with its workspaces one step in under a guide line, one "All workspaces" link, the
// workspace you're on always shown, new-updates dots, pins, a filter past 10 rows, and a ⋯ per row.

const MAX_ORGS = 8;
const MAX_CHILDREN = 5;
const MAX_PERSONAL = 12;
const FILTER_FROM = 10;
const orgHref = (o: { slug: string | null; id: string }) => `/org/${encodeURIComponent(o.slug ?? o.id)}`;
const projectHref = (p: { slug: string | null; id: string }) => `/workspaces/${encodeURIComponent(p.slug ?? p.id)}`;
// A row's + and ⋯ float over its right end (`.nb-row-tools` in globals.css), shown on hover, keyboard focus or touch:
// they take no room, so the name, the dot and the count never move (the user, 5 Nov: "remove this jelly effect").
const iconButton = "relative z-10 inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground";
// The name link never paints its own focus box; the whole row shows it (`data-ws-row` in globals.css).
const nameLink = "min-w-0 flex-1 truncate after:absolute after:inset-0 after:rounded-[5px] focus-visible:bg-transparent focus-visible:outline-none";
// A mouse click on a name doesn't leave focus behind, so the row's + and ⋯ don't stay up once the pointer leaves (the
// user, 5 Nov). Keyboard focus is untouched.
const dropMouseFocus = (event: PointerEvent<HTMLElement>) => { if (event.pointerType === "mouse") event.currentTarget.blur(); };

function readOpen(key: string, fallback = true) {
    try { const v = window.localStorage.getItem(key); return v === null ? fallback : v !== "closed"; } catch { return fallback; }
}
function writeOpen(key: string, open: boolean) {
    try { window.localStorage.setItem(key, open ? "open" : "closed"); } catch { /* remembered for this visit only */ }
}

/** G9: Pin to top, Copy link, Open in new tab. */
function RowMenu({ id, title, href, pinned, onPin }: { id: string; title: string; href: string; pinned: boolean; onPin: (id: string, pinned: boolean) => void }) {
    return (
        <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
                <button type="button" className={iconButton} aria-label={`More for ${title}`}><MoreHorizontal className="size-3.5" aria-hidden="true" /></button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="right" className="w-44">
                <DropdownMenuItem onSelect={() => onPin(id, !pinned)}>{pinned ? <PinOff aria-hidden="true" /> : <Pin aria-hidden="true" />}{pinned ? "Unpin" : "Pin to top"}</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void copyText(`${window.location.origin}${href}`).then(() => toast.success("Link copied"), () => toast.error("Couldn’t copy the link"))}><Link2 aria-hidden="true" />Copy link</DropdownMenuItem>
                <DropdownMenuItem asChild><a href={href} target="_blank" rel="noopener"><ExternalLink aria-hidden="true" />Open in new tab</a></DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

/** An org's "needs you" count: the orange chip; it settles in once when it changes. */
function NeedsCount({ value, title }: { value: number; title: string }) {
    const changed = useChanged(value);
    return <span key={value} data-settle={changed || undefined} className="nb-nav-count nb-nav-count--hot pointer-events-none ml-0" title={title} aria-hidden="true">{value > 99 ? "99+" : String(value)}</span>;
}

/** The workspace's own picture as a tiny square, when it has one; nothing at all when it doesn't (shell redesign). */
function WsPic({ src, org = false }: { src?: string | null; org?: boolean }) {
    const [failed, setFailed] = useState(false);
    if (!src || failed) return null;
    return <img className="nb-ws-pic" data-org={org || undefined} src={coverThumbUrl(src, 64)} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />;
}

/**
 * The organization thread: one hairline drops from under the org's picture spot and ends at the last workspace with a
 * square corner; each workspace gets a tick. The line down to the workspace you're on, and its tick, turn ink.
 */
function TreeLines({ index, count, ink }: { index: number; count: number; ink: number }) {
    const above = ink >= 0 && index < ink, here = index === ink;
    return (
        <>
            <i className="nb-ln nb-ln-up" data-ink={above || here || undefined} aria-hidden="true" />
            {index < count - 1 ? <i className="nb-ln nb-ln-dn" data-ink={above || undefined} aria-hidden="true" /> : null}
            <i className="nb-ln nb-ln-tick" data-ink={here || undefined} aria-hidden="true" />
        </>
    );
}

/** One workspace row: its picture if it has one, the name (§1), a new-updates square (G5), and its ⋯ (G9). */
function Row({ row, href, current, prefix, pinned, onPin, muted, tree }: { row: SidebarRow; href: string; current: boolean; prefix?: string; pinned: boolean; onPin: (id: string, pinned: boolean) => void; muted?: boolean; tree?: { index: number; count: number; ink: number } }) {
    // The page you're on is seen: no dot on it.
    const unseen = row.unseen && !current;
    return (
        <li className={cn("group relative", tree && "nb-tree-kid")}>
            {tree ? <TreeLines {...tree} /> : null}
            <div className={cn("nb-nav-link relative", muted && !current && "font-normal")} aria-current={current ? "page" : undefined} data-ws-row style={{ gap: 6 }}>
                <WsPic src={row.coverImage} />
                <Link prefetch={false} href={href} title={prefix ? `${prefix} / ${row.title}` : row.title} aria-current={current ? "page" : undefined}
                    aria-label={`${prefix ? `${prefix} / ` : ""}${row.title}${unseen ? ", new updates" : ""}`}
                    className={nameLink} onPointerUp={dropMouseFocus}>
                    {prefix ? <span className="text-muted-foreground">{prefix} / </span> : null}{row.title}
                </Link>
                {unseen ? <span className="nb-unseen pointer-events-none shrink-0" aria-hidden="true" data-testid="unseen-dot" /> : null}
                <span className="nb-row-tools"><RowMenu id={row.id} title={row.title} href={href} pinned={pinned} onPin={onPin} /></span>
            </div>
        </li>
    );
}

/** §2: an organization and its workspaces as one group. */
function OrgGroup({ org, nested = false, currentId, forceOpen, filterText, pinned, onPin, active }: {
    org: SidebarOrg; nested?: boolean; currentId: string | null; forceOpen: boolean; filterText: string; pinned: Set<string>; onPin: (id: string, pinned: boolean) => void; active: (href: string) => boolean
}) {
    const key = `nb:sidebar-org:${org.id}`;
    const [open, setOpen] = useState(true);
    useEffect(() => setOpen(readOpen(key)), [key]);
    const toggle = () => { setOpen(!open); writeOpen(key, !open); };
    const href = orgHref(org);
    const here = active(href);
    const matching = filterText ? org.children.filter((c) => c.title.toLowerCase().includes(filterText)) : org.children;
    // G2: the one you're on always shows, even past the first five, and opens the group (without changing what's remembered).
    const shown = filterText ? matching : [...org.children.slice(0, MAX_CHILDREN), ...org.children.slice(MAX_CHILDREN).filter((c) => c.id === currentId)];
    const more = filterText ? 0 : org.children.length - shown.length;
    const isOpen = open || forceOpen || Boolean(filterText);
    // The ink path runs from the org down to the workspace you're on (when it's one of these).
    const inkIndex = shown.findIndex((c) => c.id === currentId);
    const needsLabel = org.needsYou ? `${org.needsYou} ${org.needsYou === 1 ? "thing needs" : "things need"} you` : "";
    return (
        <li data-org-group="" data-nested={nested ? "" : undefined} className={nested ? "pl-3" : undefined}>
            <div className="group relative">
                {/* The name starts where every other workspace's does (the user, 5 Nov); the arrow sits at the right end. */}
                <div className="nb-nav-link relative pr-1" aria-current={here ? "page" : undefined} data-org-row data-ws-row style={{ gap: 6 }}>
                    <WsPic src={org.coverImage} org />
                    <Link prefetch={false} href={href} title={org.title} aria-current={here ? "page" : undefined}
                        aria-label={`${org.title}${needsLabel ? `, ${needsLabel}` : ""}${org.unseenAnnouncement ? ", new announcement" : ""}`}
                        className={nameLink} onPointerUp={dropMouseFocus}>{org.title}</Link>
                    {org.needsYou > 0 ? <NeedsCount value={org.needsYou} title={needsLabel} />
                        : org.unseenAnnouncement ? <span className="nb-nav-dot nb-unseen pointer-events-none mx-1" aria-hidden="true" /> : null}
                    {shown.length ? <i className="nb-ln nb-ln-stem" data-open={isOpen} data-ink={inkIndex >= 0 || undefined} aria-hidden="true" /> : null}
                    <span className="nb-row-tools">
                        {org.canCreate ? (
                            <Link prefetch={false} href={`/workspaces/new?org=${encodeURIComponent(org.slug ?? org.id)}`} className={iconButton} aria-label={`New workspace in ${org.title}`} title={`New workspace in ${org.title}`}>
                                <Plus className="size-3.5" aria-hidden="true" />
                            </Link>
                        ) : null}
                        <RowMenu id={org.id} title={org.title} href={href} pinned={pinned.has(org.id)} onPin={onPin} />
                    </span>
                    <button type="button" onClick={toggle} className={cn(iconButton, "nb-touch-target size-5")} aria-expanded={isOpen} aria-controls={`sidebar-org-${org.id}`}
                        aria-label={`${isOpen ? "Hide" : "Show"} ${org.title}’s workspaces`}>
                        {isOpen ? <ChevronDown className="size-3.5" aria-hidden="true" /> : <ChevronRight className="size-3.5" aria-hidden="true" />}
                    </button>
                </div>
            </div>
            {/* Always rendered so opening draws the thread down and closing folds it up (CSS); closed, it's inert. */}
            {(
                <div className="nb-tree-open" data-open={isOpen} inert={!isOpen} aria-hidden={!isOpen || undefined}>
                    <div className="nb-tree-inner">
                    <ul id={`sidebar-org-${org.id}`} aria-label={`Workspaces in ${org.title}`} className="nb-tree-kids" data-testid="sidebar-org-children">
                        {shown.map((child, index) => <Row key={child.id} row={child} href={projectHref(child)} current={child.id === currentId} pinned={pinned.has(child.id)} onPin={onPin} muted tree={{ index, count: shown.length, ink: inkIndex }} />)}
                    </ul>
                    {/* §2: one closing link for everyone (D3), outside the thread, so the tree ends at the last real workspace. */}
                    {filterText ? null : (
                        <Link prefetch={false} href={`${href}?tab=projects`} className="nb-tree-more">All workspaces{more > 0 ? ` · ${more} more` : ""}</Link>
                    )}
                    </div>
                </div>
            )}
        </li>
    );
}

export function SidebarWorkspaces({ data, autoFocusFilter = false }: { data: Data; autoFocusFilter?: boolean }) {
    const pathname = usePathname();
    const client = useQueryClient();
    const [showAllOrgs, setShowAllOrgs] = useState(false);
    const [showAllPersonal, setShowAllPersonal] = useState(false);
    const [showArchived, setShowArchived] = useState(false);
    const [filter, setFilter] = useState("");
    const [pins, setPins] = useState<string[]>(data.pinned ?? []);
    const filterRef = useRef<HTMLInputElement>(null);
    useEffect(() => setPins(data.pinned ?? []), [data.pinned]);
    useEffect(() => setShowArchived(readOpen("nb:sidebar-archived", false)), []);
    useEffect(() => { if (autoFocusFilter) filterRef.current?.focus(); }, [autoFocusFilter]);
    const active = (href: string) => pathname === href || Boolean(pathname?.startsWith(`${href}/`));
    const pinned = useMemo(() => new Set(pins), [pins]);
    const onPin = (id: string, next: boolean) => {
        const before = pins;
        setPins(next ? [...pins.filter((p) => p !== id), id] : pins.filter((p) => p !== id));
        void setSidebarPinAction(id, next).then((r) => {
            if (!r.success) { setPins(before); toast.error(r.error); return; }
            toast.success(next ? "Pinned to top" : "Unpinned");
            void client.invalidateQueries({ queryKey: queryKeys.profile.sidebarWorkspacesRoot() });
        });
    };

    // The row you're on (G2): a child, a personal or outside workspace, or an organization.
    const currentId = useMemo(() => {
        for (const o of data.orgs) for (const c of o.children) if (active(projectHref(c))) return c.id;
        for (const p of [...data.personal, ...data.outside]) if (active(projectHref(p))) return p.id;
        return null;
    }, [data, pathname]);

    // Opening a workspace is seeing it (the user, 5 Nov): its dot goes at once — here, and in the cached list, so it
    // doesn't come back before the next read (which already counts this visit; stampOpened).
    useEffect(() => {
        if (!currentId) return;
        const seen = (r: SidebarRow) => (r.id === currentId && r.unseen ? { ...r, unseen: false } : r);
        client.setQueriesData<Data | null>({ queryKey: queryKeys.profile.sidebarWorkspacesRoot() }, (old) => old ? {
            ...old,
            orgs: old.orgs.map((o) => ({ ...o, children: o.children.map(seen) })),
            personal: old.personal.map(seen),
            outside: old.outside.map((r) => ({ ...r, ...seen(r) })),
        } : old);
    }, [client, currentId]);

    const text = filter.trim().toLowerCase();
    const totalRows = sidebarRowCount(data);
    const orgMatches = (o: SidebarOrg) => !text || o.title.toLowerCase().includes(text) || o.children.some((c) => c.title.toLowerCase().includes(text));
    const rowMatches = (r: { title: string; orgTitle?: string }) => !text || r.title.toLowerCase().includes(text) || Boolean(r.orgTitle?.toLowerCase().includes(text));

    const pinnedOrgs = data.orgs.filter((o) => pinned.has(o.id));
    const pinnedRows = [...data.personal, ...data.outside, ...data.orgs.flatMap((o) => o.children)].filter((r) => pinned.has(r.id));
    const unordered = data.orgs.filter((o) => !pinned.has(o.id) && orgMatches(o));
    // Report 29.2: a class follows its school, one step in, when both are in the list.
    const inList = new Set(unordered.map((o) => o.id));
    const nested = (o: SidebarOrg) => Boolean(o.schoolId && inList.has(o.schoolId));
    const orgs = unordered.filter((o) => !nested(o)).flatMap((o) => [o, ...unordered.filter((c) => c.schoolId === o.id)]);
    const shownOrgs = showAllOrgs || text ? orgs : orgs.slice(0, MAX_ORGS);
    const personal = data.personal.filter((p) => !pinned.has(p.id) && rowMatches(p));
    const shownPersonal = showAllPersonal || text ? personal : [...personal.slice(0, MAX_PERSONAL), ...personal.slice(MAX_PERSONAL).filter((p) => p.id === currentId)];
    const outside = data.outside.filter((p) => !pinned.has(p.id) && rowMatches(p));
    const requested = data.requested.filter(rowMatches);
    const empty = data.orgs.length + data.requested.length + data.outside.length + data.personal.length === 0;
    const nothingMatches = Boolean(text) && !pinnedOrgs.some(orgMatches) && !pinnedRows.some(rowMatches) && orgs.length + personal.length + outside.length + requested.length === 0;
    const childFor = (id: string) => data.orgs.find((o) => o.children.some((c) => c.id === id));

    const group = (o: SidebarOrg) => <OrgGroup key={o.id} org={o} nested={nested(o)} currentId={currentId} forceOpen={o.children.some((c) => c.id === currentId)} filterText={text} pinned={pinned} onPin={onPin} active={active} />;
    const plain = (r: SidebarRow & { orgTitle?: string }) => <Row key={r.id} row={r} href={projectHref(r)} current={r.id === currentId} prefix={r.orgTitle ?? childFor(r.id)?.title} pinned={pinned.has(r.id)} onPin={onPin} />;
    const label = (children: ReactNode) => <li className="nb-sidebar-sub" aria-hidden="true">{children}</li>;

    return (
        <div className="space-y-1" data-testid="sidebar-workspaces">
            {/* G8 (D6): a filter once the list is longer than 10 rows. */}
            {totalRows > FILTER_FROM ? (
                <label className="relative mx-1 mb-1 flex items-center">
                    <Search className="pointer-events-none absolute left-2 size-3.5 text-muted-foreground" aria-hidden="true" />
                    <input ref={filterRef} type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter" aria-label="Filter workspaces"
                        onKeyDown={(e) => { if (e.key === "Escape" && filter) { e.preventDefault(); e.stopPropagation(); setFilter(""); } }}
                        className="h-7 w-full rounded-[5px] border border-border bg-transparent pl-7 pr-2 text-[12px] text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none" />
                </label>
            ) : null}
            <ul className="space-y-0.5" aria-label="Your workspaces">
                {/* G9: pinned first, under a quiet label. */}
                {pinnedOrgs.length + pinnedRows.length > 0 && (!text || pinnedOrgs.some(orgMatches) || pinnedRows.some(rowMatches)) ? <>
                    {label("Pinned")}
                    {pinnedOrgs.filter(orgMatches).map(group)}
                    {pinnedRows.filter(rowMatches).map(plain)}
                    <li className="nb-sidebar-sep" aria-hidden="true" />
                </> : null}
                {shownOrgs.map(group)}
                {!showAllOrgs && !text && orgs.length > MAX_ORGS ? <li><button type="button" onClick={() => setShowAllOrgs(true)} className="nb-nav-link w-full font-normal text-muted-foreground">More · {orgs.length - MAX_ORGS}</button></li> : null}
                {/* Every row the same distance apart, organizations and workspaces alike (the user, 5 Nov; replaces G6's gap). */}
                {requested.map((org) => (
                    <li key={org.id}>
                        <Link prefetch={false} href={`${orgHref(org)}?tab=about`} className="nb-nav-link font-normal text-muted-foreground" title={`${org.title} · Requested`}>
                            <WsPic src={org.coverImage} org /><span className="min-w-0 flex-1 truncate">{org.title}</span><span className="nb-tag-requested">Requested</span>
                        </Link>
                    </li>
                ))}
                {outside.map(plain)}
                {shownPersonal.map(plain)}
                {!showAllPersonal && !text && personal.length > shownPersonal.length ? <li><button type="button" onClick={() => setShowAllPersonal(true)} className="nb-nav-link w-full font-normal text-muted-foreground">More · {personal.length - shownPersonal.length}</button></li> : null}
            </ul>
            {nothingMatches ? <p className="px-2 py-1 text-xs text-muted-foreground" role="status">No workspaces match</p> : null}
            {empty ? <SidebarEmpty /> : null}
            {data.archived.length > 0 && !text ? (
                <div>
                    {/* G11: remembered like an organization's group. */}
                    <button type="button" onClick={() => { setShowArchived(!showArchived); writeOpen("nb:sidebar-archived", !showArchived); }} aria-expanded={showArchived}
                        className="nb-nav-link w-full pr-1 font-normal text-muted-foreground" style={{ gap: 4 }}>
                        {/* Like an organization's row: the words line up with every name, the arrow at the right end. */}
                        <span className="min-w-0 flex-1 text-left">Archived ({data.archived.length})</span>
                        <span className="inline-flex size-5 items-center justify-center">{showArchived ? <ChevronDown className="size-3.5" aria-hidden="true" /> : <ChevronRight className="size-3.5" aria-hidden="true" />}</span>
                    </button>
                    {showArchived ? (
                        <ul aria-label="Archived workspaces" className="nb-tree-kids nb-tree-archived">
                            {data.archived.map((p, index) => {
                                const href = p.kind === "organization" ? orgHref(p) : projectHref(p);
                                return (
                                    <li key={p.id} className="nb-tree-kid">
                                        <TreeLines index={index} count={data.archived.length} ink={active(href) ? index : -1} />
                                        <Link prefetch={false} href={href} className="nb-nav-link font-normal" title={p.title} aria-current={active(href) ? "page" : undefined}><span className="truncate">{p.title}</span></Link>
                                    </li>
                                );
                            })}
                        </ul>
                    ) : null}
                </div>
            ) : null}
            {empty ? null : <Link prefetch={false} href="/join" className="nb-nav-link font-normal text-muted-foreground" style={{ gap: 6 }}><Plus className="size-3.5" aria-hidden="true" />Join with code</Link>}
        </div>
    );
}

/** No workspaces yet: the pixel desk, and the two ways in. */
export function SidebarEmpty() {
    return (
        <div className="nb-sidebar-empty">
            <span className="nb-sidebar-empty-pic" aria-hidden="true"><PixelPlace kind="workspace" identityKey="empty" size={26} /></span>
            <span className="min-w-0">
                <span className="block font-medium text-foreground">No workspaces yet</span>
                <span className="text-muted-foreground"><Link prefetch={false} href="/workspaces/new">Create one</Link> · <Link prefetch={false} href="/join">Join with code</Link></span>
            </span>
        </div>
    );
}

/** The place a page belongs to (a workspace or organization in your list), for the top bar's path and picture. */
export type SidebarPlace = { id: string; title: string; href: string; coverImage: string | null; organization: boolean; parentId: string | null };
export function sidebarPlaces(data: Data | null | undefined): SidebarPlace[] {
    if (!data) return [];
    const place = (r: { id: string; title: string; slug: string | null; coverImage?: string | null }, organization: boolean, parentId: string | null = null): SidebarPlace =>
        ({ id: r.id, title: r.title, href: organization ? orgHref(r) : projectHref(r), coverImage: r.coverImage ?? null, organization, parentId });
    return [
        ...data.orgs.flatMap((o) => [place(o, true), ...o.children.map((c) => place(c, false, o.id))]),
        ...data.outside.map((r) => place(r, false)),
        ...data.personal.map((r) => place(r, false)),
    ];
}
export function placeForPath(data: Data | null | undefined, pathname: string | null): SidebarPlace | null {
    if (!pathname) return null;
    return sidebarPlaces(data).find((p) => pathname === p.href || pathname.startsWith(`${p.href}/`)) ?? null;
}
/** Every row the list can show (orgs and their workspaces, requests, outside and personal), for the label's counter. */
export const sidebarRowCount = (data: Data) => data.orgs.reduce((n, o) => n + 1 + o.children.length, 0) + data.outside.length + data.personal.length + data.requested.length;

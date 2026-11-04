"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, ExternalLink, Link2, MoreHorizontal, Pin, PinOff, Plus, Search } from "lucide-react";

import { setSidebarPinAction, type SidebarOrg, type SidebarRow, type SidebarWorkspaces as Data } from "@/app/actions/org-workspace";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { toast } from "@/lib/feedback";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";

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
const iconButton = "relative z-10 inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground";
// The name link never paints its own focus box; the whole row shows it (`data-ws-row` in globals.css).
const nameLink = "min-w-0 flex-1 truncate after:absolute after:inset-0 after:rounded-[5px] focus-visible:bg-transparent focus-visible:outline-none";

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
                <DropdownMenuItem onSelect={() => void navigator.clipboard?.writeText(`${window.location.origin}${href}`).then(() => toast.success("Link copied"), () => toast.error("Couldn’t copy the link"))}><Link2 aria-hidden="true" />Copy link</DropdownMenuItem>
                <DropdownMenuItem asChild><a href={href} target="_blank" rel="noopener"><ExternalLink aria-hidden="true" />Open in new tab</a></DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

/** One workspace row: the name alone (§1), a new-updates dot (G5), and its ⋯ (G9). */
function Row({ row, href, current, prefix, pinned, onPin, muted }: { row: SidebarRow; href: string; current: boolean; prefix?: string; pinned: boolean; onPin: (id: string, pinned: boolean) => void; muted?: boolean }) {
    // The page you're on is seen: no dot on it.
    const unseen = row.unseen && !current;
    return (
        <li className="group relative">
            <div className={cn("nb-nav-link relative", muted && !current && "font-normal")} aria-current={current ? "page" : undefined} data-ws-row style={{ gap: 6 }}>
                <Link prefetch={false} href={href} title={prefix ? `${prefix} / ${row.title}` : row.title} aria-current={current ? "page" : undefined}
                    aria-label={`${prefix ? `${prefix} / ` : ""}${row.title}${unseen ? ", new updates" : ""}`}
                    className={nameLink}>
                    {prefix ? <span className="text-muted-foreground">{prefix} / </span> : null}{row.title}
                </Link>
                {unseen ? <span className="pointer-events-none size-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" data-testid="unseen-dot" /> : null}
                <span className="nb-row-tools"><RowMenu id={row.id} title={row.title} href={href} pinned={pinned} onPin={onPin} /></span>
            </div>
        </li>
    );
}

/** §2: an organization and its workspaces as one group. */
function OrgGroup({ org, currentId, forceOpen, filterText, pinned, onPin, active }: {
    org: SidebarOrg; currentId: string | null; forceOpen: boolean; filterText: string; pinned: Set<string>; onPin: (id: string, pinned: boolean) => void; active: (href: string) => boolean
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
    const needs = org.needsYou > 99 ? "99+" : String(org.needsYou);
    const needsLabel = org.needsYou ? `${org.needsYou} ${org.needsYou === 1 ? "thing needs" : "things need"} you` : "";
    return (
        <li>
            <div className="group relative">
                <div className="nb-nav-link relative gap-1 pl-1" aria-current={here ? "page" : undefined} data-org-row data-ws-row style={{ gap: 4 }}>
                    <button type="button" onClick={toggle} className={cn(iconButton, "size-5")} aria-expanded={isOpen} aria-controls={`sidebar-org-${org.id}`}
                        aria-label={`${isOpen ? "Hide" : "Show"} ${org.title}’s workspaces`}>
                        {isOpen ? <ChevronDown className="size-3.5" aria-hidden="true" /> : <ChevronRight className="size-3.5" aria-hidden="true" />}
                    </button>
                    <Link prefetch={false} href={href} title={org.title} aria-current={here ? "page" : undefined}
                        aria-label={`${org.title}${needsLabel ? `, ${needsLabel}` : ""}${org.unseenAnnouncement ? ", new announcement" : ""}`}
                        className={nameLink}>{org.title}</Link>
                    {org.needsYou > 0 ? <span className="nb-nav-count pointer-events-none ml-0" title={needsLabel} aria-hidden="true">{needs}</span>
                        : org.unseenAnnouncement ? <span className="nb-nav-dot pointer-events-none mx-1 size-1.5 rounded-full bg-primary" aria-hidden="true" /> : null}
                    <span className="nb-row-tools">
                        {org.canCreate ? (
                            <Link prefetch={false} href={`/workspaces/new?org=${encodeURIComponent(org.slug ?? org.id)}`} className={iconButton} aria-label={`New workspace in ${org.title}`} title={`New workspace in ${org.title}`}>
                                <Plus className="size-3.5" aria-hidden="true" />
                            </Link>
                        ) : null}
                        <RowMenu id={org.id} title={org.title} href={href} pinned={pinned.has(org.id)} onPin={onPin} />
                    </span>
                </div>
            </div>
            {isOpen ? (
                <ul id={`sidebar-org-${org.id}`} aria-label={`Workspaces in ${org.title}`} className="ml-[15px] space-y-0.5 border-l border-border pl-1.5" data-testid="sidebar-org-children">
                    {shown.map((child) => <Row key={child.id} row={child} href={projectHref(child)} current={child.id === currentId} pinned={pinned.has(child.id)} onPin={onPin} muted />)}
                    {/* §2: one closing link for everyone (D3); "· N more" when some are hidden. */}
                    {filterText ? null : (
                        <li><Link prefetch={false} href={`${href}?tab=projects`} className="nb-nav-link font-normal text-muted-foreground">All workspaces{more > 0 ? ` · ${more} more` : ""}</Link></li>
                    )}
                </ul>
            ) : null}
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
    const totalRows = data.orgs.reduce((n, o) => n + 1 + o.children.length, 0) + data.outside.length + data.personal.length + data.requested.length;
    const orgMatches = (o: SidebarOrg) => !text || o.title.toLowerCase().includes(text) || o.children.some((c) => c.title.toLowerCase().includes(text));
    const rowMatches = (r: { title: string; orgTitle?: string }) => !text || r.title.toLowerCase().includes(text) || Boolean(r.orgTitle?.toLowerCase().includes(text));

    const pinnedOrgs = data.orgs.filter((o) => pinned.has(o.id));
    const pinnedRows = [...data.personal, ...data.outside, ...data.orgs.flatMap((o) => o.children)].filter((r) => pinned.has(r.id));
    const orgs = data.orgs.filter((o) => !pinned.has(o.id) && orgMatches(o));
    const shownOrgs = showAllOrgs || text ? orgs : orgs.slice(0, MAX_ORGS);
    const personal = data.personal.filter((p) => !pinned.has(p.id) && rowMatches(p));
    const shownPersonal = showAllPersonal || text ? personal : [...personal.slice(0, MAX_PERSONAL), ...personal.slice(MAX_PERSONAL).filter((p) => p.id === currentId)];
    const outside = data.outside.filter((p) => !pinned.has(p.id) && rowMatches(p));
    const requested = data.requested.filter(rowMatches);
    const empty = data.orgs.length + data.requested.length + data.outside.length + data.personal.length === 0;
    const nothingMatches = Boolean(text) && !pinnedOrgs.some(orgMatches) && !pinnedRows.some(rowMatches) && orgs.length + personal.length + outside.length + requested.length === 0;
    const childFor = (id: string) => data.orgs.find((o) => o.children.some((c) => c.id === id));

    const group = (o: SidebarOrg) => <OrgGroup key={o.id} org={o} currentId={currentId} forceOpen={o.children.some((c) => c.id === currentId)} filterText={text} pinned={pinned} onPin={onPin} active={active} />;
    const plain = (r: SidebarRow & { orgTitle?: string }) => <Row key={r.id} row={r} href={projectHref(r)} current={r.id === currentId} prefix={r.orgTitle ?? childFor(r.id)?.title} pinned={pinned.has(r.id)} onPin={onPin} />;
    const label = (children: ReactNode) => <li className="px-2 pb-0.5 pt-2 text-[11px] text-muted-foreground" aria-hidden="true">{children}</li>;

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
                    <li aria-hidden="true" className="h-2" />
                </> : null}
                {shownOrgs.map(group)}
                {!showAllOrgs && !text && orgs.length > MAX_ORGS ? <li><button type="button" onClick={() => setShowAllOrgs(true)} className="nb-nav-link w-full font-normal text-muted-foreground">More ({orgs.length - MAX_ORGS})</button></li> : null}
                {/* G6: a little space between the organizations and your own workspaces. */}
                {shownOrgs.length && (requested.length + outside.length + shownPersonal.length) ? <li aria-hidden="true" className="h-2" /> : null}
                {requested.map((org) => (
                    <li key={org.id}>
                        <Link prefetch={false} href={`${orgHref(org)}?tab=about`} className="nb-nav-link font-normal text-muted-foreground" title={`${org.title} · Requested`}>
                            <span className="min-w-0 flex-1 truncate">{org.title}</span><span className="text-[11px] text-muted-foreground">Requested</span>
                        </Link>
                    </li>
                ))}
                {outside.map(plain)}
                {shownPersonal.map(plain)}
                {!showAllPersonal && !text && personal.length > shownPersonal.length ? <li><button type="button" onClick={() => setShowAllPersonal(true)} className="nb-nav-link w-full font-normal text-muted-foreground">More ({personal.length - shownPersonal.length})</button></li> : null}
            </ul>
            {nothingMatches ? <p className="px-2 py-1 text-xs text-muted-foreground" role="status">No workspaces match</p> : null}
            {empty ? <p className="px-2 py-1 text-xs text-muted-foreground">No workspaces yet</p> : null}
            {data.archived.length > 0 && !text ? (
                <div>
                    {/* G11: remembered like an organization's group. */}
                    <button type="button" onClick={() => { setShowArchived(!showArchived); writeOpen("nb:sidebar-archived", !showArchived); }} aria-expanded={showArchived}
                        className="nb-nav-link w-full gap-1 pl-1 font-normal text-muted-foreground" style={{ gap: 4 }}>
                        <span className="inline-flex size-5 items-center justify-center">{showArchived ? <ChevronDown className="size-3.5" aria-hidden="true" /> : <ChevronRight className="size-3.5" aria-hidden="true" />}</span>Archived ({data.archived.length})
                    </button>
                    {showArchived ? (
                        <ul aria-label="Archived workspaces" className="ml-[15px] space-y-0.5 border-l border-border pl-1.5">
                            {data.archived.map((p) => (
                                <li key={p.id}><Link prefetch={false} href={p.kind === "organization" ? orgHref(p) : projectHref(p)} className="nb-nav-link font-normal" title={p.title}><span className="truncate">{p.title}</span></Link></li>
                            ))}
                        </ul>
                    ) : null}
                </div>
            ) : null}
            <Link prefetch={false} href="/join" className="nb-nav-link font-normal text-muted-foreground" style={{ gap: 6 }}><Plus className="size-3.5" aria-hidden="true" />Join with code</Link>
        </div>
    );
}

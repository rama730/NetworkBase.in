"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";

import type { SidebarOrg, SidebarWorkspaces as Data } from "@/app/actions/org-workspace";
import { cn } from "@/lib/utils";

// Workspaces in the left navigation (report §29.3): orgs first with the child projects you belong to, Needs you
// badges and an unseen-announcement dot; requests waiting for approval; personal projects; Archived; Join with code.

const MAX_ORGS = 8;
const orgHref = (o: { slug: string | null; id: string }) => `/org/${encodeURIComponent(o.slug ?? o.id)}`;
const projectHref = (p: { slug: string | null; id: string }) => `/projects/${encodeURIComponent(p.slug ?? p.id)}`;

function readOpen(id: string) {
    try { return window.localStorage.getItem(`nb:sidebar-org:${id}`) !== "closed"; } catch { return true; }
}
function writeOpen(id: string, open: boolean) {
    try { window.localStorage.setItem(`nb:sidebar-org:${id}`, open ? "open" : "closed"); } catch { /* remembered for this visit only */ }
}

/** Logo or initials: what stays visible when the sidebar is collapsed. */
function Mark({ title, logo, dot }: { title: string; logo?: string | null; dot?: boolean }) {
    return (
        <span className="relative inline-flex size-5 shrink-0 items-center justify-center overflow-hidden rounded-[4px] bg-muted text-[10px] font-semibold text-muted-foreground" aria-hidden="true">
            {logo ? <img src={logo} alt="" className="size-5 object-cover" /> : title.slice(0, 2).toUpperCase()}
            {dot ? <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-primary ring-2 ring-background" /> : null}
        </span>
    );
}

function OrgRow({ org, active }: { org: SidebarOrg; active: (href: string) => boolean }) {
    const [open, setOpen] = useState(true);
    useEffect(() => setOpen(readOpen(org.id)), [org.id]);
    const toggle = () => { setOpen(!open); writeOpen(org.id, !open); };
    const href = orgHref(org);
    return (
        <div>
            <div className="group relative flex items-center">
                <button type="button" onClick={toggle} className="nb-sidebar-label shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground" aria-label={`${open ? "Collapse" : "Expand"} ${org.title}`} aria-expanded={open}>
                    {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                </button>
                <Link href={href} className="nb-nav-link min-w-0 flex-1" title={org.title} aria-current={active(href) ? "page" : undefined}
                    aria-label={`${org.title}${org.needsYou ? `, ${org.needsYou} need you` : ""}${org.unseenAnnouncement ? ", new announcement" : ""}`}>
                    <Mark title={org.title} logo={org.logo} dot={org.unseenAnnouncement || org.needsYou > 0} />
                    <span className="nb-sidebar-label truncate">{org.title}</span>
                    {org.unseenAnnouncement ? <span className="nb-sidebar-label size-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" /> : null}
                    {org.needsYou > 0 ? <span className="nb-nav-count nb-sidebar-label" aria-hidden="true">{org.needsYou > 99 ? "99+" : org.needsYou}</span> : null}
                </Link>
                {org.canCreate ? (
                    <Link href={`/projects/new?org=${encodeURIComponent(org.id)}`} className="nb-sidebar-label absolute right-1 hidden rounded p-0.5 text-muted-foreground hover:text-foreground group-hover:block group-focus-within:block" aria-label={`New project in ${org.title}`} title={`New project in ${org.title}`}>
                        <Plus className="size-3.5" />
                    </Link>
                ) : null}
            </div>
            {open && (org.children.length > 0 || org.isAdmin) ? (
                <div className="nb-sidebar-label ml-6 space-y-0.5">
                    {org.children.map((child) => (
                        <Link key={child.id} href={projectHref(child)} className="nb-nav-link py-1 text-[13px]" title={child.title} aria-current={active(projectHref(child)) ? "page" : undefined}>
                            <span className="truncate">{child.title}</span>
                        </Link>
                    ))}
                    {org.moreChildren > 0 ? <Link href={`${href}?tab=projects`} className="block px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground">See all</Link> : null}
                    {org.isAdmin ? <Link href={`${href}?tab=projects`} className="block px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground">All projects</Link> : null}
                </div>
            ) : null}
        </div>
    );
}

export function SidebarWorkspaces({ data }: { data: Data }) {
    const pathname = usePathname();
    const [showAllOrgs, setShowAllOrgs] = useState(false);
    const [showArchived, setShowArchived] = useState(false);
    const active = (href: string) => pathname === href || Boolean(pathname?.startsWith(`${href}/`));
    const orgs = showAllOrgs ? data.orgs : data.orgs.slice(0, MAX_ORGS);
    const empty = data.orgs.length + data.requested.length + data.outside.length + data.personal.length === 0;
    return (
        <div className="space-y-1" aria-label="Your workspaces">
            {orgs.map((org) => <OrgRow key={org.id} org={org} active={active} />)}
            {!showAllOrgs && data.orgs.length > MAX_ORGS ? <button type="button" onClick={() => setShowAllOrgs(true)} className="nb-sidebar-label px-2 py-1 text-xs text-muted-foreground hover:text-foreground">More ({data.orgs.length - MAX_ORGS})</button> : null}
            {data.requested.map((org) => (
                <Link key={org.id} href={`${orgHref(org)}?tab=about`} className="nb-nav-link opacity-60" title={`${org.title} · Requested`}>
                    <Mark title={org.title} />
                    <span className="nb-sidebar-label truncate">{org.title}</span>
                    <span className="nb-sidebar-label ml-auto text-[11px] text-muted-foreground">Requested</span>
                </Link>
            ))}
            {data.outside.map((p) => (
                <Link key={p.id} href={projectHref(p)} className="nb-nav-link" title={`${p.orgTitle} / ${p.title}`} aria-current={active(projectHref(p)) ? "page" : undefined}>
                    <Mark title={p.title} />
                    <span className="nb-sidebar-label truncate"><span className="text-muted-foreground">{p.orgTitle} / </span>{p.title}</span>
                </Link>
            ))}
            {data.personal.map((p) => (
                <Link key={p.id} href={projectHref(p)} className="nb-nav-link" title={p.title} aria-current={active(projectHref(p)) ? "page" : undefined}>
                    <Mark title={p.title} logo={p.logo} />
                    <span className="nb-sidebar-label truncate">{p.title}</span>
                </Link>
            ))}
            {empty ? <p className="nb-sidebar-label px-2 py-1 text-xs text-muted-foreground">No projects yet</p> : null}
            {data.archived.length > 0 ? (
                <div className="nb-sidebar-label">
                    <button type="button" onClick={() => setShowArchived(!showArchived)} aria-expanded={showArchived} className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground">
                        {showArchived ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}Archived ({data.archived.length})
                    </button>
                    {showArchived ? data.archived.map((p) => (
                        <Link key={p.id} href={p.kind === "organization" ? orgHref(p) : projectHref(p)} className={cn("nb-nav-link ml-5 py-1 text-[13px] text-muted-foreground")} title={p.title}>
                            <span className="truncate">{p.title}</span>
                        </Link>
                    )) : null}
                </div>
            ) : null}
            <Link href="/join" className="nb-sidebar-label flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground hover:text-foreground"><Plus className="size-3.5" aria-hidden="true" />Join with code</Link>
        </div>
    );
}

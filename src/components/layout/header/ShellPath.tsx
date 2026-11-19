"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { ChevronDown, Search } from "lucide-react";
import { useTypedPath } from "@/components/auth/AuthPanel";
import { WorkspaceAvatar } from "@/components/workspaces/WorkspaceAvatar";
import { useSidebarWorkspacesQuery } from "@/components/layout/AppSidebar";
import { placeForPath, sidebarPlaces, type SidebarPlace } from "@/components/layout/SidebarWorkspaces";
import { readRecentPages } from "@/lib/navigation/recent-pages";
import { coverThumbUrl } from "@/lib/workspaces/cover-thumb";
import { isPlacePath, shellPartsFor } from "@/lib/navigation/shell-path";
import { usePlaceName } from "@/lib/navigation/place-name";

/** Where a breadcrumb part goes. Workspaces and organizations have no index page, so they open the switcher instead. */
const CRUMB_HREF: Record<string, string> = { settings: "/settings", messages: "/messages", u: "/network", admin: "/admin/trust", network: "/network", discover: "/discover" };


function PlacePic({ place, size = 18 }: { place: SidebarPlace | null; size?: number }) {
    const [failed, setFailed] = useState(false);
    useEffect(() => setFailed(false), [place?.coverImage]);
    if (!place?.coverImage || failed) return null;
    return <img className="nb-path-pic" data-org={place.organization || undefined} src={coverThumbUrl(place.coverImage, 64)} alt="" width={size} height={size} onError={() => setFailed(true)} />;
}

/** The workspace part of the path: switch to a recent workspace or organization. */
function Switcher({ label, places, current }: { label: string; places: SidebarPlace[]; current: SidebarPlace | null }) {
    const [open, setOpen] = useState(false);
    const recent = useMemo(() => {
        if (!open) return [];
        const visited = readRecentPages(current?.href ?? "", 12).map((page) => places.find((p) => page.path === p.href || page.path.startsWith(`${p.href}/`))).filter(Boolean) as SidebarPlace[];
        const unique = [...new Map([...visited, ...places].filter((p) => p.id !== current?.id).map((p) => [p.id, p])).values()];
        return unique.slice(0, 5);
    }, [open, places, current]);
    return (
        <Popover.Root open={open} onOpenChange={setOpen}>
            <Popover.Trigger asChild>
                <button type="button" className="nb-crumb nb-crumb-switch" aria-label={`${label}, switch workspace`} title={label}>
                    <span className="nb-crumb-name">{label}</span><ChevronDown className="size-3" aria-hidden="true" />
                </button>
            </Popover.Trigger>
            <Popover.Portal>
                <Popover.Content align="start" sideOffset={10} className="nb-shell-pop z-50 w-72" aria-label="Switch workspace">
                    <p className="nb-shell-pop-label"><span>Recent workspaces</span><span>{recent.length}</span></p>
                    {recent.map((p) => (
                        <Link key={p.id} href={p.href} prefetch={false} className="nb-shell-pop-row" onClick={() => setOpen(false)}>
                            <WorkspaceAvatar project={{ id: p.id, title: p.title, coverImage: p.coverImage, kind: p.organization ? "organization" : "workspace" }} parentId={p.parentId} size="row" />
                            <span className="min-w-0"><b className="block truncate">{p.title}</b><span className="nb-shell-pop-path">{p.href.slice(1)}</span></span>
                        </Link>
                    ))}
                    <button type="button" className="nb-shell-pop-row nb-shell-pop-more" onClick={() => { setOpen(false); window.dispatchEvent(new CustomEvent("open-command-palette", { detail: { query: "" } })); }}>
                        <Search className="size-4 text-muted-foreground" aria-hidden="true" />Search all workspaces
                    </button>
                </Popover.Content>
            </Popover.Portal>
        </Popover.Root>
    );
}

/**
 * The top bar's "you are here" (shell redesign): `networkbase / workspaces / Alpha app` in mono, a place by its real name. It types itself in when
 * you move, the way the sign-in address does, then each part becomes a link; the workspace part opens a quick switcher.
 * The place's own picture sits before it (never a default up here).
 */
export function ShellPath({ phone = false }: { phone?: boolean }) {
    const pathname = usePathname() ?? "/";
    const { data } = useSidebarWorkspacesQuery();
    const place = useMemo(() => placeForPath(data, pathname), [data, pathname]);
    // The page's own name is freshest (a rename, a place you only visit); the sidebar's shows before the page loads.
    const pageName = usePlaceName(pathname);
    const parts = shellPartsFor(pathname, pageName ?? place?.title);
    const target = parts.join("/");
    const shown = useTypedPath(target, 22);
    const typing = shown !== target;
    const places = useMemo(() => sidebarPlaces(data), [data]);

    if (phone) {
        return (
            <span className="nb-shell-path nb-shell-path--phone" aria-label={`You are here: ${parts.join(" / ")}`}>
                {/* The dot before it is the bar's logo (it turns into the back arrow on deeper pages); a picture shows here. */}
                <PlacePic place={place} size={18} />
                <b>{parts[parts.length - 1]}</b>
            </span>
        );
    }

    const onPlace = isPlacePath(pathname);
    return (
        <div className="nb-cell nb-shell-path" data-typing={typing || undefined}>
            <PlacePic place={place} />
            <span className="nb-shell-path-pre" aria-hidden="true">networkbase&nbsp;/&nbsp;</span>
            <nav aria-label="You are here" className="nb-shell-path-crumbs">
                {typing ? (
                    <b aria-hidden="true">{shown}<span className="nb-shell-caret" /></b>
                ) : parts.map((part, index) => {
                    const last = index === parts.length - 1;
                    const sep = index ? <span className="nb-crumb-sep" aria-hidden="true">/</span> : null;
                    if (last && onPlace) return <span key={index}>{sep}<Switcher label={part} places={places} current={place} /></span>;
                    if (last) return <span key={index}>{sep}<b aria-current="page" className="nb-crumb-name" title={part}>{part}</b></span>;
                    if (part === "workspaces" || part === "org") return <span key={index}>{sep}<span className="nb-crumb nb-crumb-quiet">{part}</span></span>;
                    const href = CRUMB_HREF[part];
                    return <span key={index}>{sep}{href ? <Link href={href} className="nb-crumb">{part}</Link> : <span className="nb-crumb nb-crumb-quiet">{part}</span>}</span>;
                })}
            </nav>
        </div>
    );
}

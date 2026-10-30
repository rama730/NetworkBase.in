"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { PanelLeftClose, PanelLeftOpen, ShieldCheck, UserRound } from "lucide-react";
import { BrandMark } from "@/components/brand/BrandMark";
import { Skeleton } from "@/components/ui/skeleton";
import { MAIN_NAV_ITEMS, SETTINGS_NAV_ITEM, isMainNavRouteActive } from "./header/nav-items";
import { ROUTES } from "@/constants/routes";
import { useAuth } from "@/hooks/use-auth";
import { useChatShell } from "@/components/messages/ChatShellProvider";
import { useNetworkNotifications } from "@/hooks/useNetworkNotifications";
import { useRealtime } from "@/components/providers/RealtimeProvider";
import MyWorkIndicator from "./header/MyWorkIndicator";
import { queryKeys } from "@/lib/query-keys";
import { useUIStore } from "@/stores/ui-store";
import { readSidebarWorkspacesAction } from "@/app/actions/org-workspace";
import { staffBadgeAction } from "@/app/actions/moderation-staff";
import { SidebarWorkspaces } from "./SidebarWorkspaces";

type SidebarProject = {
    id: string;
    title: string;
    href: string;
};

type SidebarProjectsEnvelope = {
    success?: boolean;
    data?: { projects?: SidebarProject[] };
    message?: string;
};

const SIDEBAR_COLLAPSED_STORAGE_KEY = "networkbase:sidebar-collapsed";
function readSidebarCollapsedPreference() {
    try {
        return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY);
    } catch {
        return null;
    }
}

function writeSidebarCollapsedPreference(collapsed: boolean) {
    try {
        window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(collapsed));
    } catch {
        // The sidebar remains usable when browser storage is unavailable.
    }
}

async function fetchSidebarProjects(profileId: string): Promise<SidebarProject[]> {
    const response = await fetch(`/api/v1/profiles/${encodeURIComponent(profileId)}/workspaces?limit=12`, {
        credentials: "include",
        headers: { accept: "application/json" },
    });
    const body = await response.json().catch(() => null) as SidebarProjectsEnvelope | null;
    if (!response.ok || body?.success === false) {
        throw new Error(body?.message || "Couldn’t load workspaces");
    }
    return (body?.data?.projects ?? []).filter((project) => project.id && project.title && project.href);
}

/**
 * Main navigation body shared by the desktop sidebar and the mobile quick-nav drawer
 * (Discover → Network → Messages → My profile → My work → Workspaces), so the two cannot drift.
 */
// ponytail: the drawer mounts this only while open, so its ids duplicate the (display:none) aside's only on mobile; use per-instance ids if that ever matters.
export function SidebarNav() {
    const pathname = usePathname();
    const { profile, isAuthenticated, user } = useAuth();
    const { badge: chatBadge } = useChatShell();
    // Staff only (trust and safety R11): the role is in the session, so nobody else asks the server.
    const isStaff = ["admin", "moderator"].includes(String(user?.app_metadata?.role ?? ""));
    const staffBadge = useQuery({ queryKey: ["trust", "sidebar-badge"], queryFn: () => staffBadgeAction(), enabled: isStaff, staleTime: 60_000, refetchInterval: 60_000 });
    const staffCount = staffBadge.data?.count ?? 0;
    const { connectionHealth } = useRealtime();
    const people = useNetworkNotifications();
    const profileId = profile?.id ?? null;
    const projectsQuery = useQuery({
        queryKey: queryKeys.profile.sidebarProjects(profileId ?? "unknown"),
        queryFn: () => fetchSidebarProjects(profileId!),
        enabled: Boolean(isAuthenticated && profileId),
        staleTime: 60_000,
        refetchOnWindowFocus: false,
    });
    const projects = projectsQuery.data ?? [];
    // Organizations (report §29.3): one request returns orgs, child projects, badges and Archived. Null while the
    // feature is off, so the plain project list stays.
    const workspacesQuery = useQuery({
        queryKey: ["sidebar-workspaces", profileId ?? "unknown"],
        queryFn: () => readSidebarWorkspacesAction(),
        enabled: Boolean(isAuthenticated && profileId),
        staleTime: 60_000,
        refetchOnWindowFocus: false,
    });
    const workspaces = workspacesQuery.data ?? null;

    return (
        <div className="nb-sidebar-scroll app-scroll app-scroll-y min-h-0 flex-1 space-y-3 pr-1">
            <nav id="application-sidebar-navigation" aria-label="Main navigation" className="space-y-1">
                {MAIN_NAV_ITEMS.map(({ href, label, icon: Icon }) => {
                    const active = isMainNavRouteActive(pathname, href);
                    const count = href === ROUTES.MESSAGES ? chatBadge : href === ROUTES.NETWORK ? people.totalPending : 0;
                    const countLabel = count > 0 ? `, ${count} ${href === ROUTES.MESSAGES ? "unread" : "pending"}` : "";
                    return <Link key={href} href={href} className="nb-nav-link" aria-label={`${label}${countLabel}`} title={label} aria-current={active ? "page" : undefined}>
                        <Icon size={16} aria-hidden="true" /><span className="nb-sidebar-label">{label}</span>
                        {href === ROUTES.NETWORK && connectionHealth !== "healthy" && <span className="sr-only">Connection {connectionHealth}</span>}
                        {count > 0 && <span className="nb-nav-count" aria-hidden="true">{count > 99 ? "99+" : count}</span>}
                    </Link>;
                })}
                <Link href={ROUTES.MY_PROFILE} className="nb-nav-link" aria-label="My profile" title="My profile" aria-current={isMainNavRouteActive(pathname, ROUTES.MY_PROFILE) ? "page" : undefined}><UserRound size={16} aria-hidden="true" /><span className="nb-sidebar-label">My profile</span></Link>
                {isAuthenticated && <MyWorkIndicator />}
                {isStaff && staffBadge.data ? (
                    <Link href="/admin/trust" className="nb-nav-link" aria-label={`Trust and safety${staffCount ? `, ${staffCount} urgent or overdue` : ""}`} title="Trust and safety" aria-current={pathname.startsWith("/admin/trust") ? "page" : undefined}>
                        <ShieldCheck size={16} aria-hidden="true" /><span className="nb-sidebar-label">Trust &amp; safety</span>
                        {staffCount > 0 && <span className="nb-nav-count" aria-hidden="true">{staffCount > 99 ? "99+" : staffCount}</span>}
                    </Link>
                ) : null}
            </nav>
            {isAuthenticated && <section className="nb-sidebar-workspace space-y-3" aria-labelledby="sidebar-workspace-heading">
                <div className="flex items-center gap-3 px-2">
                    <h2 id="sidebar-workspace-heading" className="nb-micro whitespace-nowrap">Workspaces</h2>
                    <div className="h-px min-w-0 flex-1 bg-border" aria-hidden="true" />
                </div>
                <div className="space-y-1" aria-label="Your workspaces" aria-busy={projectsQuery.isLoading}>
                    {projectsQuery.isLoading && <><span className="sr-only" role="status">Loading workspaces…</span>{[1, 2, 3].map((key) => <Skeleton key={key} className="mx-2 h-8 rounded" />)}</>}
                    {workspaces ? <SidebarWorkspaces data={workspaces} /> : projects.map((project) => {
                        const active = pathname === project.href || pathname?.startsWith(`${project.href}/`);
                        return <Link key={project.id} href={project.href} className="nb-nav-link" title={project.title} aria-current={active ? "page" : undefined}>
                            <span className="nb-sidebar-label truncate">{project.title}</span>
                        </Link>;
                    })}
                    {!workspaces && !projectsQuery.isLoading && !projectsQuery.isError && projects.length === 0 && <p className="px-2 py-1 text-xs text-muted-foreground">No workspaces yet</p>}
                    {projectsQuery.isError && !workspaces && <p className="px-2 py-1 text-xs text-muted-foreground">Workspaces unavailable</p>}
                </div>
            </section>}
        </div>
    );
}

export function AppSidebar() {
    const pathname = usePathname();
    const settingsActive = isMainNavRouteActive(pathname, SETTINGS_NAV_ITEM.href);
    const collapsed = useUIStore((state) => state.sidebarCollapsed);
    const setSidebarCollapsed = useUIStore((state) => state.setSidebarCollapsed);
    const [preferenceReady, setPreferenceReady] = useState(false);

    useEffect(() => {
        const stored = readSidebarCollapsedPreference();
        const defaultCollapsed = window.matchMedia("(min-width: 768px) and (max-width: 1023px)").matches;
        setSidebarCollapsed(stored === "true" ? true : stored === "false" ? false : defaultCollapsed);
        setPreferenceReady(true);

        const syncPreference = (event: StorageEvent) => {
            if (event.key !== SIDEBAR_COLLAPSED_STORAGE_KEY) return;
            setSidebarCollapsed(event.newValue === "true");
        };
        window.addEventListener("storage", syncPreference);
        return () => window.removeEventListener("storage", syncPreference);
    }, [setSidebarCollapsed]);

    const toggleCollapsed = () => {
        const next = !collapsed;
        setSidebarCollapsed(next);
        writeSidebarCollapsedPreference(next);
        setPreferenceReady(true);
    };

    return (
        <aside
            className="nb-sidebar"
            id="application-sidebar"
            aria-label="Application sidebar"
            data-collapsed={preferenceReady ? String(collapsed) : undefined}
        >
            <div className="nb-sidebar-brand">
                <Link
                    href={ROUTES.DISCOVER}
                   
                    className="nb-wordmark nb-sidebar-wordmark"
                    aria-label="NetworkBase home"
                >
                    {collapsed ? <BrandMark variant="dot" size={19} label="NetworkBase" /> : <BrandMark size={19} />}
                </Link>
            </div>
            <div className="nb-sidebar-body">
                <SidebarNav />
                <div id="navigation-feedback-slot" />
                <nav
                    aria-label="Settings and sidebar controls"
                    className="nb-sidebar-footer"
                    data-layout={preferenceReady ? (collapsed ? "stacked" : "inline") : undefined}
                >
                    <Link href={SETTINGS_NAV_ITEM.href} className="nb-nav-link" aria-label={SETTINGS_NAV_ITEM.label} title={SETTINGS_NAV_ITEM.label} aria-current={settingsActive ? "page" : undefined}>
                        <SETTINGS_NAV_ITEM.icon size={16} aria-hidden="true" /><span className="nb-sidebar-label">{SETTINGS_NAV_ITEM.label}</span>
                    </Link>
                    <button
                        type="button"
                        className="nb-nav-link nb-sidebar-toggle"
                        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                        aria-controls="application-sidebar-navigation"
                        aria-expanded={!collapsed}
                        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                        onClick={toggleCollapsed}
                    >
                        {collapsed ? <PanelLeftOpen size={16} aria-hidden="true" /> : <PanelLeftClose size={16} aria-hidden="true" />}
                    </button>
                </nav>
            </div>
        </aside>
    );
}

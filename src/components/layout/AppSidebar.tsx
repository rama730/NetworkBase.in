"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { LayoutGrid, PanelLeftClose, PanelLeftOpen, ShieldCheck, UserRound } from "@/components/ui/icons";
import * as Popover from "@radix-ui/react-popover";
import { MAIN_NAV_ITEMS, SETTINGS_NAV_ITEM, isMainNavRouteActive } from "./header/nav-items";
import { ROUTES } from "@/constants/routes";
import { useAuth } from "@/hooks/use-auth";
import { useChatShell } from "@/components/messages/ChatShellProvider";
import { useNetworkNotifications } from "@/hooks/useNetworkNotifications";
import { useRealtime } from "@/components/providers/RealtimeProvider";
import MyWorkIndicator from "./header/MyWorkIndicator";
import { queryKeys } from "@/lib/query-keys";
import { useUIStore } from "@/stores/ui-store";
import { readShellPart } from "@/lib/shell-batch";
import { SidebarEmpty, SidebarWorkspaces, placeForPath, sidebarRowCount } from "./SidebarWorkspaces";
import { SidebarLogo } from "./SidebarLogo";
import { coverThumbUrl } from "@/lib/workspaces/cover-thumb";
import { useChanged } from "@/hooks/useChanged";

/** A nav count. Unread messages and staff urgents are the orange chip; a count that changes settles in once. */
export function NavCount({ value, hot = false, className = "", ...rest }: { value: number; hot?: boolean; className?: string } & React.HTMLAttributes<HTMLSpanElement>) {
    const changed = useChanged(value);
    return <span key={value} data-settle={changed || undefined} className={`nb-nav-count${hot ? " nb-nav-count--hot" : ""}${className ? ` ${className}` : ""}`} {...rest}>{value > 99 ? "99+" : value}</span>;
}

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
 * The sidebar's Workspaces in one request (report §29.3). The top bar reads the same cache for the page's picture and
 * the quick switcher, so this is the one place its options live.
 */
export function useSidebarWorkspacesQuery() {
    const { profile, isAuthenticated, user } = useAuth();
    const profileId = profile?.id ?? user?.id ?? null;
    return useQuery({
        queryKey: queryKeys.profile.sidebarWorkspaces(profileId ?? "unknown"),
        queryFn: async () => (await readShellPart("sidebarWorkspaces")) ?? null,
        enabled: Boolean(isAuthenticated && profileId),
        staleTime: 15_000,
        refetchOnWindowFocus: true,
        refetchInterval: 120_000,
        refetchIntervalInBackground: false,
    });
}

/**
 * Keyboard in the sidebar (shell redesign): ↑ ↓ move between rows; ← closes an organization, or from one of its
 * workspaces goes up to it; → opens it, or from an open one goes down into its first workspace.
 */
function moveThroughSidebar(event: ReactKeyboardEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    if (!["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(event.key) || target.closest("input, textarea, select, [contenteditable='true'], [role='menu']")) return;
    const rows = [...event.currentTarget.querySelectorAll<HTMLElement>(":is(a, button).nb-nav-link, [data-ws-row] > a, .nb-tree-more")].filter((el) => el.offsetParent !== null);
    const index = rows.indexOf(target);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (index < 0) return;
        event.preventDefault();
        rows[Math.max(0, Math.min(rows.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))]?.focus();
        return;
    }
    const group = target.closest<HTMLElement>("[data-org-group]");
    if (!group) return;
    const head = group.querySelector<HTMLElement>("[data-org-row] > a"), toggle = group.querySelector<HTMLButtonElement>("[data-org-row] button[aria-controls]");
    const open = toggle?.getAttribute("aria-expanded") === "true", onHead = target === head;
    event.preventDefault();
    if (event.key === "ArrowLeft") { if (!onHead) head?.focus(); else if (open) toggle?.click(); }
    else if (!open) toggle?.click();
    else if (onHead) group.querySelector<HTMLElement>(".nb-tree-kids [data-ws-row] > a")?.focus();
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
    const staffBadge = useQuery({ queryKey: ["trust", "sidebar-badge"], queryFn: async () => (await readShellPart("staffBadge")) ?? null, enabled: isStaff, staleTime: 60_000, refetchInterval: 5 * 60_000 });
    const staffCount = staffBadge.data?.count ?? 0;
    const { connectionHealth } = useRealtime();
    const people = useNetworkNotifications();
    // The profile id is the user id; keying on the user means the lists start loading before the profile arrives.
    const profileId = profile?.id ?? user?.id ?? null;
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
    // Sidebar report G1: the list follows what you do — on focus, every 2 minutes while visible, after the actions that
    // change it (they invalidate "sidebar-workspaces"), and on navigating once it's 15 seconds old.
    const workspacesQuery = useSidebarWorkspacesQuery();
    const workspaces = workspacesQuery.data ?? null;
    const { refetch: refetchWorkspaces, dataUpdatedAt: workspacesAt } = workspacesQuery;
    useEffect(() => {
        if (workspacesAt && Date.now() - workspacesAt > 15_000) void refetchWorkspaces();
    }, [pathname]);
    // Parity bug 10: one placeholder until both lists arrive, so "No workspaces yet" and a second order never flash.
    // Pending, not loading: a query waiting to start counts too (problem 2).
    const loadingWorkspaces = projectsQuery.isPending || workspacesQuery.isPending;
    const workspaceCount = workspaces ? sidebarRowCount(workspaces) : projectsQuery.isSuccess ? projects.length : null;
    // Collapsed: the Workspaces button shows the picture of the workspace you're in, when it has one.
    const current = useMemo(() => placeForPath(workspaces, pathname), [workspaces, pathname]);

    return (
        <div className="nb-sidebar-scroll app-scroll app-scroll-y min-h-0 flex-1 space-y-3 pr-1" onKeyDown={moveThroughSidebar}>
            <nav id="application-sidebar-navigation" aria-label="Main navigation" className="space-y-1">
                {MAIN_NAV_ITEMS.map(({ href, label, icon: Icon }) => {
                    const active = isMainNavRouteActive(pathname, href);
                    const count = href === ROUTES.MESSAGES ? chatBadge : href === ROUTES.NETWORK ? people.totalPending : 0;
                    const countLabel = count > 0 ? `, ${count} ${href === ROUTES.MESSAGES ? "unread" : "pending"}` : "";
                    return <Link key={href} href={href} className="nb-nav-link" aria-label={`${label}${countLabel}`} title={label} data-tip={label} aria-current={active ? "page" : undefined}>
                        <Icon size={16} aria-hidden="true" /><span className="nb-sidebar-label">{label}</span>
                        {href === ROUTES.NETWORK && connectionHealth !== "healthy" && <span className="sr-only">Connection {connectionHealth}</span>}
                        {/* Unread messages are the orange chip; a new one settles in once (the key remounts it). */}
                        {count > 0 && <NavCount value={count} hot={href === ROUTES.MESSAGES} aria-hidden="true" />}
                    </Link>;
                })}
                <Link href={ROUTES.MY_PROFILE} className="nb-nav-link" aria-label="My profile" title="My profile" data-tip="My profile" aria-current={isMainNavRouteActive(pathname, ROUTES.MY_PROFILE) ? "page" : undefined}><UserRound size={16} aria-hidden="true" /><span className="nb-sidebar-label">My profile</span></Link>
                {isAuthenticated && <MyWorkIndicator />}
                {isStaff ? (
                    <Link href="/admin/trust" className="nb-nav-link" aria-label={`Trust and safety${staffCount ? `, ${staffCount} urgent or overdue` : ""}`} title="Trust and safety" data-tip="Trust and safety" aria-current={pathname.startsWith("/admin/trust") ? "page" : undefined}>
                        <ShieldCheck size={16} aria-hidden="true" /><span className="nb-sidebar-label">Trust and safety</span>
                        {staffCount > 0 && <NavCount value={staffCount} hot aria-hidden="true" />}
                    </Link>
                ) : null}
            </nav>
            {/* Sidebar report D1, G7: the collapsed strip hides the list and keeps one Workspaces button that opens it. */}
            {isAuthenticated && workspaces ? (
                <Popover.Root>
                    <Popover.Trigger asChild>
                        <button type="button" className="nb-nav-link nb-sidebar-workspaces-rail" aria-label="Workspaces" title="Workspaces" data-tip="Workspaces">
                            {current?.coverImage ? <img className="nb-ws-pic" src={coverThumbUrl(current.coverImage, 64)} alt="" /> : <LayoutGrid size={16} aria-hidden="true" />}
                        </button>
                    </Popover.Trigger>
                    <Popover.Portal>
                        <Popover.Content side="right" align="start" sideOffset={8} aria-label="Workspaces"
                            className="z-50 max-h-[70vh] w-72 overflow-y-auto rounded-lg border border-border bg-popover p-2 text-popover-foreground shadow-lg" data-testid="sidebar-workspaces-panel">
                            <h2 className="nb-micro px-2 pb-2">Workspaces</h2>
                            <SidebarWorkspaces data={workspaces} />
                        </Popover.Content>
                    </Popover.Portal>
                </Popover.Root>
            ) : null}
            {isAuthenticated && <section className="nb-sidebar-workspace space-y-3" aria-labelledby="sidebar-workspace-heading">
                <div className="flex items-center gap-3 px-2">
                    <h2 id="sidebar-workspace-heading" className="nb-micro whitespace-nowrap">Workspaces</h2>
                    <div className="h-px min-w-0 flex-1 bg-border" aria-hidden="true" />
                    {/* The marketing nav's section counter: how many rows the list holds. */}
                    {workspaceCount !== null ? <span className="nb-sidebar-counter" aria-hidden="true">{String(workspaceCount).padStart(2, "0")}</span> : null}
                </div>
                <div className="space-y-1" aria-label="Your workspaces" aria-busy={loadingWorkspaces}>
                    {/* Loading: the onboarding card's dashed ghost lines, not grey bars. */}
                    {loadingWorkspaces && !workspaces && <><span className="sr-only" role="status">Loading workspaces…</span>{[132, 96, 118].map((width) => <div key={width} className="nb-ghost-row" aria-hidden="true"><span className="nb-ghost" style={{ width }} /></div>)}</>}
                    {workspaces ? <SidebarWorkspaces data={workspaces} /> : loadingWorkspaces ? null : projects.map((project) => {
                        const active = pathname === project.href || pathname?.startsWith(`${project.href}/`);
                        return <Link key={project.id} href={project.href} className="nb-nav-link" title={project.title} aria-current={active ? "page" : undefined}>
                            <span className="nb-sidebar-label truncate">{project.title}</span>
                        </Link>;
                    })}
                    {!workspaces && !loadingWorkspaces && !projectsQuery.isError && projects.length === 0 && <SidebarEmpty />}
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
        setTip(null);
    };
    // `[` collapses or expands the sidebar from anywhere (not while typing, not with a modifier).
    const toggleRef = useRef(toggleCollapsed);
    toggleRef.current = toggleCollapsed;
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            const target = event.target as HTMLElement | null;
            if (event.key !== "[" || event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
            if (target?.closest("input, textarea, select, [contenteditable='true'], [contenteditable=''], [role='textbox'], [role='dialog'], [role='menu']")) return;
            event.preventDefault();
            toggleRef.current();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, []);
    // Collapsed: hovering or focusing an icon shows its name as a small mono label beside the strip.
    const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);
    const showTip = (event: { target: EventTarget }) => {
        const row = (event.target as HTMLElement).closest<HTMLElement>("[data-tip]");
        if (!collapsed || !row) { setTip(null); return; }
        const box = row.getBoundingClientRect();
        setTip({ text: row.dataset.tip ?? "", x: box.right + 10, y: box.top + box.height / 2 });
    };

    return (
        <aside
            className="nb-sidebar"
            id="application-sidebar"
            aria-label="Application sidebar"
            data-collapsed={preferenceReady ? String(collapsed) : undefined}
            onMouseOver={showTip}
            onFocus={showTip}
            onMouseLeave={() => setTip(null)}
            onBlur={() => setTip(null)}
        >
            {/* The logo cell shares one hairline with the top bar, and the logo plays like the home page wordmark. */}
            <div className="nb-sidebar-brand">
                <SidebarLogo collapsed={collapsed} />
            </div>
            <div className="nb-sidebar-body">
                <SidebarNav />
                <div id="navigation-feedback-slot" />
                <nav
                    aria-label="Settings and sidebar controls"
                    className="nb-sidebar-footer"
                    data-layout={preferenceReady ? (collapsed ? "stacked" : "inline") : undefined}
                >
                    <Link href={SETTINGS_NAV_ITEM.href} className="nb-nav-link" aria-label={SETTINGS_NAV_ITEM.label} title={SETTINGS_NAV_ITEM.label} data-tip={SETTINGS_NAV_ITEM.label} aria-current={settingsActive ? "page" : undefined}>
                        <SETTINGS_NAV_ITEM.icon size={16} aria-hidden="true" /><span className="nb-sidebar-label">{SETTINGS_NAV_ITEM.label}</span>
                    </Link>
                    <button
                        type="button"
                        className="nb-nav-link nb-sidebar-toggle"
                        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                        aria-controls="application-sidebar-navigation"
                        aria-expanded={!collapsed}
                        title={`${collapsed ? "Expand sidebar" : "Collapse sidebar"}  [`}
                        data-tip={`${collapsed ? "Expand sidebar" : "Collapse sidebar"}  [`}
                        aria-keyshortcuts="["
                        onClick={toggleCollapsed}
                    >
                        {collapsed ? <PanelLeftOpen size={16} aria-hidden="true" /> : <PanelLeftClose size={16} aria-hidden="true" />}
                    </button>
                </nav>
            </div>
            {tip ? <span className="nb-sidebar-tip" role="tooltip" style={{ left: tip.x, top: tip.y }}>{tip.text}</span> : null}
        </aside>
    );
}

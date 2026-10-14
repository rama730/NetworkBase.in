"use client";

import { useState, useEffect, useMemo, useRef, type CSSProperties, type KeyboardEvent } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "@/lib/utils/date";
import {
    LayoutDashboard, ListTodo, FolderOpen, BookOpenText,
    Settings, Share2, UserPlus, UserCheck, IterationCcw, Loader2, Newspaper, Camera, MoreHorizontal
} from "lucide-react";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { Project } from "@/types/discover";
import ProjectStatsBar from "@/components/projects/ProjectStatsBar";
import ProjectAvatar, { getProjectAvatarUrl } from "@/components/projects/ProjectAvatar";
import { ProjectPresenceDot } from "@/components/projects/ProjectAvatar";
import { ProjectStatusControl } from "@/components/presence/ProjectStatusControl";
import { ProjectLinkCluster } from "@/components/projects/dashboard/ProjectSocialLinksCard";
import ProjectTeamAvatars, { type ProjectHeaderMember } from "@/components/projects/dashboard/ProjectTeamAvatars";
import {
    isProjectTabVisibleToViewer,
    normalizeProjectPublicTabVisibility,
    type ProjectPublicTabVisibility,
} from "@/lib/projects/settings-policies";

interface ProjectLayoutProps {
    children: React.ReactNode;
    project: Project;
    isOwner: boolean;
    isOwnerOrMember?: boolean;
    canManageSettings?: boolean;
    publicTabVisibility?: ProjectPublicTabVisibility | null;
    activeTab: string;
    onTabChange: (tabId: string) => void;
    followersCount?: number;
    viewCount?: number;
    filesSyncBadge?: {
        status: "idle" | "syncing" | "incoming" | "completed" | "failed";
        count?: number;
        tooltip?: string;
    } | null;

    isFollowing?: boolean;
    onFollow?: () => void;
    followLoading?: boolean;
    onShare?: (trigger?: HTMLElement) => void;
    onInvite?: () => void;
    canInvite?: boolean;
    onTabHover?: (tabId: string) => void;
    members?: ProjectHeaderMember[];
    loadingMembers?: boolean;
    /** Current lifecycle stage for the mobile header chip (spec §19: title and stage). */
    stageLabel?: string | null;
    stageIndex?: number;
    stageCount?: number;
    /** Roles with open spots; visitors get a mobile shortcut to the Open roles card. */
    openRolesCount?: number;
}

const TABS = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "readme", label: "Docs", icon: BookOpenText },
    { id: "updates", label: "Updates", icon: Newspaper },
    { id: "sprints", label: "Sprints", icon: IterationCcw },
    { id: "tasks", label: "Tasks", icon: ListTodo },
    { id: "files", label: "Files", icon: FolderOpen },
    { id: "settings", label: "Settings", icon: Settings, ownerOnly: true },
];

const RECENT_PROJECT_UPDATE_MS = 7 * 24 * 60 * 60 * 1000;

export function formatProjectUpdatedLabel(value?: string | Date | null, now = new Date()) {
    if (!value) return null;
    const updatedAt = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(updatedAt.getTime())) return null;
    if (Math.abs(now.getTime() - updatedAt.getTime()) < RECENT_PROJECT_UPDATE_MS) {
        return `Updated ${formatDistanceToNow(updatedAt, { addSuffix: true })}`;
    }
    return `Updated ${new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
    }).format(updatedAt)}`;
}

export default function ProjectLayout({
    children, project, isOwner, activeTab, onTabChange,
    isOwnerOrMember,
    canManageSettings,
    publicTabVisibility,
    followersCount,
    viewCount,
    filesSyncBadge,

    isFollowing, onFollow, followLoading, onShare, onInvite, canInvite = false,
    onTabHover,
    members,
    loadingMembers,
    stageLabel,
    stageIndex = 0,
    stageCount = 0,
    openRolesCount = 0,
}: ProjectLayoutProps) {
    const [isScrolled, setIsScrolled] = useState(false);
    const [summaryExpanded, setSummaryExpanded] = useState(false);
    const [projectTabsHeight, setProjectTabsHeight] = useState(0);
    const [projectIdentityHeight, setProjectIdentityHeight] = useState(320);
    const tabsRef = useRef<HTMLDivElement>(null);
    const actionsTrigger = useRef<HTMLButtonElement>(null);
    const tabListRef = useRef<HTMLDivElement>(null);
    const projectIdentityRef = useRef<HTMLDivElement>(null);

    const isFilesTab = activeTab === "files";
    const isSettingsTab = activeTab === "settings";
    const isUpdatesTab = activeTab === "updates";
    const isTasksTab = activeTab === "tasks";
    // Tool tabs compact the project context below md so the work surface gets the height (spec §08/§19).
    const isToolTab = isFilesTab || isTasksTab || activeTab === "sprints";

    // Normal project tabs, including Files, use the route scroll root so the
    // identity header moves naturally and the project tabs remain sticky.
    useEffect(() => {
        const routeRoot = document.querySelector<HTMLElement>('[data-scroll-root="route"]');
        const scrollTarget: HTMLElement | Window = routeRoot ?? window;
        let rafId = 0;

        const scheduleScrollState = () => {
            if (rafId) return;

            rafId = requestAnimationFrame(() => {
                const scrollY = routeRoot ? routeRoot.scrollTop : window.scrollY;
                const shouldBeScrolled = scrollY > 10;
                setIsScrolled((prev) => (prev === shouldBeScrolled ? prev : shouldBeScrolled));
                rafId = 0;
            });
        };

        scrollTarget.addEventListener("scroll", scheduleScrollState as EventListener, { passive: true });
        scheduleScrollState();

        return () => {
            scrollTarget.removeEventListener("scroll", scheduleScrollState as EventListener);
            if (rafId) cancelAnimationFrame(rafId);
        };
    }, []);

    useEffect(() => {
        const identity = projectIdentityRef.current;
        if (!identity) return;

        const updateIdentityHeight = () => {
            const nextHeight = Math.ceil(identity.offsetHeight);
            if (nextHeight > 0) {
                setProjectIdentityHeight((current) => (current === nextHeight ? current : nextHeight));
            }
        };

        updateIdentityHeight();
        const observer = typeof ResizeObserver !== "undefined"
            ? new ResizeObserver(updateIdentityHeight)
            : null;
        observer?.observe(identity);
        window.addEventListener("resize", updateIdentityHeight, { passive: true });

        return () => {
            observer?.disconnect();
            window.removeEventListener("resize", updateIdentityHeight);
        };
    }, [project.id]);

    useEffect(() => {
        const updateProjectLayoutMetrics = (entries?: ResizeObserverEntry[]) => {
            let nextTabsHeight = 0;
            if (entries && entries[0]?.contentRect) {
                nextTabsHeight = Math.ceil(entries[0].contentRect.height);
            } else if (tabsRef.current) {
                nextTabsHeight = Math.ceil(tabsRef.current.offsetHeight);
            }
            setProjectTabsHeight((current) => (current === nextTabsHeight ? current : nextTabsHeight));
        };

        updateProjectLayoutMetrics();
        const observer =
            typeof ResizeObserver !== "undefined"
                ? new ResizeObserver((entries) => updateProjectLayoutMetrics(entries))
                : null;
        if (tabsRef.current) observer?.observe(tabsRef.current);
        const handleResize = () => updateProjectLayoutMetrics();
        window.addEventListener("resize", handleResize, { passive: true });

        return () => {
            observer?.disconnect();
            window.removeEventListener("resize", handleResize);
        };
    }, [activeTab]);

    const normalizedPublicTabs = useMemo(
        () => normalizeProjectPublicTabVisibility(publicTabVisibility ?? project.publicTabVisibility),
        [project.publicTabVisibility, publicTabVisibility],
    );
    const canSeeMemberTabs = isOwnerOrMember ?? isOwner;
    const visibleTabs = useMemo(
        () => TABS.filter((tab) => {
            if (tab.ownerOnly && !(canManageSettings ?? isOwner)) return false;
            return isProjectTabVisibleToViewer({
                tabId: tab.id,
                isOwnerOrMember: canSeeMemberTabs,
                canManageSettings: canManageSettings ?? isOwner,
                publicTabVisibility: normalizedPublicTabs,
            });
        }),
        [canManageSettings, canSeeMemberTabs, isOwner, normalizedPublicTabs],
    );
    useEffect(() => {
        const tabList = tabListRef.current;
        const activeTabButton = tabsRef.current?.querySelector<HTMLButtonElement>(
            `[data-testid="project-tab-${activeTab}"]`,
        );
        if (!tabList || !activeTabButton || tabList.scrollWidth <= tabList.clientWidth) return;

        const tabLeft = activeTabButton.offsetLeft;
        const tabRight = tabLeft + activeTabButton.offsetWidth;
        const viewportLeft = tabList.scrollLeft;
        const viewportRight = viewportLeft + tabList.clientWidth;
        if (tabLeft >= viewportLeft && tabRight <= viewportRight) return;

        const centeredLeft = tabLeft - (tabList.clientWidth - activeTabButton.offsetWidth) / 2;
        tabList.scrollTo({ left: Math.max(0, centeredLeft), behavior: "smooth" });
    }, [activeTab, visibleTabs]);
    const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
        let nextIndex: number | null = null;
        if (event.key === "ArrowRight") nextIndex = (index + 1) % visibleTabs.length;
        if (event.key === "ArrowLeft") nextIndex = (index - 1 + visibleTabs.length) % visibleTabs.length;
        if (event.key === "Home") nextIndex = 0;
        if (event.key === "End") nextIndex = visibleTabs.length - 1;
        if (nextIndex === null) return;
        event.preventDefault();
        const nextTab = visibleTabs[nextIndex];
        if (!nextTab) return;
        tabsRef.current?.querySelector<HTMLButtonElement>(`[data-testid="project-tab-${nextTab.id}"]`)?.focus();
    };
    const projectUpdatedLabel = formatProjectUpdatedLabel(project.updatedAt);
    const layoutStyle = useMemo(() => ({
        "--project-tabs-height": `${projectTabsHeight}px`,
    } as CSSProperties), [projectTabsHeight]);

    return (
        <div className={cn(
            "bg-background",
            "min-h-full"
        )}
            data-project-tool={isFilesTab || isTasksTab || activeTab === "sprints" ? "true" : undefined}
            data-project-identity-height={projectIdentityHeight}
            style={layoutStyle}
        >
            {/* Top Row: Context & Actions (NOT sticky; scrolls away) */}
            <div className="shrink-0 bg-card">
                <div className="w-full">
                    <div ref={projectIdentityRef} className={cn("nb-project-identity flex flex-wrap items-start justify-between gap-4 px-4 pb-4 pt-5 sm:px-6 max-md:gap-3 max-md:pt-4", isToolTab && "max-md:hidden")}>
                        {/* Left: Project Identity */}
                        {(() => {
                            const hasProjectAvatar = Boolean(getProjectAvatarUrl(project));
                            const canManageProjectLinks = canManageSettings ?? isOwner;
                            const hasProjectLinks = Boolean(
                                canManageProjectLinks ||
                                project.githubRepoUrl ||
                                (project as any).github_repo_url ||
                                project.importSource ||
                                (project as any).import_source ||
                                project.githubSyncConnection ||
                                (project as any).github_sync_connection ||
                                (Array.isArray(project.externalLinks) && project.externalLinks.length > 0) ||
                                (Array.isArray((project as any).external_links) && (project as any).external_links.length > 0)
                            );

                            const projectIdentityMetadata = (
                                <div className="flex min-h-[34px] flex-wrap items-center gap-x-2 gap-y-1.5">
                                    <ProjectTeamAvatars project={project} members={members} loading={loadingMembers} />
                                    {hasProjectLinks && (
                                        <>
                                            <div className="mx-0.5 h-4 w-px bg-border shrink-0" aria-hidden="true" />
                                            <ProjectLinkCluster
                                                projectId={project.id}
                                                links={project.externalLinks ?? (project as any).external_links}
                                                githubRepoUrl={project.githubRepoUrl ?? (project as any).github_repo_url}
                                                importSource={project.importSource ?? (project as any).import_source}
                                                githubSyncConnection={project.githubSyncConnection ?? (project as any).github_sync_connection}
                                                health={project.externalLinkMetadata ?? (project as any).external_link_metadata}
                                                projectType={project.category}
                                                canManage={canManageProjectLinks}
                                            />
                                        </>
                                    )}
                                </div>
                            );

                            const stageChip = stageLabel ? (
                                <span className="nb-status" data-status="active">
                                    {stageLabel}{stageCount > 1 ? ` · ${stageIndex + 1} of ${stageCount}` : ""}
                                </span>
                            ) : null;
                            // ponytail: length heuristic decides whether the 3-line clamp needs a toggle; measure overflow if it misfires.
                            const summaryToggle = project.shortDescription && project.shortDescription.length > 120 ? (
                                <button
                                    type="button"
                                    onClick={() => setSummaryExpanded((value) => !value)}
                                    aria-expanded={summaryExpanded}
                                    className="nb-touch-target nb-ui-label -mt-1 inline-flex items-center text-primary md:hidden"
                                >
                                    {summaryExpanded ? "Less" : "More"}
                                </button>
                            ) : null;

                            const hasCustomAvatar = Boolean(getProjectAvatarUrl(project));

                            return (
                                <div className="flex min-w-0 flex-1 flex-col items-start gap-2 max-md:basis-full">
                                    <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground">
                                        <Link href="/projects" className="hover:text-foreground transition-colors">
                                            Projects
                                        </Link>
                                        <span className="mx-1.5 text-muted-foreground/60" aria-hidden="true">/</span>
                                        <span className="text-foreground font-medium truncate max-w-[200px] inline-block align-bottom">
                                            {project?.title}
                                        </span>
                                    </nav>
                                    <div className="flex min-w-0 items-start gap-4 sm:gap-5 max-md:gap-3">
                                        <div className="relative shrink-0">
                                            <ProjectAvatar
                                                project={project}
                                                size="detail"
                                                isOwner={isOwner}
                                                slugOrId={project.slug || project.id}
                                                className="max-md:size-12 max-md:rounded-[8px]"
                                            />
                                            <ProjectPresenceDot
                                                lastActiveAt={project.updatedAt}
                                                projectId={project.id || project.slug}
                                                className="absolute -bottom-0.5 -right-0.5"
                                            />
                                        </div>
                                        <div className="min-w-0 pt-0.5 sm:pt-1 max-md:space-y-1.5">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <h1 className="nb-page-title min-w-0 break-words text-foreground">
                                                    {project?.title}
                                                </h1>
                                                {stageChip}
                                                {/* General (images) is owner-only; admins would land on a section they cannot open. */}
                                                {!hasCustomAvatar && isOwner && (project?.slug || project?.id) && (
                                                    <Link
                                                        href={`/projects/${project.slug || project.id}?tab=settings#project-settings-general`}
                                                        className="nb-touch-target group/add-avatar inline-flex items-center justify-center gap-1.5 rounded-full border border-dashed border-border/80 px-2.5 py-0.5 text-xs text-muted-foreground transition-[color,border-color,background-color] duration-150 hover:border-foreground/40 hover:bg-muted/40 hover:text-foreground"
                                                        title="Add project avatar"
                                                        aria-label="Add project avatar"
                                                    >
                                                        <Camera className="size-3 text-muted-foreground group-hover/add-avatar:text-foreground" aria-hidden="true" />
                                                        <span className="hidden sm:inline">Add avatar</span>
                                                    </Link>
                                                )}
                                            </div>
                                            {project?.id ? <ProjectStatusControl projectId={project.id} canManage={Boolean(canManageSettings ?? isOwner)} /> : null}
                                            {project.shortDescription && (
                                                <p className={cn("nb-body mt-1 max-w-[64ch] text-muted-foreground", !summaryExpanded && "max-md:line-clamp-3")}>
                                                    {project.shortDescription}
                                                </p>
                                            )}
                                            {summaryToggle}
                                        </div>
                                    </div>
                                    {projectIdentityMetadata}
                                </div>
                            );
                        })()}

                        {/* Right: Actions */}
                        <div className="flex flex-wrap items-center justify-end gap-2 sm:pt-1 max-md:basis-full max-md:justify-start">
                            <ProjectStatsBar
                                viewCount={viewCount ?? (project as any)?.viewCount ?? 0}
                                followersCount={followersCount ?? (project as any)?.followersCount ?? 0}
                                className="max-md:basis-full"
                            />

                            {canInvite && onInvite ? (
                                <button
                                    type="button"
                                    onClick={onInvite}
                                    className="nb-touch-target nb-ui-label inline-flex h-[var(--ui-control-height)] items-center gap-1.5 rounded-md border border-border bg-card px-3 text-foreground transition-colors duration-[180ms] ease-[cubic-bezier(.2,.8,.3,1)] hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                    aria-label="Invite a project member"
                                    title="Invite a project member"
                                >
                                    <UserPlus className="size-4" aria-hidden="true" />
                                    <span>Invite</span>
                                </button>
                            ) : null}
                            
                            {/* Follow */}
                            <button
                                type="button"
                                onClick={onFollow}
                                className={cn(
                                    "nb-touch-target nb-ui-label flex h-[var(--ui-control-height)] items-center gap-1.5 rounded-md px-3 transition-colors duration-[180ms] ease-[cubic-bezier(.2,.8,.3,1)] disabled:cursor-not-allowed disabled:opacity-60",
                                    isFollowing
                                        ? "text-primary bg-primary/10"
                                        : "border border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
                                )}
                                title={isFollowing ? "Unfollow project" : "Follow project"}
                                aria-label={isFollowing ? "Unfollow project" : "Follow project"}
                                data-testid="project-follow-toggle"
                                disabled={followLoading}
                                aria-busy={followLoading}
                            >
                                {followLoading ? (
                                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                                ) : (
                                    isFollowing ? <UserCheck className="size-4" aria-hidden="true" /> : <UserPlus className="size-4" aria-hidden="true" />
                                )}
                                <span className="inline-block">{isFollowing ? "Following" : "Follow"}</span>
                            </button>

                            <div className="mx-1 h-4 w-px bg-border max-md:hidden" />

                            {/* Share */}
                            <button
                                type="button"
                                onClick={event => onShare?.(event.currentTarget)}
                                className="nb-icon-button h-[var(--ui-control-height)] w-[var(--ui-control-height)] rounded-[5px] border border-border bg-card text-muted-foreground transition-colors duration-[180ms] ease-[cubic-bezier(.2,.8,.3,1)] hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                title="Share project"
                                aria-label="Share project"
                            >
                                <Share2 className="size-4" aria-hidden="true" />
                            </button>

                            {!(isOwnerOrMember ?? isOwner) && openRolesCount > 0 && activeTab === "dashboard" ? (
                                <a href="#open-roles" className="nb-touch-target nb-ui-label inline-flex items-center px-1 text-primary md:hidden">
                                    {openRolesCount} open {openRolesCount === 1 ? "role" : "roles"} ›
                                </a>
                            ) : null}
                        </div>
                    </div>

                    {isToolTab ? (
                        <div className="flex h-12 items-center gap-2 px-4 md:hidden">
                            <ProjectAvatar project={project} className="size-6 rounded-[5px]" />
                            <h1 className="nb-ui-label min-w-0 flex-1 truncate text-[15px] font-semibold text-foreground" title={project?.title}>
                                {project?.title}
                            </h1>
                            {stageLabel ? <span className="nb-status shrink-0" data-status="active">{stageLabel}</span> : null}
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <button ref={actionsTrigger} type="button" aria-label="Project actions" className="nb-icon-button nb-touch-target shrink-0">
                                        <MoreHorizontal className="size-4" aria-hidden="true" />
                                    </button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-48">
                                    <DropdownMenuItem onSelect={() => onFollow?.()} disabled={followLoading}>
                                        {isFollowing ? <UserCheck className="size-4" aria-hidden="true" /> : <UserPlus className="size-4" aria-hidden="true" />}
                                        {isFollowing ? "Unfollow project" : "Follow project"}
                                    </DropdownMenuItem>
                                    {canInvite && onInvite ? (
                                        <DropdownMenuItem onSelect={onInvite}>
                                            <UserPlus className="size-4" aria-hidden="true" />
                                            Invite a member
                                        </DropdownMenuItem>
                                    ) : null}
                                    <DropdownMenuItem onSelect={() => onShare?.(actionsTrigger.current ?? undefined)}>
                                        <Share2 className="size-4" aria-hidden="true" />
                                        Share project
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onSelect={() => onTabChange("dashboard")}>
                                        <LayoutDashboard className="size-4" aria-hidden="true" />
                                        Project overview
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>
                    ) : null}
                </div>
            </div>

            {/* Bottom Row: Navigation Tabs (sticky) */}
            <div ref={tabsRef} className={cn(
                "z-30 shrink-0 border-b border-border bg-card transition-shadow duration-[180ms] ease-[cubic-bezier(.2,.8,.3,1)]",
                "sticky",
                isScrolled && "shadow-none"
            )}
                data-project-sticky-tabs="true"
                style={{ top: 0 }}
            >
                <div className="w-full">
                    <div ref={tabListRef} role="tablist" aria-label="Project sections" className="app-scroll app-scroll-x -mb-px flex items-center overflow-x-auto px-4 sm:px-6 max-md:[mask-image:linear-gradient(to_right,#000_88%,transparent)]">
                        {visibleTabs.map((tab, index) => {
                            const isActive = activeTab === tab.id;
                            return (
                                <button
                                    key={tab.id}
                                    type="button"
                                    data-testid={`project-tab-${tab.id}`}
                                    data-active={isActive ? "true" : "false"}
                                    id={`project-tab-${tab.id}`}
                                    role="tab"
                                    aria-selected={isActive}
                                    aria-controls="project-active-tab-panel"
                                    tabIndex={isActive ? 0 : -1}
                                    onClick={() => onTabChange(tab.id)}
                                    onKeyDown={(event) => handleTabKeyDown(event, index)}
                                    onMouseEnter={() => onTabHover?.(tab.id)}
                                    onFocus={() => onTabHover?.(tab.id)}
                                    className={cn(
                                        "nb-tab nb-ui-label relative flex h-[var(--ui-control-height)] shrink-0 items-center gap-2 whitespace-nowrap px-3 transition-colors duration-[180ms] ease-[cubic-bezier(.2,.8,.3,1)]",
                                        isActive
                                            ? "text-primary"
                                            : "text-muted-foreground hover:text-foreground"
                                    )}
                                >
                                    <tab.icon aria-hidden="true" className={cn("size-4 max-sm:hidden", isActive ? "text-primary" : "text-muted-foreground/70")} />
                                    {tab.label}
                                    {tab.id === "files" && filesSyncBadge && filesSyncBadge.status !== "idle" && filesSyncBadge.status !== "completed" && (
                                        <span
                                            data-testid="files-tab-sync-badge"
                                            title={filesSyncBadge.tooltip || `GitHub sync: ${filesSyncBadge.status}`}
                                            className={cn(
                                                "ml-1 inline-flex items-center justify-center text-[10px] max-md:text-[11px] font-mono font-semibold transition-[color,background-color,border-color,box-shadow,opacity,transform]",
                                                filesSyncBadge.status === "syncing" && "size-2 rounded-full bg-[var(--status-info)] animate-none",
                                                filesSyncBadge.status === "incoming" && "min-w-4 h-4 px-1 rounded-[3px] bg-amber-500 text-white leading-none",
                                                filesSyncBadge.status === "failed" && "size-2 rounded-full bg-red-500",
                                            )}
                                        >
                                            {filesSyncBadge.status === "incoming" && filesSyncBadge.count ? filesSyncBadge.count : null}
                                        </span>
                                    )}
                                    {isActive ? <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" /> : null}
                                </button>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* Main Content Area */}
            <section
                id="project-active-tab-panel"
                role="tabpanel"
                aria-labelledby={`project-tab-${activeTab}`}
                className={cn(
                    isFilesTab
                            ? "flex h-[calc(100dvh-var(--ui-topnav-height)-var(--project-tabs-height))] min-h-[28rem] w-full flex-col overflow-hidden max-md:h-[calc(100dvh-var(--ui-topnav-height)-var(--project-tabs-height)-3rem)] max-md:min-h-0"
                            : isSettingsTab
                                ? "w-full"
                                : isUpdatesTab
                                    ? "w-full p-4 sm:py-5 sm:pl-5 sm:pr-6"
                                    : isTasksTab
                                        ? "w-full p-4 sm:p-5"
                                        : "w-full p-4 sm:p-5"
                )}
                data-project-content-root={isFilesTab ? "workspace" : "page"}
                data-project-workspace-tab={isFilesTab ? activeTab : undefined}
            >
                {children}
            </section>
        </div>
    );
}

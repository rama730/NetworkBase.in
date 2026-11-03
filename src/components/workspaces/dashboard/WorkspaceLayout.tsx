"use client";

import { useState, useEffect, useMemo, useRef, type CSSProperties, type KeyboardEvent } from "react";
import Link from "next/link";
import { WORKSPACE_TAB_LABELS } from "@/lib/copy/terms";
import {
    LayoutDashboard, ListTodo, FolderOpen, BookOpenText,
    Settings, Share2, UserPlus, UserCheck, IterationCcw, Loader2, Newspaper, MoreHorizontal, Info, Users, FolderKanban
} from "lucide-react";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { Workspace } from "@/types/discover";
import WorkspaceStatsBar from "@/components/workspaces/WorkspaceStatsBar";
import WorkspaceAvatar from "@/components/workspaces/WorkspaceAvatar";
import { WorkspaceLastUpdate } from "@/components/workspaces/WorkspaceLastUpdate";
import { WorkspaceLinkCluster } from "@/components/workspaces/dashboard/WorkspaceSocialLinksCard";
import ProjectTeamAvatars, { type WorkspaceHeaderMember } from "@/components/workspaces/dashboard/WorkspaceTeamAvatars";
import {
    isWorkspaceTabVisibleToViewer,
    normalizeWorkspacePublicTabVisibility,
    type WorkspacePublicTabVisibility,
} from "@/lib/workspaces/settings-policies";

interface ProjectLayoutProps {
    children: React.ReactNode;
    project: Workspace;
    isOwner: boolean;
    isOwnerOrMember?: boolean;
    canManageSettings?: boolean;
    publicTabVisibility?: WorkspacePublicTabVisibility | null;
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
    members?: WorkspaceHeaderMember[];
    loadingMembers?: boolean;
    /** Current lifecycle stage for the mobile header chip (spec §19: title and stage). */
    stageLabel?: string | null;
    stageIndex?: number;
    stageCount?: number;
    /** Roles with open spots; visitors get a mobile shortcut to the Open roles card. */
    openRolesCount?: number;
    /** The visitor's own application ("Application pending"), shown on the same mobile link. */
    applicationLabel?: string | null;
    /** Organizations (report §18): About tab, Settings for everyone in the org, and the org header parts. */
    isOrganization?: boolean;
    identityExtra?: React.ReactNode;
    /** Under the buttons, below who last updated it: where this sits and what it is. */
    headerDetails?: React.ReactNode;
    /** Above the title: a child project's org (report §18.4). */
    breadcrumb?: React.ReactNode;
    /** Opens Settings for people who don't manage the project, such as inherited org admins. */
    canOpenSettings?: boolean;
    metadataExtra?: React.ReactNode;
    actionsStart?: React.ReactNode;
    /** The overflow "⋯", always the last header action (after Share). */
    actionsEnd?: React.ReactNode;
    showFollow?: boolean;
    /** Decision 70: a verified organization's ✓ beside its name. */
    titleBadge?: React.ReactNode;
    /** Decision 22: views and followers mean nothing on an organization-only or private workspace. */
    showStats?: boolean;
    /** Org tab badges (report §18.3): a count, or a dot for something unseen. */
    tabBadges?: Partial<Record<string, number | "dot">>;
    /** The compact bar on Files / Tasks / Sprints (report §18.7): the org's active sprint chip in place of the
     *  stage, the child's org logo before its name, and extra ⋯ items such as New. */
    compactChip?: React.ReactNode;
    compactPrefix?: React.ReactNode;
    compactMenuItems?: React.ReactNode;
}

const TABS = [
    { id: "dashboard", label: WORKSPACE_TAB_LABELS.dashboard, icon: LayoutDashboard },
    { id: "about", label: WORKSPACE_TAB_LABELS.about, icon: Info },
    { id: "readme", label: WORKSPACE_TAB_LABELS.readme, icon: BookOpenText },
    { id: "updates", label: WORKSPACE_TAB_LABELS.updates, icon: Newspaper },
    { id: "sprints", label: WORKSPACE_TAB_LABELS.sprints, icon: IterationCcw },
    { id: "tasks", label: WORKSPACE_TAB_LABELS.tasks, icon: ListTodo },
    { id: "files", label: WORKSPACE_TAB_LABELS.files, icon: FolderOpen },
    { id: "projects", label: WORKSPACE_TAB_LABELS.projects, icon: FolderKanban },
    { id: "members", label: WORKSPACE_TAB_LABELS.members, icon: Users },
    { id: "settings", label: WORKSPACE_TAB_LABELS.settings, icon: Settings, ownerOnly: true },
];

export default function WorkspaceLayout({
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
    applicationLabel = null,
    isOrganization = false,
    identityExtra = null,
    headerDetails = null,
    breadcrumb = null,
    canOpenSettings = false,
    metadataExtra = null,
    actionsStart = null,
    actionsEnd = null,
    showFollow = true,
    showStats = true,
    titleBadge = null,
    tabBadges = {},
    compactChip,
    compactPrefix = null,
    compactMenuItems = null,
}: ProjectLayoutProps) {
    const [summaryExpanded, setSummaryExpanded] = useState(false);
    const [projectTabsHeight, setProjectTabsHeight] = useState(0);
    const [projectIdentityHeight, setProjectIdentityHeight] = useState(320);
    const tabsRef = useRef<HTMLDivElement>(null);
    const actionsTrigger = useRef<HTMLButtonElement>(null);
    const tabListRef = useRef<HTMLDivElement>(null);
    const isScrolled = false;
    const projectIdentityRef = useRef<HTMLDivElement>(null);

    const isFilesTab = activeTab === "files";
    const isSettingsTab = activeTab === "settings";
    const isUpdatesTab = activeTab === "updates";
    const isTasksTab = activeTab === "tasks";
    // Tool tabs compact the project context below md so the work surface gets the height (spec §08/§19).
    const isToolTab = isFilesTab || isTasksTab || activeTab === "sprints";

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
        () => normalizeWorkspacePublicTabVisibility(publicTabVisibility ?? project.publicTabVisibility),
        [project.publicTabVisibility, publicTabVisibility],
    );
    const canSeeMemberTabs = isOwnerOrMember ?? isOwner;
    const visibleTabs = useMemo(
        () => TABS.filter((tab) => {
            const settingsAccess = (canManageSettings ?? isOwner) || canOpenSettings;
            if (tab.ownerOnly && !settingsAccess && !isOrganization) return false;
            return isWorkspaceTabVisibleToViewer({
                tabId: tab.id,
                isOwnerOrMember: canSeeMemberTabs,
                canManageSettings: settingsAccess,
                publicTabVisibility: normalizedPublicTabs,
                isOrganization,
            });
        }),
        [canManageSettings, canOpenSettings, canSeeMemberTabs, isOrganization, isOwner, normalizedPublicTabs],
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
    const layoutStyle = useMemo(() => ({
        "--workspace-tabs-height": `${projectTabsHeight}px`,
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
                    <div ref={projectIdentityRef} className={cn("nb-workspace-identity flex flex-wrap items-start justify-between gap-4 px-4 pb-4 pt-5 sm:px-6 max-md:gap-3 max-md:pt-4", isToolTab && "max-md:hidden")}>
                        {/* Left: Project Identity */}
                        {(() => {
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
                                <div className="mt-2 flex min-h-[34px] flex-wrap items-center gap-x-2 gap-y-1.5">
                                    <ProjectTeamAvatars project={project} members={members} loading={loadingMembers} />
                                    {metadataExtra}
                                    {hasProjectLinks && (
                                        <>
                                            <div className="mx-0.5 h-4 w-px shrink-0 bg-border last:hidden" aria-hidden="true" />
                                            <WorkspaceLinkCluster
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

                            return (
                                <div className="min-w-0 flex-1 md:min-w-[320px] max-md:basis-full">
                                    {breadcrumb}
                                    {/* The image matches the name and tagline, and the people row starts under it, so no space is left below the image.
                                        On a phone the tagline wraps, so it runs full width under the image and name. */}
                                    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 max-md:items-center">
                                        <div className="flex md:row-span-3">
                                            <WorkspaceAvatar
                                                project={project}
                                                size="detail"
                                                isOwner={isOwner}
                                                slugOrId={project.slug || project.id}
                                                placeholder
                                                className="size-16 rounded-[10px] max-md:size-12 max-md:rounded-[8px]"
                                            />
                                        </div>
                                        <h1 className="nb-page-title min-w-0 break-words text-foreground">
                                            {project?.title}{titleBadge}
                                        </h1>
                                        {project.shortDescription && (
                                            <p className={cn("nb-body mt-1 max-w-[64ch] text-muted-foreground max-md:col-span-2 max-md:mt-2", !summaryExpanded && "max-md:line-clamp-3")}>
                                                {project.shortDescription}
                                            </p>
                                        )}
                                        {summaryToggle ? <div className="max-md:col-span-2 md:hidden">{summaryToggle}</div> : null}
                                    </div>
                                    {identityExtra ? <div className="mt-2">{identityExtra}</div> : null}
                                    {projectIdentityMetadata}
                                </div>
                            );
                        })()}

                        {/* Right: actions, then who last updated it, then where it sits. */}
                        <div className="flex min-w-0 flex-col items-end gap-2 max-md:basis-full max-md:items-start" data-testid="workspace-header-side">
                        <div className="flex flex-wrap items-center justify-end gap-2 max-md:justify-start">
                            {showStats ? <WorkspaceStatsBar
                                viewCount={viewCount ?? (project as any)?.viewCount ?? 0}
                                followersCount={followersCount ?? (project as any)?.followersCount ?? 0}
                                isTeam={isOwnerOrMember}
                                className="max-md:basis-full"
                            /> : null}

                            {actionsStart}
                            {canInvite && onInvite ? (
                                <button
                                    type="button"
                                    onClick={onInvite}
                                    className="nb-touch-target nb-ui-label inline-flex h-[var(--ui-control-height)] items-center gap-1.5 rounded-md border border-border bg-card px-3 text-foreground transition-colors duration-[180ms] ease-[cubic-bezier(.2,.8,.3,1)] hover:bg-muted"
                                    aria-label={isOrganization ? "Invite people" : "Invite a workspace member"}
                                    title={isOrganization ? "Invite people" : "Invite a workspace member"}
                                >
                                    <UserPlus className="size-4" aria-hidden="true" />
                                    <span>Invite</span>
                                </button>
                            ) : null}
                            
                            {/* Follow */}
                            {showFollow ? (
                            <button
                                type="button"
                                onClick={onFollow}
                                className={cn(
                                    "nb-touch-target nb-ui-label flex h-[var(--ui-control-height)] items-center gap-1.5 rounded-md px-3 transition-colors duration-[180ms] ease-[cubic-bezier(.2,.8,.3,1)] disabled:cursor-not-allowed disabled:opacity-60",
                                    isFollowing
                                        ? "text-primary bg-primary/10"
                                        : "border border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
                                )}
                                title={isFollowing ? "Unfollow workspace" : "Follow workspace"}
                                aria-label={isFollowing ? "Unfollow workspace" : "Follow workspace"}
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
                            ) : null}

                            <div className="mx-1 h-4 w-px bg-border max-md:hidden" />

                            {/* Share */}
                            <button
                                type="button"
                                onClick={event => onShare?.(event.currentTarget)}
                                className="nb-icon-button h-[var(--ui-control-height)] w-[var(--ui-control-height)] rounded-[5px] border border-border bg-card text-muted-foreground transition-colors duration-[180ms] ease-[cubic-bezier(.2,.8,.3,1)] hover:bg-muted hover:text-foreground"
                                title={isOrganization ? "Share organization" : "Share workspace"}
                                aria-label={isOrganization ? "Share organization" : "Share workspace"}
                            >
                                <Share2 className="size-4" aria-hidden="true" />
                            </button>
                            {actionsEnd}

                            {!(isOwnerOrMember ?? isOwner) && (openRolesCount > 0 || applicationLabel) && activeTab === "dashboard" ? (
                                <a href="#open-roles" className="nb-touch-target nb-ui-label inline-flex items-center px-1 text-primary md:hidden">
                                    {applicationLabel ?? `${openRolesCount} open ${openRolesCount === 1 ? "role" : "roles"}`} ›
                                </a>
                            ) : null}
                        </div>
                        {/* The height is held so the buttons don't move when the line arrives. */}
                        <div className="min-h-5 w-full max-w-[280px] text-right text-[13px] leading-5 text-muted-foreground max-md:text-left">
                            <WorkspaceLastUpdate projectId={project.id} className="block truncate" />
                        </div>
                        {headerDetails}
                        </div>
                    </div>

                    {isToolTab ? (
                        <div className="flex h-12 items-center gap-2 px-4 md:hidden">
                            {compactPrefix}
                            <WorkspaceAvatar project={project} className="size-6 rounded-[5px]" />
                            <h1 className="nb-ui-label min-w-0 flex-1 truncate text-[15px] font-semibold text-foreground" title={project?.title}>
                                {project?.title}
                            </h1>
                            {compactChip !== undefined ? compactChip : stageLabel ? <span className="nb-status shrink-0" data-status="active">{stageLabel}</span> : null}
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <button ref={actionsTrigger} type="button" aria-label="Workspace actions" className="nb-icon-button nb-touch-target shrink-0">
                                        <MoreHorizontal className="size-4" aria-hidden="true" />
                                    </button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-48">
                                    {compactMenuItems}
                                    {showFollow ? (
                                        <DropdownMenuItem onSelect={() => onFollow?.()} disabled={followLoading}>
                                            {isFollowing ? <UserCheck className="size-4" aria-hidden="true" /> : <UserPlus className="size-4" aria-hidden="true" />}
                                            {isFollowing ? "Unfollow workspace" : "Follow workspace"}
                                        </DropdownMenuItem>
                                    ) : null}
                                    {canInvite && onInvite ? (
                                        <DropdownMenuItem onSelect={onInvite}>
                                            <UserPlus className="size-4" aria-hidden="true" />
                                            Invite a member
                                        </DropdownMenuItem>
                                    ) : null}
                                    <DropdownMenuItem onSelect={() => onShare?.(actionsTrigger.current ?? undefined)}>
                                        <Share2 className="size-4" aria-hidden="true" />
                                        {isOrganization ? "Share organization" : "Share workspace"}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onSelect={() => onTabChange("dashboard")}>
                                        <LayoutDashboard className="size-4" aria-hidden="true" />
                                        {isOrganization ? "Organization overview" : "Workspace overview"}
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
                    <div ref={tabListRef} role="tablist" aria-label="Workspace sections" className="app-scroll app-scroll-x -mb-px flex items-center overflow-x-auto px-4 sm:px-6 max-md:[mask-image:linear-gradient(to_right,#000_88%,transparent)]">
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
                                    {tabBadges[tab.id] === "dot" ? (
                                        <span data-testid={`tab-badge-${tab.id}`} className="ml-1 size-2 rounded-full bg-primary"><span className="sr-only">(new)</span></span>
                                    ) : tabBadges[tab.id] ? (
                                        <span data-testid={`tab-badge-${tab.id}`} className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-[3px] bg-primary px-1 font-mono text-[10px] font-semibold leading-none text-primary-foreground max-md:text-[11px]">
                                            {tabBadges[tab.id]}<span className="sr-only"> waiting</span>
                                        </span>
                                    ) : null}
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
                            ? "flex h-[calc(100dvh-var(--ui-topnav-height)-var(--workspace-tabs-height))] min-h-[28rem] w-full flex-col overflow-hidden max-md:h-[calc(100dvh-var(--ui-topnav-height)-var(--workspace-tabs-height)-3rem)] max-md:min-h-0"
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

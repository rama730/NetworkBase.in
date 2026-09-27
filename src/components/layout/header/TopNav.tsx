"use client";

import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { useCallback, useEffect, useState, Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { LogOut, Menu, Plus, UserRound } from "lucide-react";
import Logo from "./Logo";
import { toast } from "sonner";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

import ThemeToggle from "./ThemeToggle";
// Dynamic Imports for heavy interactive components
import dynamic from "next/dynamic";
const MobileMenu = dynamic(() => import("./MobileMenu"), { ssr: false });
const CommandPalette = dynamic(() => import("./CommandPalette"), { ssr: false });
const NotificationPreview = dynamic(() => import("./NotificationPreview"), { ssr: false });
const CreateProjectWizard = dynamic(() => import("@/components/projects/create-wizard/CreateProjectWizard"), { ssr: false });

import GlobalSearch from "./GlobalSearch";

import { ConnectionStatusIndicator } from "./ConnectionStatusIndicator";
import { ProfileAvatar } from "./ProfileAvatar";
import { OnlineIndicator } from "@/components/ui/OnlineIndicator";


import { useAuth } from "@/hooks/use-auth";
import { useNotifications } from "@/hooks/useNotifications";
import { useNetworkNotifications } from "@/hooks/useNetworkNotifications";
import { ROUTES } from "@/constants/routes";
import { resolveTopNavAuthUiState } from "./topnav-auth-state";

import {
    resolveGlobalSearchContext,
    type GlobalSearchContext,
} from "./global-search";
import { useMessagesV2UiStore } from "@/stores/messagesV2UiStore";
import { useMessageAttention } from "@/components/providers/MessageAttentionProvider";
import { useUIStore } from "@/stores/ui-store";
import { useRealtime } from "@/components/providers/RealtimeProvider";
import { getWorkspaceSummaryAction } from "@/app/actions/workspace";
import { queryKeys } from "@/lib/query-keys";
import {
    clearGithubOAuthResume,
    getCreateProjectReturnPath,
    parseCreateProjectSource,
    readGithubOAuthResume,
    type CreateProjectGithubOAuthResume,
} from "@/components/projects/create-wizard/github-oauth-resume";

export default function TopNav() {
    const pathname = usePathname();
    const router = useRouter();
    const { user, isAuthenticated: isSignedIn, isLoading: authLoading, profile, signOut } = useAuth();

    const notifications = useNotifications();
    const peopleNotifications = useNetworkNotifications();
    const messageAttention = useMessageAttention();
    const { connectionHealth } = useRealtime();

    // Hydration fix: ensures we only render auth-dependent UI after mount
    const [mounted, setMounted] = useState(false);
    useEffect(() => {
        setMounted(true);
    }, []);

    const [showMobileMenu, setShowMobileMenu] = useState(false);
    const [showCreateProject, setShowCreateProject] = useState(false);
    const [createProjectInitialSource, setCreateProjectInitialSource] = useState<'scratch' | 'github' | 'upload' | null>(null);
    const [githubOAuthResume, setGithubOAuthResume] = useState<CreateProjectGithubOAuthResume | null>(null);
    const [showCommandPalette, setShowCommandPalette] = useState(false);
    const [commandPaletteQuery, setCommandPaletteQuery] = useState("");
    const [commandPaletteContext, setCommandPaletteContext] = useState<GlobalSearchContext | undefined>();
    const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
    const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);
    const [isSigningOut, setIsSigningOut] = useState(false);

    const handleSignOut = async () => {
        if (isSigningOut) return;
        setIsSigningOut(true);
        try {
            await signOut();
            toast.info("Signed out successfully");
        } finally {
            setIsSigningOut(false);
        }
    };

    const setMessageSearchOpen = useMessagesV2UiStore((state) => state.setMessageSearchOpen);
    const openWorkspace = useUIStore((state) => state.openWorkspace);
    const workspaceSummary = useQuery({
        queryKey: queryKeys.workspace.summary(),
        queryFn: getWorkspaceSummaryAction,
        enabled: Boolean(isSignedIn),
        staleTime: 30_000,
        refetchOnWindowFocus: false,
    });
    const workspaceActionCount = workspaceSummary.data?.success
        ? workspaceSummary.data.taskCount + workspaceSummary.data.requestCount + peopleNotifications.pendingConnections
        : peopleNotifications.pendingConnections;
    const isProjectDetailRoute = pathname.startsWith('/projects/');

    useEffect(() => {
        // The Hub owns its own query-driven wizard. Every other page restores the
        // wizard here so a GitHub callback returns to the place it was launched (createProject=1).
        if (pathname === '/discover' || typeof window === 'undefined') return;
        const currentSearchParams = new URLSearchParams(window.location.search);
        if (currentSearchParams.get('createProject') !== '1') return;

        const returnPath = getCreateProjectReturnPath(window.location);
        const resume = readGithubOAuthResume(returnPath);
        setCreateProjectInitialSource(
            parseCreateProjectSource(currentSearchParams.get('createProjectSource'))
            ?? resume?.values.import_source?.type
            ?? null,
        );
        setGithubOAuthResume(resume);
        setShowCreateProject(true);
        window.history.replaceState(window.history.state, '', returnPath);
    }, [pathname]);

    const closeGlobalSearch = useCallback(() => {
        setShowCommandPalette(false);
        setCommandPaletteQuery("");
        setCommandPaletteContext(undefined);
    }, []);

    const openGlobalSearch = useCallback((query = "", requestedContext?: GlobalSearchContext) => {
        const nextContext = requestedContext ?? resolveGlobalSearchContext(pathname).context;
        if (nextContext === "messages") {
            closeGlobalSearch();
            setMessageSearchOpen(true);
            return;
        }
        setCommandPaletteQuery(query);
        setCommandPaletteContext(nextContext);
        setShowCommandPalette(true);
    }, [closeGlobalSearch, pathname, setMessageSearchOpen]);



    const authUiState = resolveTopNavAuthUiState({
        isAuthenticated: isSignedIn,
        isLoading: authLoading,
    });

    // Global keyboard shortcut for command palette
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
                e.preventDefault();
                if ((e.target as HTMLElement | null)?.closest("[data-messages-surface]")) {
                    closeGlobalSearch();
                    setMessageSearchOpen(true);
                    return;
                }
                if (showCommandPalette) {
                    closeGlobalSearch();
                } else {
                    openGlobalSearch();
                }
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [closeGlobalSearch, openGlobalSearch, setMessageSearchOpen, showCommandPalette]);
    // Listen for custom event to open command palette
    useEffect(() => {
        const handleOpenCommandPalette = (e: CustomEvent<{ query?: string; context?: GlobalSearchContext }>) => {
            openGlobalSearch(e.detail?.query ?? "", e.detail?.context);
        };

        window.addEventListener("open-command-palette", handleOpenCommandPalette as EventListener);
        return () => window.removeEventListener("open-command-palette", handleOpenCommandPalette as EventListener);
    }, [openGlobalSearch]);

    return (
        <header
            className="nb-topbar shrink-0 border-b border-border bg-card"
        >
            <div className="px-4 sm:px-5 flex min-w-0 items-center justify-between gap-3 h-[var(--ui-topnav-height)]">
                <div className="flex shrink-0 items-center gap-4">
                    <div className="md:hidden">
                        <Logo href={authUiState === "signed-in" ? ROUTES.DISCOVER : ROUTES.HOME} />
                    </div>
                </div>

                <div className="hidden min-w-0 flex-1 items-center md:flex">
                    {authUiState === "signed-in" && (
                        <Suspense fallback={<div className="h-[var(--ui-control-height)] w-60 shrink-0 rounded-md bg-muted" />}>
                            <GlobalSearch
                                condensed={false}
                                onOpenCommandPalette={openGlobalSearch}
                            />
                        </Suspense>
                    )}
                </div>

                <div className="flex shrink-0 items-center gap-2">
                    {authUiState === "signed-in" && (
                        <button
                            type="button"
                            onClick={() => {
                                setCreateProjectInitialSource(null);
                                setGithubOAuthResume(null);
                                setShowCreateProject(true);
                            }}
                            className={`nb-ui-label hidden h-[var(--ui-control-height)] items-center gap-2 rounded-md border px-4 transition-[background-color,border-color,color,transform] duration-150 ease-in-out active:translate-y-px sm:inline-flex ${isProjectDetailRoute
                                ? 'border-border bg-card text-foreground hover:border-input hover:bg-muted'
                                : 'border-primary bg-primary text-primary-foreground hover:border-[var(--primary-hover)] hover:bg-[var(--primary-hover)] active:border-[var(--primary-active)] active:bg-[var(--primary-active)]'}`}
                        >
                            <Plus className="size-4" aria-hidden="true" />
                            New project
                        </button>
                    )}
                    {authUiState === "signed-in" && <ConnectionStatusIndicator />}
                    {authUiState === "signed-in" && (
                        <NotificationPreview
                            unreadCount={notifications.unreadCount}
                            unreadImportantCount={notifications.unreadImportantCount}
                            items={notifications.items}
                            activeFilter={notifications.activeFilter}
                            isOpen={notifications.isTrayOpen}
                            isLoading={notifications.isLoading}
                            hasMore={notifications.hasMore}
                            isLoadingMore={notifications.isLoadingMore}
                            connectionHealth={connectionHealth}
                            onOpenChange={notifications.setTrayOpen}
                            onFilterChange={notifications.setActiveFilter}
                            onOpenItem={notifications.openItem}
                            onItemsViewed={notifications.stageViewedNotifications}
                            onMarkUnread={notifications.markUnread}
                            onDismiss={notifications.dismiss}
                            onClearAll={notifications.dismissAll}
                            onMuteScope={notifications.muteScope}
                            onSnooze={notifications.snooze}
                            onLoadMore={notifications.loadMore}
                        />
                    )}

                    <ThemeToggle />

                    {authUiState === "loading" ? (
                        <div className="ml-1 border-l border-border pl-3">
                            <div className="size-[34px] rounded-md bg-muted" />
                        </div>
                    ) : (
                        <div className="relative ml-1 border-l border-border pl-3">
                            {authUiState === "signed-in" ? (
                                <DropdownMenu open={isProfileMenuOpen} onOpenChange={setIsProfileMenuOpen}>
                                    <DropdownMenuTrigger asChild>
                                        <button
                                            type="button"
                                            className="group inline-flex size-10 items-center justify-center rounded-[5px] transition-colors hover:bg-muted outline-none focus:outline-none focus-visible:outline-none focus:ring-0 focus-visible:ring-0"
                                            aria-label="User menu"
                                            data-testid="topnav-profile-menu-trigger"
                                        >
                                            <span className="relative inline-flex">
                                                <ProfileAvatar profile={profile} size={32} priority />
                                                <OnlineIndicator online size="sm" />
                                            </span>
                                        </button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent
                                        align="end"
                                        sideOffset={8}
                                        className="w-56 overflow-hidden rounded-[8px] border border-border bg-popover p-1 text-popover-foreground shadow-lg duration-[180ms] data-[state=closed]:zoom-out-100 data-[state=open]:zoom-in-100"
                                    >
                                        <div className="px-2.5 py-2">
                                            <p className="truncate text-xs font-semibold text-foreground">
                                                {profile?.fullName || profile?.username || "Account"}
                                            </p>
                                            {profile?.username ? (
                                                <p className="truncate font-mono text-[11px] text-muted-foreground">
                                                    @{profile.username}
                                                </p>
                                            ) : user?.email ? (
                                                <p className="truncate font-mono text-[11px] text-muted-foreground">
                                                    {user.email}
                                                </p>
                                            ) : null}
                                        </div>
                                        <DropdownMenuSeparator className="-mx-1 my-1 bg-border" />
                                        <DropdownMenuItem asChild>
                                            <Link
                                                href={ROUTES.MY_PROFILE}
                                                prefetch={false}
                                                className="flex h-[34px] w-full cursor-pointer items-center gap-2.5 rounded-[5px] px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-muted focus:bg-muted focus:text-foreground"
                                            >
                                                <UserRound className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                                                <span>My Profile</span>
                                            </Link>
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                            variant="destructive"
                                            onSelect={() => setShowSignOutConfirm(true)}
                                            className="flex h-[34px] w-full cursor-pointer items-center gap-2.5 rounded-[5px] px-2.5 text-xs font-medium transition-colors"
                                        >
                                            <LogOut className="size-4 shrink-0" aria-hidden="true" />
                                            <span>Sign Out</span>
                                        </DropdownMenuItem>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            ) : (
                                <Link
                                    href={ROUTES.LOGIN}
                                    className="nb-ui-label inline-flex h-[var(--ui-control-height)] items-center rounded-md border border-border bg-card px-4 transition-colors duration-[130ms] hover:bg-muted focus:outline-none"
                                >
                                    Sign in
                                </Link>
                            )}
                        </div>
                    )}

                    {authUiState === "signed-in" && (
                        <button
                            onClick={() => setShowMobileMenu(true)}
                            className="nb-mobile-menu-trigger inline-flex size-10 items-center justify-center rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none md:hidden"
                            aria-label="Open mobile menu"
                            aria-expanded={showMobileMenu}
                            aria-controls="mobile-menu"
                        >
                            <Menu className="size-4" aria-hidden="true" />
                        </button>
                    )}
                </div>

                {mounted && authUiState === "signed-in" && (
                    <Suspense fallback={null}>
                        <MobileMenu
                            isOpen={showMobileMenu}
                            onClose={() => setShowMobileMenu(false)}
                            profile={profile}
                            onSignOut={signOut}
                            notificationUnreadCount={notifications.unreadImportantCount}
                            messageUnreadCount={messageAttention.unreadCount}
                            onOpenNotifications={() => {
                                setShowMobileMenu(false);
                                notifications.openTray();
                            }}
                            onOpenSearch={() => {
                                setShowMobileMenu(false);
                                openGlobalSearch();
                            }}
                            onOpenWorkspace={() => {
                                setShowMobileMenu(false);
                                openWorkspace("tasks");
                            }}
                            workspaceActionCount={workspaceActionCount}
                            connectionHealth={connectionHealth}
                        />
                    </Suspense>
                )}

                {mounted && authUiState === "signed-in" && showCommandPalette && (
                    <CommandPalette
                        isOpen={showCommandPalette}
                        onClose={closeGlobalSearch}
                        initialQuery={commandPaletteQuery}
                        context={commandPaletteContext}
                        recentSearchOwnerId={user?.id}
                    />
                )}
                {showCreateProject && (
                    <CreateProjectWizard
                        onClose={() => {
                            setShowCreateProject(false);
                            setCreateProjectInitialSource(null);
                            setGithubOAuthResume(null);
                        }}
                        onSuccess={(projectId) => {
                            setShowCreateProject(false);
                            setGithubOAuthResume(null);
                            router.push(`/projects/${projectId}`);
                        }}
                        initialSource={createProjectInitialSource}
                        githubOAuthResume={githubOAuthResume}
                        onGithubOAuthResumeRestored={(resumeId) => {
                            clearGithubOAuthResume(resumeId);
                            setGithubOAuthResume(null);
                        }}
                    />
                )}
                <ConfirmDialog
                    open={showSignOutConfirm}
                    onOpenChange={setShowSignOutConfirm}
                    title="Sign out of your account?"
                    description="You will be signed out on this device. Unsaved offline changes or drafts may be lost."
                    confirmLabel="Sign out"
                    variant="destructive"
                    loading={isSigningOut}
                    onConfirm={handleSignOut}
                />
            </div>
        </header>
    );
}

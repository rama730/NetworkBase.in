"use client";

import { CreateWorkspaceCell } from "@/components/layout/header/CreateWorkspaceCell";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, Suspense } from "react";
import { Laptop, LogOut, Menu, Moon, Search, ShieldCheck, Smile, Sun, UserRound } from "lucide-react";
import Logo from "./Logo";
import { BackLogoSwap, BackSlot } from "./BackButton";
import { arrivedByTraverse, subscribeEntry } from "@/lib/navigation/in-app-history";
import { takeSearchReturn } from "@/lib/navigation/search-return";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SignOutConfirmDialog } from "@/components/auth/SignOutConfirmDialog";

import { useTheme } from "@/components/providers/theme-provider";
import { ShellPath } from "./ShellPath";
// Dynamic Imports for heavy interactive components
import dynamic from "next/dynamic";
const ResourceShareDialog = dynamic(() => import('@/components/sharing/ShareDialog').then(mod => mod.ShareDialog), { ssr: false });
const MobileMenu = dynamic(() => import("./MobileMenu"), { ssr: false });
const CommandPalette = dynamic(() => import("./CommandPalette"), { ssr: false });
// The placeholder reserves the bell's slot so the mobile topbar does not shift on hydration.
const NotificationPreview = dynamic(() => import("./NotificationPreview"), {
    ssr: false,
    loading: () => <span aria-hidden="true" className="inline-block size-[var(--ui-control-height)] shrink-0" />,
});

import GlobalSearch from "./GlobalSearch";

import { ConnectionStatusIndicator } from "./ConnectionStatusIndicator";
import { ProfileAvatar } from "./ProfileAvatar";
import { PersonPresenceBadge } from "@/components/presence/PersonPresence";
import { usePresenceUi } from "@/components/presence/presence-ui-store";
import { usePersonPresence } from "@/components/presence/usePresence";


import { useAuth } from "@/hooks/use-auth";
import { useNotifications } from "@/hooks/useNotifications";
import { ROUTES } from "@/constants/routes";
import { resolveTopNavAuthUiState } from "./topnav-auth-state";

import {
    resolveGlobalSearchContext,
    type GlobalSearchContext,
} from "./global-search";
import { useUIStore } from "@/stores/ui-store";
import { useChatUi } from "@/components/messages/chat-ui-store";
import { useChatShell } from "@/components/messages/ChatShellProvider";
import { useRealtime } from "@/components/providers/RealtimeProvider";

export default function TopNav() {
    const pathname = usePathname();
    const { user, isAuthenticated: isSignedIn, isLoading: authLoading, profile, signOut } = useAuth();

    const notifications = useNotifications();
    const { theme, setThemeWithTransition } = useTheme();
    const { connectionHealth } = useRealtime();
    const { badge: chatUnread } = useChatShell();

    // Hydration fix: ensures we only render auth-dependent UI after mount
    const [mounted, setMounted] = useState(false);
    useEffect(() => {
        setMounted(true);
    }, []);

    const showMobileMenu = useUIStore((state) => state.mobileMenuOpen);
    const setShowMobileMenu = useUIStore((state) => state.setMobileMenuOpen);
    const [showCommandPalette, setShowCommandPalette] = useState(false);
    const [commandPaletteQuery, setCommandPaletteQuery] = useState("");
    const [commandPaletteContext, setCommandPaletteContext] = useState<GlobalSearchContext | undefined>();
    const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
    // Staff only (trust and safety C1): asked when the menu opens, so nobody else pays for the check.
    const [staffBadge, setStaffBadge] = useState<{ count: number } | null>(null);
    useEffect(() => {
        if (!isProfileMenuOpen || !user) return;
        void import("@/app/actions/moderation-staff").then(({ staffBadgeAction }) => staffBadgeAction()).then(setStaffBadge, () => setStaffBadge(null));
    }, [isProfileMenuOpen, user]);
    const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);
    const [shareApplication, setShareApplication] = useState(false);
    const [shareReturnFocus, setShareReturnFocus] = useState<HTMLElement | null>(null);
    const profileMenuTriggerRef = useRef<HTMLButtonElement>(null);
    const mobileMenuTriggerRef = useRef<HTMLButtonElement>(null);

    // Report §7.1: on a workspace or organization page the page has its own main action, so this one is outlined.
    const isProjectDetailRoute = pathname.startsWith('/workspaces/') || pathname.startsWith('/org/');
    const isCreateProjectRoute = pathname === '/workspaces/new';


    const [commandPaletteIndex, setCommandPaletteIndex] = useState<number | undefined>();

    const closeGlobalSearch = useCallback(() => {
        setShowCommandPalette(false);
        setCommandPaletteQuery("");
        setCommandPaletteContext(undefined);
        setCommandPaletteIndex(undefined);
    }, []);

    const openGlobalSearch = useCallback((query = "", requestedContext?: GlobalSearchContext) => {
        // One search on every page; in Messages the top bar's search opens it too, while ⌘K there stays the chat switcher.
        const nextContext = requestedContext ?? resolveGlobalSearchContext(pathname).context;
        setCommandPaletteQuery(query);
        setCommandPaletteContext(nextContext);
        setShowCommandPalette(true);
    }, [closeGlobalSearch, pathname]);

    // Back to your search (unified back R2): returning to the page you searched from reopens it.
    // One listener for the life of the top bar: re-subscribing on every address change missed the stamp.
    const openGlobalSearchRef = useRef(openGlobalSearch);
    useEffect(() => { openGlobalSearchRef.current = openGlobalSearch; });
    useEffect(() => subscribeEntry((entry) => {
        if (!arrivedByTraverse()) return;
        const back = takeSearchReturn(window.sessionStorage, entry.id);
        if (!back) return;
        setCommandPaletteIndex(back.activeIndex >= 0 ? back.activeIndex : undefined);
        openGlobalSearchRef.current(back.query, back.context as GlobalSearchContext | undefined);
    }), []);



    const authUiState = resolveTopNavAuthUiState({
        isAuthenticated: isSignedIn,
        isLoading: authLoading,
    });

    // Global keyboard shortcut for command palette
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
                e.preventDefault();
                // Global search decision 5: inside Messages, or with the chat window open, ⌘K stays the chat switcher
                // (⌘J is My work's); the top bar's search opens the one box there too.
                // The page, not the focus: focus can sit on the body while Messages is open (live check).
                if (document.querySelector("[data-messages-surface]") || document.getElementById("chat-window")) {
                    closeGlobalSearch();
                    useChatUi.getState().setSwitcherOpen(true);
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
    }, [closeGlobalSearch, openGlobalSearch, showCommandPalette]);
    // Listen for custom event to open command palette
    useEffect(() => {
        const handleOpenCommandPalette = (e: CustomEvent<{ query?: string; context?: GlobalSearchContext }>) => {
            openGlobalSearch(e.detail?.query ?? "", e.detail?.context);
        };

        window.addEventListener("open-command-palette", handleOpenCommandPalette as EventListener);
        return () => window.removeEventListener("open-command-palette", handleOpenCommandPalette as EventListener);
    }, [openGlobalSearch]);

    const menuItem = "nb-touch-target flex h-[34px] w-full cursor-pointer items-center gap-2.5 rounded-[5px] px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-muted focus:bg-muted focus:text-foreground";
    const themeOrder = ["system", "light", "dark"] as const;
    const themeLabel = { system: "System", light: "Light", dark: "Dark" } as const;
    const currentTheme = (themeOrder as readonly string[]).includes(String(theme)) ? (theme as (typeof themeOrder)[number]) : "system";

    // Shell redesign (prototype N2XKz5wG4oEvp4cXtEJ5iD): the top bar is a row of bordered cells on the logo cell's line.
    // Desktop: back · where you are · search | live updates · New workspace · bell · you. Phone: menu · where · search · bell.
    return (
        <header className="nb-topbar shrink-0 border-b border-border bg-card">
            <div className="nb-topbar-cells h-[var(--ui-topnav-height)]">
                {authUiState === "signed-in" ? (
                    <>
                        <button
                            ref={mobileMenuTriggerRef}
                            onClick={() => setShowMobileMenu(true)}
                            data-welcome-slot-mobile=""
                            className="nb-mobile-menu-trigger nb-cell nb-cell-icon relative md:hidden"
                            aria-label={chatUnread ? "Open mobile menu, unread messages" : "Open mobile menu"}
                            aria-expanded={showMobileMenu}
                            aria-controls="mobile-menu"
                        >
                            <Menu className="size-5" aria-hidden="true" />
                            {connectionHealth !== "healthy" ? (
                                <span aria-hidden="true" className="absolute right-3 top-3 size-2 bg-[var(--status-warning)]" />
                            ) : null}
                            {/* Unread chat: a square here, the count on Messages inside the menu. */}
                            {chatUnread ? <span aria-hidden="true" data-testid="mobile-menu-chat-dot" className="absolute left-3 top-3 size-1.5 bg-[var(--nb-brand)]" /> : null}
                        </button>
                        <div className="nb-cell nb-cell-where min-w-0 flex-1 md:hidden">
                            <BackLogoSwap logo={<span className="nb-path-dot" aria-hidden="true" />} />
                            <ShellPath phone />
                        </div>
                        <div className="nb-cell-back hidden md:flex"><BackSlot /></div>
                        <div className="hidden min-w-0 md:contents"><ShellPath /></div>
                        <div className="nb-cell nb-cell-search hidden min-w-0 flex-1 md:flex">
                            <Suspense fallback={<div className="h-[var(--ui-control-height)] w-60 shrink-0 rounded-md bg-muted" />}>
                                <GlobalSearch
                                    condensed={false}
                                    cell
                                    onOpenCommandPalette={openGlobalSearch}
                                />
                            </Suspense>
                        </div>
                    </>
                ) : (
                    <div className="nb-cell flex-1"><Logo href={ROUTES.HOME} /></div>
                )}

                <div className="nb-topbar-right">
                    {authUiState === "signed-in" && (
                        <span className="hidden md:contents"><ConnectionStatusIndicator /></span>
                    )}
                    {authUiState === "signed-in" && (
                        // Project creation is its own page (spec §18), not a modal. On that page the cell stays pressed and
                        // counts the steps (v6.8); on a workspace or organization page it is outlined (§7.1).
                        <CreateWorkspaceCell active={isCreateProjectRoute} quiet={isProjectDetailRoute} />
                    )}
                    {authUiState === "signed-in" && (
                        <button
                            type="button"
                            onClick={() => openGlobalSearch()}
                            className="nb-cell nb-cell-icon md:hidden"
                            aria-label="Search"
                        >
                            <Search className="size-5" aria-hidden="true" />
                        </button>
                    )}
                    {authUiState === "signed-in" && (
                        <NotificationPreview n={notifications} connectionHealth={connectionHealth} />
                    )}

                    {authUiState === "loading" ? (
                        <div className="nb-cell nb-cell-me hidden md:flex">
                            <div className="size-9 rounded-md bg-muted" />
                        </div>
                    ) : authUiState === "signed-in" ? (
                        <DropdownMenu open={isProfileMenuOpen} onOpenChange={setIsProfileMenuOpen}>
                            <DropdownMenuTrigger asChild>
                                <button
                                    ref={profileMenuTriggerRef}
                                    type="button"
                                    className="nb-cell nb-cell-me group hidden md:flex"
                                    aria-label="User menu"
                                    data-testid="topnav-profile-menu-trigger"
                                >
                                    <span className="relative inline-flex" data-welcome-slot="">
                                        <ProfileAvatar profile={profile} size={36} priority />
                                        <PersonPresenceBadge userId={user?.id} live size={16} statusSize={20} className="absolute" style={{ right: -3, bottom: -3 }} />
                                    </span>
                                </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent
                                side="bottom"
                                align="end"
                                sideOffset={8}
                                alignOffset={0}
                                collisionPadding={12}
                                className="w-56 overflow-hidden rounded-[8px] border border-border bg-popover p-1 text-popover-foreground shadow-lg duration-[180ms] data-[state=closed]:zoom-out-100 data-[state=open]:zoom-in-100"
                            >
                                <div className="flex items-center gap-2.5 px-2 py-1.5">
                                    <ProfileAvatar profile={profile} size={36} />
                                    <span className="min-w-0">
                                        <span className="block truncate text-xs font-semibold text-foreground">
                                            {profile?.fullName || profile?.username || "Account"}
                                        </span>
                                        {profile?.username ? (
                                            <span className="block truncate font-mono text-[11px] text-muted-foreground">@{profile.username}</span>
                                        ) : user?.email ? (
                                            <span className="block truncate font-mono text-[11px] text-muted-foreground">{user.email}</span>
                                        ) : null}
                                    </span>
                                </div>
                                <DropdownMenuSeparator className="-mx-1 my-1 bg-border" />
                                <StatusMenuItem userId={user?.id ?? null} />
                                <DropdownMenuItem asChild>
                                    <Link href={ROUTES.MY_PROFILE} className={menuItem}>
                                        <UserRound className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                                        <span>My profile</span>
                                    </Link>
                                </DropdownMenuItem>
                                {/* Theme lives here now (one less cell in the top bar); it cycles and the menu stays open. */}
                                <DropdownMenuItem
                                    className={menuItem}
                                    onSelect={(event) => {
                                        event.preventDefault();
                                        void setThemeWithTransition(themeOrder[(themeOrder.indexOf(currentTheme) + 1) % themeOrder.length]!);
                                    }}
                                >
                                    {currentTheme === "dark" ? <Moon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /> : currentTheme === "light" ? <Sun className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /> : <Laptop className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
                                    <span>Theme</span>
                                    <span className="ml-auto font-mono text-[11px] uppercase tracking-[.06em] text-muted-foreground">{themeLabel[currentTheme]}</span>
                                </DropdownMenuItem>
                                {staffBadge ? (
                                    <DropdownMenuItem asChild>
                                        <Link href="/admin/trust" className={menuItem}>
                                            <ShieldCheck className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                                            <span>Trust and safety</span>
                                            {staffBadge.count > 0 ? <span className="nb-nav-count nb-nav-count--hot" aria-label={`${staffBadge.count} urgent or overdue`}>{staffBadge.count}</span> : null}
                                        </Link>
                                    </DropdownMenuItem>
                                ) : null}
                                <DropdownMenuSeparator className="-mx-1 my-1 bg-border" />
                                <DropdownMenuItem
                                    variant="destructive"
                                    onSelect={() => setShowSignOutConfirm(true)}
                                    className="flex h-[34px] w-full cursor-pointer items-center gap-2.5 rounded-[5px] px-2.5 text-xs font-medium transition-colors"
                                >
                                    <LogOut className="size-4 shrink-0" aria-hidden="true" />
                                    <span>Sign out</span>
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    ) : (
                        <Link href={ROUTES.LOGIN} className="nb-cell nb-ui-label">
                            Sign in
                        </Link>
                    )}
                </div>

                {shareApplication ? <ResourceShareDialog kind="application" path="/" returnFocusElement={shareReturnFocus} onClose={() => setShareApplication(false)} /> : null}
                {mounted && authUiState === "signed-in" && (
                    <Suspense fallback={null}>
                        <MobileMenu
                            isOpen={showMobileMenu}
                            onClose={() => setShowMobileMenu(false)}
                            returnFocusRef={mobileMenuTriggerRef}
                            profile={profile}
                            onSignOut={signOut}
                            onShareApplication={() => { setShareReturnFocus(mobileMenuTriggerRef.current); setShowMobileMenu(false); setShareApplication(true); }}
                            connectionHealth={connectionHealth}
                        />
                    </Suspense>
                )}

                {mounted && authUiState === "signed-in" && showCommandPalette && (
                    <CommandPalette
                        isOpen={showCommandPalette}
                        onClose={closeGlobalSearch}
                        initialQuery={commandPaletteQuery}
                        initialActiveIndex={commandPaletteIndex}
                        context={commandPaletteContext}
                        recentSearchOwnerId={user?.id}
                    />
                )}
                <SignOutConfirmDialog
                    open={showSignOutConfirm}
                    onOpenChange={setShowSignOutConfirm}
                    returnFocusRef={profileMenuTriggerRef}
                    onConfirm={signOut}
                />
            </div>
        </header>
    );
}

/** "Update your status" in the avatar menu, previewing the current one. */
function StatusMenuItem({ userId }: { userId: string | null }) {
    const presence = usePersonPresence(userId, { live: true });
    const openPicker = usePresenceUi((state) => state.setPickerOpen);
    return (
        <DropdownMenuItem
            onSelect={() => openPicker(true)}
            className="flex min-h-[34px] w-full cursor-pointer items-center gap-2.5 rounded-[5px] px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-muted focus:bg-muted"
        >
            {presence.status?.emoji ? <span aria-hidden="true" className="w-4 shrink-0 text-center font-[system-ui] text-[14px] leading-none">{presence.status.emoji}</span> : <Smile className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
            <span className="min-w-0 truncate">{presence.status ? presence.statusText || "Update your status" : "Update your status"}</span>
        </DropdownMenuItem>
    );
}

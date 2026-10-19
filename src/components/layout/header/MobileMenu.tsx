"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type MouseEvent, type RefObject } from "react";
import { LogOut, Plus, Share2, Smile, WifiOff, X } from "lucide-react";

import { SignOutConfirmDialog } from "@/components/auth/SignOutConfirmDialog";
import { SidebarNav } from "@/components/layout/AppSidebar";
import { ProfileAvatar } from "@/components/layout/header/ProfileAvatar";
import ThemeToggle from "@/components/layout/header/ThemeToggle";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { LegalLinks } from "@/components/legal/LegalLinks";
import { ROUTES } from "@/constants/routes";
import { usePresenceUi } from "@/components/presence/presence-ui-store";
import { SETTINGS_NAV_ITEM, isMainNavRouteActive } from "./nav-items";
import type { RealtimeHealthState } from "@/components/providers/RealtimeProvider";

// Mobile quick navigation: same destinations, order, counts and styles as the desktop sidebar (spec §08/§09).
export default function MobileMenu(props: {
    isOpen: boolean;
    onClose: () => void;
    returnFocusRef?: RefObject<HTMLElement | null>;
    profile?: {
        username?: string | null;
        fullName?: string | null;
        avatarUrl?: string | null;
    } | null;
    onShareApplication?: () => void;
    onSignOut?: () => void | Promise<void>;
    connectionHealth?: RealtimeHealthState;
}) {
    const pathname = usePathname();
    const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);
    const connectionNeedsAttention = props.connectionHealth === "offline" || props.connectionHealth === "unavailable";
    const connectionIsReconnecting = props.connectionHealth === "reconnecting";

    // Any navigation inside the drawer closes it; "My work" opens its own drawer.
    const closeOnNavigate = (event: MouseEvent<HTMLElement>) => {
        if ((event.target as HTMLElement).closest("a[href], #workspace-launcher")) props.onClose();
    };

    return (
        <>
            <Dialog open={props.isOpen} onOpenChange={(open) => { if (!open) props.onClose(); }}>
                <DialogContent
                    id="mobile-menu"
                    showCloseButton={false}
                    onClick={closeOnNavigate}
                    style={{ paddingBottom: "max(16px, env(safe-area-inset-bottom))" }}
                    className="left-0 right-auto top-0 flex h-dvh max-h-dvh! w-[min(320px,calc(100vw-32px))] max-w-none translate-x-0 translate-y-0 flex-col gap-3 rounded-none border-0 border-r border-border bg-sidebar p-4 md:hidden"
                >
                <DialogTitle className="sr-only">Mobile navigation</DialogTitle>
                <DialogDescription className="sr-only">Navigate your workspace or sign out.</DialogDescription>
                <div className="flex items-center justify-between gap-2">
                    <Link href={ROUTES.MY_PROFILE} className="flex min-h-11 min-w-0 items-center gap-3 rounded-[5px]">
                        <ProfileAvatar profile={props.profile ?? null} size={36} priority />
                        <span className="min-w-0">
                            <span className="nb-ui-label block truncate text-foreground">
                                {props.profile?.fullName || props.profile?.username || "Account"}
                            </span>
                            {props.profile?.username ? (
                                <span className="block truncate font-mono text-[12px] text-muted-foreground">@{props.profile.username}</span>
                            ) : null}
                        </span>
                    </Link>
                    <button
                        type="button"
                        onClick={props.onClose}
                        className="nb-icon-button nb-touch-target shrink-0"
                        aria-label="Close mobile menu"
                    >
                        <X className="size-5" aria-hidden="true" />
                    </button>
                </div>

                {/* Create-project page; closeOnNavigate shuts the drawer. 36px visual, 44px tap area via invisible hit padding (spec §05).
                    On that page it reads as "you are here" instead of a call to action. */}
                <Link
                    href="/projects/new"
                    aria-current={pathname === "/projects/new" ? "page" : undefined}
                    className={`relative inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-[5px] border px-3 text-[13px] font-medium transition-colors after:absolute after:inset-x-0 after:-inset-y-1 after:content-[''] ${pathname === "/projects/new"
                        ? "border-border bg-muted text-muted-foreground"
                        : "border-primary bg-primary text-primary-foreground hover:bg-[var(--primary-hover)] active:bg-[var(--primary-active)]"}`}
                >
                    <Plus className="size-3.5" aria-hidden="true" />
                    New project
                </Link>

                <SidebarNav />

                <nav aria-label="Settings and account" className="space-y-1 border-t border-border pt-3">
                    <button
                        type="button"
                        className="nb-nav-link w-full"
                        onClick={() => {
                            props.onClose();
                            usePresenceUi.getState().setPickerOpen(true);
                        }}
                    >
                        <Smile className="size-4 shrink-0" aria-hidden="true" />
                        Update your status
                    </button>
                    {connectionNeedsAttention || connectionIsReconnecting ? (
                        <p role="status" className="nb-compact flex min-h-11 items-center gap-2 px-2.5 text-[var(--status-warning)]">
                            <WifiOff className="size-4" aria-hidden="true" />
                            {connectionIsReconnecting ? "Reconnecting to live updates" : "Live updates unavailable"}
                        </p>
                    ) : null}
                    <Link
                        href={SETTINGS_NAV_ITEM.href}
                        className="nb-nav-link"
                        aria-current={isMainNavRouteActive(pathname, SETTINGS_NAV_ITEM.href) ? "page" : undefined}
                    >
                        <SETTINGS_NAV_ITEM.icon size={16} aria-hidden="true" />
                        {SETTINGS_NAV_ITEM.label}
                    </Link>
                    {props.onShareApplication ? <button type="button" className="nb-nav-link w-full" onClick={props.onShareApplication}><Share2 size={16} aria-hidden="true" />Share NetworkBase</button> : null}
                    <div className="flex min-h-11 items-center justify-between px-2.5">
                        <span className="nb-ui-label text-muted-foreground">Theme</span>
                        <ThemeToggle />
                    </div>
                    <button
                        type="button"
                        onClick={() => {
                            props.onClose();
                            setShowSignOutConfirm(true);
                        }}
                        className="nb-nav-link w-full text-destructive hover:text-destructive"
                    >
                        <LogOut size={16} aria-hidden="true" />
                        Sign out
                    </button>
                </nav>
                <div className="border-t border-border pt-2 px-1">
                    <LegalLinks align="start" showCopyright className="text-[11px]" />
                </div>
                </DialogContent>
            </Dialog>

            <SignOutConfirmDialog
                open={showSignOutConfirm}
                onOpenChange={setShowSignOutConfirm}
                returnFocusRef={props.returnFocusRef}
                onConfirm={async () => {
                    await props.onSignOut?.();
                }}
            />
        </>
    );
}

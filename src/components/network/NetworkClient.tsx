"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { SearchField } from "@/components/ui/SearchField";
import { useDebounce } from "use-debounce";

import { ComponentErrorBoundary } from "@/components/ui/ComponentErrorBoundary";
import { PersonCardSkeleton } from "@/components/network/PersonCardSkeleton";
import NetworkPeopleTab from "@/components/network/NetworkPeopleTab";
import { useNetworkNotifications } from "@/hooks/useNetworkNotifications";
import { normalizeSearchQuery } from "@/lib/search/query";
import { cn } from "@/lib/utils";
import { ROUTES } from "@/constants/routes";

type TabKey = "suggested" | "invitations" | "connections";

function normalizeTabKey(param: string): TabKey {
    const lower = param.toLowerCase();
    if (lower === "invitations" || lower === "requests") return "invitations";
    if (lower === "connections" || lower === "network") return "connections";
    return "suggested";
}

const TabLoading = () => (
    <div className="grid grid-cols-1 gap-[14px] sm:grid-cols-2" role="status" aria-label="Loading tab content" aria-hidden="true">
        <span className="sr-only">Loading tab content…</span>
        {[1, 2, 3, 4].map((item) => (
            <PersonCardSkeleton key={item} />
        ))}
    </div>
);

const loadConnectionsClient = () => import("@/components/network/ConnectionsClient");
const loadInvitationsClient = () => import("@/components/network/InvitationsClient");
const ConnectionsClient = dynamic(loadConnectionsClient, { ssr: false, loading: TabLoading });
const InvitationsClient = dynamic(loadInvitationsClient, { ssr: false, loading: TabLoading });

const preloadTab = (tab: TabKey) => {
    if (tab === "invitations") void loadInvitationsClient();
    else if (tab === "connections") void loadConnectionsClient();
};

interface NetworkClientProps {
    initialUser: { id?: string | null } | null;
}

const TAB_CONFIG: Array<{
    key: TabKey;
    label: string;
    requiresAuth: boolean;
}> = [
    { key: "suggested", label: "Suggested", requiresAuth: false },
    { key: "invitations", label: "Invitations", requiresAuth: true },
    { key: "connections", label: "Connections", requiresAuth: true },
];

export default function NetworkClient({
    initialUser,
}: NetworkClientProps) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { pendingConnections, pendingInvites, totalConnections } = useNetworkNotifications();
    const isAuthed = Boolean(initialUser?.id);
    const tabParam = (searchParams?.get("tab") || "").toLowerCase();
    const routeQuery = normalizeSearchQuery(searchParams?.get("q"));
    const [searchValue, setSearchValue] = useState(routeQuery);
    const [debouncedSearchValue] = useDebounce(searchValue, 300);

    const activeTab: TabKey = normalizeTabKey(tabParam);

    const visibleTabs = useMemo(
        () => TAB_CONFIG.filter((tab) => (tab.requiresAuth ? isAuthed : true)),
        [isAuthed],
    );

    useEffect(() => {
        if (routeQuery !== searchValue) {
            setSearchValue(routeQuery);
        }
    }, [routeQuery, searchValue]);

    useEffect(() => {
        const nextQuery = normalizeSearchQuery(debouncedSearchValue);
        if (nextQuery === routeQuery) return;
        const params = new URLSearchParams(searchParams?.toString() || "");
        if (nextQuery) params.set("q", nextQuery);
        else params.delete("q");
        router.replace(`${ROUTES.NETWORK}${params.size ? `?${params.toString()}` : ""}`, { scroll: false });
    }, [debouncedSearchValue, routeQuery, router, searchParams]);

    function tabCount(tab: TabKey) {
        if (tab === "invitations") return pendingConnections + pendingInvites;
        if (tab === "connections") return totalConnections;
        return null;
    }

    function navigateTab(next: TabKey) {
        if (next === activeTab) return;
        const params = new URLSearchParams(searchParams?.toString() || "");
        params.set("tab", next);
        params.delete("q");
        setSearchValue("");
        router.push(`${ROUTES.NETWORK}?${params.toString()}`, { scroll: false });
    }

    function handleTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const nextIndex = event.key === "Home"
            ? 0
            : event.key === "End"
                ? visibleTabs.length - 1
                : (index + (event.key === "ArrowRight" ? 1 : -1) + visibleTabs.length) % visibleTabs.length;
        const next = visibleTabs[nextIndex];
        if (!next) return;
        preloadTab(next.key);
        navigateTab(next.key);
        document.getElementById(`people-tab-${next.key}`)?.focus();
    }

    return (
        <div className="min-h-full bg-background">
            <div className="mx-auto w-full max-w-[1000px] px-4 py-8 sm:px-6">
                <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
                    <div className="min-w-0">
                        <h1 className="nb-page-title">Network</h1>
                        <p className="nb-body mt-1 text-muted-foreground">
                            People you&apos;ve worked with, and people worth working with.
                        </p>
                    </div>

                    <div className="flex w-full shrink-0 items-center gap-2 sm:w-auto">
                    <SearchField
                        pageSearch
                        value={searchValue}
                        onChange={setSearchValue}
                        label="Search your network"
                        size="lg"
                        className="flex-1 sm:w-60 sm:flex-none"
                    />
                    </div>
                </div>

                <div className="mt-6 flex items-stretch gap-2 overflow-x-auto border-b border-border" role="tablist" aria-label="Network sections">
                    {visibleTabs.map((tab, index) => {
                        const selected = activeTab === tab.key;
                        const count = tabCount(tab.key);
                        return (
                            <button
                                key={tab.key}
                                id={`people-tab-${tab.key}`}
                                type="button"
                                role="tab"
                                aria-selected={selected}
                                aria-controls={`people-panel-${tab.key}`}
                                tabIndex={selected ? 0 : -1}
                                onClick={() => navigateTab(tab.key)}
                                onMouseEnter={() => preloadTab(tab.key)}
                                onFocus={() => preloadTab(tab.key)}
                                onKeyDown={(event) => handleTabKeyDown(event, index)}
                                className={cn(
                                    "nb-ui-label relative inline-flex shrink-0 items-center gap-2 px-2 pb-3 transition-colors max-md:min-h-11 max-md:pb-0",
                                    selected ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                                )}
                            >
                                {tab.label}
                                {count !== null ? <span className="nb-meta">{count}</span> : null}
                                {selected ? <span className="absolute inset-x-0 -bottom-px h-0.5 bg-primary" aria-hidden="true" /> : null}
                            </button>
                        );
                    })}
                </div>

                <div id={`people-panel-${activeTab}`} role="tabpanel" aria-labelledby={`people-tab-${activeTab}`} className="pt-[18px]">
                    {!isAuthed && activeTab !== "suggested" ? (
                        <div className="max-w-[620px] rounded-lg border border-border bg-card p-8 text-center">
                            <h2 className="nb-card-title text-foreground">Sign in to view your {activeTab}</h2>
                            <p className="mt-1 text-sm text-muted-foreground">You need to be signed in to see and manage your network {activeTab}.</p>
                            <Link
                                href={`/login?redirect=${encodeURIComponent(`${ROUTES.NETWORK}?tab=${activeTab}`)}`}
                                className="nb-touch-target mt-4 inline-flex h-[var(--ui-control-height)] items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                            >
                                Sign in
                            </Link>
                        </div>
                    ) : (
                        <>
                            {activeTab === "suggested" ? (
                                <ComponentErrorBoundary fallbackMessage="Failed to load suggested people.">
                                    <NetworkPeopleTab initialUser={initialUser} searchQuery={routeQuery} />
                                </ComponentErrorBoundary>
                            ) : null}

                            {activeTab === "invitations" ? (
                                <ComponentErrorBoundary fallbackMessage="Failed to load invitations.">
                                    <InvitationsClient initialUser={initialUser} searchQuery={routeQuery} />
                                </ComponentErrorBoundary>
                            ) : null}

                            {activeTab === "connections" ? (
                                <ComponentErrorBoundary fallbackMessage="Failed to load connections.">
                                    <ConnectionsClient searchQuery={routeQuery} />
                                </ComponentErrorBoundary>
                            ) : null}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

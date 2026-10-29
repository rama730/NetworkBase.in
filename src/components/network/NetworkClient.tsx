"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { NetworkFilters, NetworkFilterChips } from "./NetworkFilters";
import {
    networkTab,
    readNetworkQuery,
    writeNetworkQuery,
    switchNetworkTab,
    clearedNetworkFilters,
    type NetworkTab as TabKey,
    type NetworkBrowseQuery,
} from "@/lib/network/browse-query";
import { SearchField } from "@/components/ui/SearchField";
import { useDebounce } from "use-debounce";

import { ComponentErrorBoundary } from "@/components/ui/ComponentErrorBoundary";
import { NetworkRouteSkeleton } from "./NetworkRouteSkeleton";
import { PersonCardSkeleton } from "@/components/network/PersonCardSkeleton";
import NetworkPeopleTab from "@/components/network/NetworkPeopleTab";
import { useNetworkNotifications } from "@/hooks/useNetworkNotifications";
import { normalizeSearchQuery } from "@/lib/search/query";
import { cn } from "@/lib/utils";
import { ROUTES } from "@/constants/routes";
import { RailSection } from "@/components/ui/rail-section";
import { LegalLinks } from "@/components/legal/LegalLinks";
import { useBottomStickyRail } from "@/hooks/useBottomStickyRail";

const TabLoading = () => (
    <div
        className="nb-person-card-grid grid grid-cols-1 gap-[14px] sm:grid-cols-2"
        role="status"
        aria-label="Loading tab content"
        aria-hidden="true"
    >
        <span className="sr-only">Loading tab content…</span>
        {[1, 2, 3, 4].map((item) => (
            <PersonCardSkeleton key={item} />
        ))}
    </div>
);

const loadConnectionsClient = () =>
    import("@/components/network/ConnectionsClient");
const loadInvitationsClient = () =>
    import("@/components/network/InvitationsClient");
const ConnectionsClient = dynamic(loadConnectionsClient, {
    ssr: false,
    loading: TabLoading,
});
const InvitationsClient = dynamic(loadInvitationsClient, {
    ssr: false,
    loading: TabLoading,
});

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

export default function NetworkClient({ initialUser }: NetworkClientProps) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { pendingConnections, pendingInvites, pendingApplications, totalConnections } =
        useNetworkNotifications();
    const isAuthed = Boolean(initialUser?.id);
    const tabParam = (searchParams?.get("tab") || "").toLowerCase();
    const activeTab: TabKey = networkTab(tabParam);
    const [initialLoadPending, setInitialLoadPending] = useState(
        isAuthed || activeTab === "suggested",
    );
    const markInitialReady = useCallback(
        () => setInitialLoadPending(false),
        [],
    );
    const query = readNetworkQuery(
        searchParams ?? new URLSearchParams(),
        activeTab,
    );
    const routeQuery = searchParams?.get("q") ?? query.q;
    const [searchValue, setSearchValue] = useState(routeQuery);
    const [shownQuery, setShownQuery] = useState(routeQuery);
    const [tabLoading, setTabLoading] = useState(false);
    const [debouncedSearchValue] = useDebounce(searchValue, 300);
    const stickyRail = useBottomStickyRail();

    const isSearching = normalizeSearchQuery(searchValue) !== routeQuery || tabLoading;

    // URL navigation updates the field without replaying an older debounced search.
    if (routeQuery !== shownQuery) {
        setShownQuery(routeQuery);
        if (routeQuery !== normalizeSearchQuery(searchValue))
            setSearchValue(routeQuery);
    }

    const visibleTabs = useMemo(
        () => TAB_CONFIG.filter((tab) => (tab.requiresAuth ? isAuthed : true)),
        [isAuthed],
    );

    useEffect(() => {
        const nextQuery = normalizeSearchQuery(debouncedSearchValue);
        if (
            nextQuery === routeQuery ||
            nextQuery !== normalizeSearchQuery(searchValue)
        )
            return;
        const params = new URLSearchParams(searchParams?.toString() || "");
        writeNetworkQuery(params, activeTab, { q: nextQuery });
        router.replace(
            `${ROUTES.NETWORK}${params.size ? `?${params.toString()}` : ""}`,
            { scroll: false },
        );
    }, [
        debouncedSearchValue,
        searchValue,
        routeQuery,
        router,
        searchParams,
        activeTab,
    ]);

    function tabCount(tab: TabKey) {
        if (tab === "invitations") return pendingConnections + pendingInvites + pendingApplications;
        if (tab === "connections") return totalConnections;
        return null;
    }

    function updateQuery(patch: Partial<NetworkBrowseQuery>) {
        const params = writeNetworkQuery(
            new URLSearchParams(searchParams?.toString() || ""),
            activeTab,
            patch,
        );
        if (patch.q !== undefined) setSearchValue(patch.q);
        router.push(
            `${ROUTES.NETWORK}${params.size ? "?" + params.toString() : ""}`,
            { scroll: false },
        );
    }
    function resetResults() {
        updateQuery({ ...clearedNetworkFilters(), q: "" });
    }
    function navigateTab(next: TabKey) {
        if (next === activeTab) return;
        setTabLoading(false);
        const params = new URLSearchParams(searchParams?.toString() || "");
        // Preserve the latest keystrokes even when switching before the debounce fires.
        writeNetworkQuery(params, activeTab, { q: searchValue });
        switchNetworkTab(params, next);
        setSearchValue(readNetworkQuery(params, next).q);
        router.push(`${ROUTES.NETWORK}?${params.toString()}`, {
            scroll: false,
        });
    }

    function handleTabKeyDown(
        event: React.KeyboardEvent<HTMLButtonElement>,
        index: number,
    ) {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
            return;
        event.preventDefault();
        const nextIndex =
            event.key === "Home"
                ? 0
                : event.key === "End"
                  ? visibleTabs.length - 1
                  : (index +
                        (event.key === "ArrowRight" ? 1 : -1) +
                        visibleTabs.length) %
                    visibleTabs.length;
        const next = visibleTabs[nextIndex];
        if (!next) return;
        preloadTab(next.key);
        navigateTab(next.key);
        document.getElementById(`people-tab-${next.key}`)?.focus();
    }

    return (
        <>
            {initialLoadPending ? <NetworkRouteSkeleton /> : null}
            <div
                hidden={initialLoadPending}
                className="nb-network-page min-h-full bg-background px-4 sm:px-6"
            >
                <div className="mx-auto w-full max-w-[1240px] pb-8 pt-6">
                    <div className="nb-network-columns">
                        <div className="nb-network-main min-w-0">
                            <header className="min-w-0">
                                <h1 className="nb-page-title">Network</h1>
                                <p className="nb-body mt-1 text-muted-foreground">
                                    People you’ve worked with, and people
                                    worth working with.
                                </p>
                            </header>

                            <div className="nb-network-toolbar mt-4 flex min-w-0 flex-wrap-reverse items-start gap-2 border-b border-border">
                                <div
                                    className="-mb-px self-end flex max-w-full min-w-0 shrink-0 items-stretch gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                                    role="tablist"
                                    aria-label="Network sections"
                                >
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
                                                onClick={() =>
                                                    navigateTab(tab.key)
                                                }
                                                onMouseEnter={() =>
                                                    preloadTab(tab.key)
                                                }
                                                onFocus={() =>
                                                    preloadTab(tab.key)
                                                }
                                                onKeyDown={(event) =>
                                                    handleTabKeyDown(
                                                        event,
                                                        index,
                                                    )
                                                }
                                                className={cn(
                                                    "nb-ui-label inline-flex min-h-11 shrink-0 items-center gap-2 border-b-2 px-2 py-3 transition-colors",
                                                    selected
                                                        ? "border-primary text-foreground"
                                                        : "border-transparent text-muted-foreground hover:text-foreground",
                                                )}
                                            >
                                                {tab.label}
                                                {count !== null ? (
                                                    <span className="nb-meta">
                                                        {count}
                                                    </span>
                                                ) : null}
                                            </button>
                                        );
                                    })}
                                </div>
                                <div className="nb-network-controls mb-2 flex max-w-full min-w-0 flex-wrap items-center gap-2">
                                    <SearchField
                                        pageSearch={!initialLoadPending}
                                        value={searchValue}
                                        loading={isSearching}
                                        onChange={setSearchValue}
                                        label={
                                            activeTab === "suggested"
                                                ? "Search people"
                                                : activeTab === "invitations"
                                                  ? "Search invitations"
                                                  : "Search connections"
                                        }
                                        className="w-64 max-w-full"
                                    />
                                    <NetworkFilters
                                        key={activeTab}
                                        tab={activeTab}
                                        query={query}
                                        onApply={updateQuery}
                                    />
                                </div>
                            </div>
                            <NetworkFilterChips
                                query={query}
                                onChange={updateQuery}
                            />

                            <div
                                id={`people-panel-${activeTab}`}
                                role="tabpanel"
                                aria-labelledby={`people-tab-${activeTab}`}
                                className="pt-4"
                            >
                                {!isAuthed && activeTab !== "suggested" ? (
                                    <div className="max-w-[620px] rounded-lg border border-border bg-card p-8 text-center">
                                        <h2 className="nb-card-title text-foreground">
                                            Sign in to view your {activeTab}
                                        </h2>
                                        <p className="mt-1 text-sm text-muted-foreground">
                                            You need to be signed in to see and
                                            manage your network {activeTab}.
                                        </p>
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
                                            <ComponentErrorBoundary
                                                onError={markInitialReady}
                                                fallbackMessage="Failed to load suggested people."
                                            >
                                                <NetworkPeopleTab
                                                    initialUser={initialUser}
                                                    searchQuery={routeQuery}
                                                    query={query}
                                                    onReset={resetResults}
                                                    onReady={markInitialReady}
                                                    onLoadingChange={setTabLoading}
                                                />
                                            </ComponentErrorBoundary>
                                        ) : null}

                                        {activeTab === "invitations" ? (
                                            <ComponentErrorBoundary
                                                onError={markInitialReady}
                                                fallbackMessage="Failed to load invitations."
                                            >
                                                <InvitationsClient
                                                    initialUser={initialUser}
                                                    searchQuery={routeQuery}
                                                    query={query}
                                                    onReset={resetResults}
                                                    onReady={markInitialReady}
                                                    onLoadingChange={setTabLoading}
                                                />
                                            </ComponentErrorBoundary>
                                        ) : null}

                                        {activeTab === "connections" ? (
                                            <ComponentErrorBoundary
                                                onError={markInitialReady}
                                                fallbackMessage="Failed to load connections."
                                            >
                                                <ConnectionsClient
                                                    searchQuery={routeQuery}
                                                    query={query}
                                                    onReset={resetResults}
                                                    onReady={markInitialReady}
                                                    onLoadingChange={setTabLoading}
                                                />
                                            </ComponentErrorBoundary>
                                        ) : null}
                                    </>
                                )}
                            </div>
                            <div className="nb-network-mobile-footer pt-6">
                                <LegalLinks
                                    align="start"
                                    showCopyright
                                    className="text-[11px]"
                                />
                            </div>
                        </div>
                        <aside
                            {...stickyRail}
                            aria-label="Network overview"
                            className="nb-network-rail sticky self-start space-y-4"
                        >
                            <RailSection title="Your network">
                                {isAuthed ? (
                                    <div className="space-y-1">
                                        {[
                                            {
                                                label: "Connections",
                                                count: totalConnections,
                                                tab: "connections" as const,
                                            },
                                            {
                                                label: "Connection requests",
                                                count: pendingConnections,
                                                tab: "invitations" as const,
                                            },
                                            {
                                                label: "Project invitations",
                                                count: pendingInvites,
                                                tab: "invitations" as const,
                                            },
                                            {
                                                label: "Project applications",
                                                count: pendingApplications,
                                                tab: "invitations" as const,
                                            },
                                        ].map((item) => (
                                            <button
                                                key={item.label}
                                                type="button"
                                                onClick={() =>
                                                    navigateTab(item.tab)
                                                }
                                                className="nb-compact flex min-h-11 w-full items-center justify-between gap-3 rounded-md px-2 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                                            >
                                                <span>{item.label}</span>
                                                <span className="nb-meta">
                                                    {item.count}
                                                </span>
                                            </button>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="space-y-3">
                                        <p className="nb-compact text-muted-foreground">
                                            Sign in to manage your connections
                                            and invitations.
                                        </p>
                                        <Link
                                            href={`/login?redirect=${encodeURIComponent(ROUTES.NETWORK)}`}
                                            className="nb-compact text-primary hover:underline"
                                        >
                                            Sign in
                                        </Link>
                                    </div>
                                )}
                            </RailSection>
                            <LegalLinks
                                align="start"
                                showCopyright
                                className="text-[11px]"
                            />
                        </aside>
                    </div>
                </div>
            </div>
        </>
    );
}

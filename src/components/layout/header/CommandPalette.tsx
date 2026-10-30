"use client";

import { confirmAppNavigation } from "@/lib/navigation/confirm-navigation";

import { CONNECTION_COPY } from "@/lib/connections/copy";
import { History, RotateCcw, Search, ShieldCheck, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "@/lib/feedback";

import { SkillIcon } from "@/components/skills";
import { AppScrollArea } from "@/components/ui/AppScrollArea";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { isGlobalSearchPreview, useGlobalSearchPreviews, type GlobalSearchPreview } from "@/hooks/useGlobalSearchPreviews";
import { getConnectionRequestSuccessMessage, useConnectionMutations } from "@/hooks/useConnections";
import { resolveClientSkill, useSkillCatalog } from "@/lib/skills/client";
import { SearchPreviewError } from "@/lib/search/contracts";
import {
    ProfileSearchResultCard,
    WorkspaceSearchResultCard,
    LinkSearchResultCard,
    SettingsSearchResultCard,
    TaskSearchResultCard,
    OrgSearchResultCard,
} from "./GlobalSearchResultCards";
import {
    buildGlobalSearchHref,
    getNetworkSearchScope,
    getWorkspaceIdentifierFromPathname,
    getGlobalSearchRecentScope,
    readRecentGlobalSearches,
    removeRecentGlobalSearch,
    rememberRecentGlobalSearch,
    rememberRecentGlobalSearchPreview,
    resolveGlobalSearchContext,
    searchSettings,
    type GlobalSearchContext,
    type RecentGlobalSearchItem,
    type SettingsSearchItem,
} from "./global-search";

type CommandPaletteProps = {
    isOpen: boolean;
    onClose: () => void;
    initialQuery?: string;
    context?: GlobalSearchContext;
    recentSearchOwnerId?: string;
};

const CONTEXT_PRESENTATION = {
    default: { label: "Discover / Workspaces", hints: ["Workspace name", "Technology", "Category"] },
    discover: { label: "Discover / Workspaces", hints: ["Workspace name", "Technology", "Category"] },
    network: { label: "Network / People", hints: ["Name", "Skill", "Location"] },
    project: { label: "Workspace / Work and Links", hints: ["Task title", "Link name", "Link category"] },
    settings: { label: "Settings", hints: ["Theme", "Privacy", "Integrations"] },
    messages: { label: "Messages", hints: [] },
} satisfies Record<GlobalSearchContext, { label: string; hints: string[] }>;

function resultDomId(result: GlobalSearchPreview | SettingsSearchItem, settings = false) {
    return `global-search-preview-${settings ? `settings-${result.id}` : result.id}`;
}

function SearchSkeletons() {
    return (
        <div className="space-y-2 p-3" role="status" aria-label="Loading search previews">
            <span className="sr-only">Loading search previews…</span>
            {[0, 1, 2].map((item) => (
                <div key={item} className="flex items-start gap-3 rounded-[8px] border border-border/60 bg-card p-3" aria-hidden="true">
                    <Skeleton className="size-10 shrink-0 rounded-[5px]" />
                    <div className="min-w-0 flex-1 space-y-2">
                        <Skeleton className="h-3 w-1/3 rounded-[3px]" />
                        <Skeleton className="h-2.5 w-3/4 rounded-[3px]" />
                        <Skeleton className="h-2.5 w-1/2 rounded-[3px]" />
                    </div>
                </div>
            ))}
        </div>
    );
}

function RecentSearchList({
    items,
    onSelectQuery,
    onOpenPreview,
    onConnect,
    connectingUserId,
    onRemove,
}: {
    items: RecentGlobalSearchItem[];
    onSelectQuery: (query: string) => void;
    onOpenPreview: (preview: GlobalSearchPreview) => void;
    onConnect: (result: Extract<GlobalSearchPreview, { kind: "profile" }>) => Promise<void>;
    connectingUserId?: string;
    onRemove: (key: string) => void;
}) {
    if (!items.length) return null;
    return (
        <section aria-labelledby="global-search-recents-heading">
            <p id="global-search-recents-heading" className="nb-micro uppercase tracking-[0.09em] text-muted-foreground">Recent searches</p>
            <div className="mt-2 space-y-1">
                {items.map((recent) => {
                    if (recent.kind === "preview" && isGlobalSearchPreview(recent.preview)) {
                        const interaction = { index: 0, activeIndex: -1, onActivate: () => undefined, onOpen: onOpenPreview, onRemove: () => onRemove(recent.key) };
                        if (recent.preview.kind === "project") return <WorkspaceSearchResultCard key={recent.key} result={recent.preview} {...interaction} />;
                        if (recent.preview.kind === "profile") return <ProfileSearchResultCard key={recent.key} result={recent.preview} {...interaction} onConnect={onConnect} isConnecting={connectingUserId === recent.preview.userId} />;
                        if (recent.preview.kind === "task") return <TaskSearchResultCard key={recent.key} result={recent.preview} {...interaction} />;
                        if (recent.preview.kind === "link") return <LinkSearchResultCard key={recent.key} result={recent.preview} {...interaction} />;
                        if (recent.preview.kind === "org") return <OrgSearchResultCard key={recent.key} result={recent.preview} {...interaction} />;
                    }
                    if (recent.kind !== "query") return null;
                    return (
                        <div key={recent.key} className="group relative flex min-h-10 items-center rounded-[8px] text-foreground transition-colors hover:bg-muted focus-within:bg-muted">
                            <button
                                type="button"
                                onClick={() => onSelectQuery(recent.query)}
                                className="flex min-h-10 min-w-0 flex-1 items-center gap-2.5 rounded-[8px] px-3 pr-12 text-left text-sm outline-none"
                                aria-label={`Use recent search ${recent.label}`}
                            >
                                <History className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                                <span className="truncate">{recent.label}</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => onRemove(recent.key)}
                                className="nb-touch-target absolute right-1.5 top-1/2 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-[5px] text-muted-foreground opacity-100 transition-[color,background-color,opacity] hover:bg-muted-foreground/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:pointer-events-none sm:opacity-0 sm:group-hover:pointer-events-auto sm:group-hover:opacity-100 sm:group-focus-within:pointer-events-auto sm:group-focus-within:opacity-100"
                                aria-label={`Remove ${recent.label} from recent searches`}
                            >
                                <X className="size-3.5" aria-hidden />
                            </button>
                        </div>
                    );
                })}
            </div>
        </section>
    );
}

export default function CommandPalette({ isOpen, onClose, initialQuery = "", context, recentSearchOwnerId = "" }: CommandPaletteProps) {
    useSkillCatalog();
    const queryClient = useQueryClient();
    const pathname = usePathname();
    const router = useRouter();
    const searchParams = useSearchParams();
    const [query, setQuery] = useState(initialQuery);
    const [activeIndex, setActiveIndex] = useState(-1);
    const [recentSearches, setRecentSearches] = useState<RecentGlobalSearchItem[]>([]);
    const { sendRequest } = useConnectionMutations();
    const paramsString = searchParams?.toString() ?? "";
    const currentParams = useMemo(() => new URLSearchParams(paramsString), [paramsString]);
    const routeContext = resolveGlobalSearchContext(pathname, currentParams);
    const searchContext = context ?? routeContext.context;
    const peopleScope = getNetworkSearchScope(currentParams);
    const projectIdentifier = getWorkspaceIdentifierFromPathname(pathname);
    const recentSearchScope = getGlobalSearchRecentScope(searchContext, peopleScope, projectIdentifier);
    const presentation = searchContext === "network" && peopleScope === "network"
        ? { label: "Connections / Network", hints: ["Connection name", "Username"] }
        : CONTEXT_PRESENTATION[searchContext];
    const palettePlaceholder = `Search ${presentation.label}…`;
    // Staff only (trust and safety C2): "trust" or a case number opens the console. Asked once per opening.
    const [isStaff, setIsStaff] = useState(false);
    useEffect(() => {
        if (!isOpen || !recentSearchOwnerId) return;
        void import("@/app/actions/moderation-staff").then(({ staffBadgeAction }) => staffBadgeAction()).then((badge) => setIsStaff(Boolean(badge)), () => setIsStaff(false));
    }, [isOpen, recentSearchOwnerId]);
    const staffCommand = useMemo(() => {
        if (!isStaff) return null;
        const q = query.trim();
        const caseNumber = q.match(/^nb-?(\d{1,9})$/i)?.[1];
        if (caseNumber) return { label: `Open case NB-${caseNumber}`, href: `/admin/trust?case=NB-${caseNumber}` };
        return q.length >= 2 && /^(t(r(u(st?)?)?)?|safety|report|reports|moderation|case|cases)/i.test(q) ? { label: "Open Trust and safety", href: "/admin/trust" } : null;
    }, [isStaff, query]);
    const normalizedQuery = query.trim();
    const settingsResults = useMemo(
        () => searchContext === "settings" ? searchSettings(query).slice(0, 10) : [],
        [query, searchContext],
    );
    const previews = useGlobalSearchPreviews({
        context: searchContext,
        query,
        enabled: isOpen,
        projectIdentifier,
        peopleScope,
    });
    const previewResults = previews.isDebouncing ? [] : previews.data ?? [];
    const orgResults = previewResults.map((result, index) => ({ result, index })).filter((entry): entry is { result: Extract<GlobalSearchPreview, { kind: "org" }>; index: number } => entry.result.kind === "org");
    const projectResults = previewResults.map((result, index) => ({ result, index })).filter((entry): entry is { result: Extract<GlobalSearchPreview, { kind: "project" }>; index: number } => entry.result.kind === "project");
    const profileResults = previewResults.map((result, index) => ({ result, index })).filter((entry): entry is { result: Extract<GlobalSearchPreview, { kind: "profile" }>; index: number } => entry.result.kind === "profile");
    const taskResults = previewResults.map((result, index) => ({ result, index })).filter((entry): entry is { result: Extract<GlobalSearchPreview, { kind: "task" }>; index: number } => entry.result.kind === "task");
    const linkResults = previewResults.map((result, index) => ({ result, index })).filter((entry): entry is { result: Extract<GlobalSearchPreview, { kind: "link" }>; index: number } => entry.result.kind === "link");
    const skillResults = previewResults.map((result, index) => ({ result, index })).filter((entry): entry is { result: Extract<GlobalSearchPreview, { kind: "skill" }>; index: number } => entry.result.kind === "skill");
    const supportsPreviews = searchContext === "discover" || searchContext === "network" || searchContext === "project" || searchContext === "default";
    const resultCount = searchContext === "settings" ? settingsResults.length : previewResults.length;
    const activeResult = searchContext === "settings" ? settingsResults[activeIndex] : previewResults[activeIndex];
    const isRateLimited = previews.error instanceof SearchPreviewError && previews.error.code === "RATE_LIMITED";

    useEffect(() => {
        if (!isOpen) return;
        setQuery(initialQuery);
        setActiveIndex(searchContext === "settings" ? 0 : -1);
    }, [initialQuery, isOpen, searchContext]);

    useEffect(() => {
        if (!isOpen) return;
        setRecentSearches(readRecentGlobalSearches(recentSearchOwnerId, recentSearchScope).filter(
            (recent) => recent.kind === "query" || isGlobalSearchPreview(recent.preview),
        ));
    }, [isOpen, recentSearchOwnerId, recentSearchScope]);

    useEffect(() => {
        setActiveIndex(searchContext === "settings" ? 0 : -1);
    }, [query, searchContext]);

    useEffect(() => {
        if (activeIndex < 0 || activeIndex >= resultCount) return;
        const result = searchContext === "settings" ? settingsResults[activeIndex] : previewResults[activeIndex];
        if (!result) return;
        document.getElementById(resultDomId(result, searchContext === "settings"))?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }, [activeIndex, previewResults, resultCount, searchContext, settingsResults]);

    useEffect(() => {
        const href = activeResult?.href;
        if (!isOpen || !href) return;
        const prefetchTimer = window.setTimeout(() => router.prefetch(href), 150);
        return () => window.clearTimeout(prefetchTimer);
    }, [activeResult?.href, isOpen, router]);

    const recordRecentSearch = (value: string) => {
        setRecentSearches(rememberRecentGlobalSearch(recentSearchOwnerId, recentSearchScope, value));
    };

    const recordRecentPreview = (value: GlobalSearchPreview) => {
        setRecentSearches(rememberRecentGlobalSearchPreview(recentSearchOwnerId, recentSearchScope, value));
    };

    const removeRecentSearch = (key: string) => {
        setRecentSearches(removeRecentGlobalSearch(recentSearchOwnerId, recentSearchScope, key));
    };

    const cancelActivePreviews = () => {
        const previewContext = searchContext === "default" ? "discover" : searchContext;
        queryClient.cancelQueries({
            queryKey: ["global-search", "previews", previewContext],
        });
    };

    const openSettingsResult = (result: SettingsSearchItem) => {
        if (!confirmAppNavigation()) return;
        cancelActivePreviews();
        recordRecentSearch(query);
        router.push(result.href);
        onClose();
    };

    const openPreviewResult = (result: GlobalSearchPreview) => {
        if (result.kind !== "link" && !confirmAppNavigation()) return;
        cancelActivePreviews();
        if (result.kind === "skill") recordRecentSearch(result.title);
        else recordRecentPreview(result);
        if (result.kind === "link") {
            window.open(result.href, "_blank", "noopener,noreferrer");
            onClose();
            return;
        }
        router.push(result.href);
        onClose();
    };

    const connectProfile = async (result: Extract<GlobalSearchPreview, { kind: "profile" }>) => {
        try {
            await toast.promise(sendRequest.mutateAsync({ userId: result.userId }), {
                loading: CONNECTION_COPY.sending,
                success: (response) => getConnectionRequestSuccessMessage(response.status),
                error: (error) => error instanceof Error ? error.message : CONNECTION_COPY.sendFailed,
            }).unwrap();
        } catch {
            // The shared mutation and toast already restore and report the failed state.
        }
    };

    const searchAll = () => {
        const href = buildGlobalSearchHref({
            pathname: pathname || "/",
            searchParams: currentParams,
            context: searchContext,
            query,
        });
        if (!href || !confirmAppNavigation()) return;
        cancelActivePreviews();
        recordRecentSearch(query);
        router.push(href);
        onClose();
    };

    const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (searchContext === "settings") {
            const result = settingsResults[activeIndex] ?? settingsResults[0];
            if (result) openSettingsResult(result);
            return;
        }
        const preview = activeIndex >= 0 ? previewResults[activeIndex] : undefined;
        if (preview) {
            openPreviewResult(preview);
            return;
        }
        searchAll();
    };

    const moveActive = (direction: 1 | -1) => {
        if (!resultCount) return;
        setActiveIndex((current) => current < 0
            ? direction === 1 ? 0 : resultCount - 1
            : (current + direction + resultCount) % resultCount);
    };

    const moveWithinSkills = (direction: 1 | -1) => {
        if (!skillResults.length) return false;
        const currentSkillPosition = skillResults.findIndex(({ index }) => index === activeIndex);
        if (currentSkillPosition < 0) return false;
        const next = skillResults[(currentSkillPosition + direction + skillResults.length) % skillResults.length];
        if (next) setActiveIndex(next.index);
        return true;
    };

    const resultLabel = projectResults.length
        ? `Workspaces · ${projectResults.length}`
        : profileResults.length
            ? `People · ${profileResults.length}`
            : taskResults.length
                ? `Tasks · ${taskResults.length}`
                : linkResults.length
                    ? `Workspace Links · ${linkResults.length}`
                    : settingsResults.length
                        ? `Settings · ${settingsResults.length}`
                        : "Results";

    return (
        <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
            <DialogContent
                showCloseButton={false}
                data-command-palette-dialog=""
                overlayClassName="bg-black/45 backdrop-blur-[2px]"
                className="left-0 top-0 flex h-dvh w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 p-0 shadow-2xl duration-[130ms] motion-reduce:duration-0 focus:outline-none focus-visible:outline-none focus-visible:ring-0 sm:left-1/2 sm:top-[12%] sm:h-auto sm:max-h-[76dvh] sm:w-[min(640px,calc(100vw-2rem))] sm:max-w-[640px] sm:-translate-x-1/2 sm:translate-y-0 sm:rounded-[12px] sm:border sm:border-border sm:bg-card"
                aria-describedby="topnav-search-description"
                style={{ outline: "none" }}
            >
                <DialogTitle className="sr-only">{presentation.label}</DialogTitle>
                <DialogDescription id="topnav-search-description" className="sr-only">{routeContext.description}</DialogDescription>

                <form onSubmit={handleSubmit} className="flex min-h-0 min-w-0 flex-1 flex-col bg-card">
                    <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4 sm:px-5">
                        <Search className="size-[18px] shrink-0 text-muted-foreground" aria-hidden />
                        <input
                            autoFocus
                            type="search"
                            autoComplete="off"
                            maxLength={100}
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === "ArrowDown") {
                                    event.preventDefault();
                                    moveActive(1);
                                } else if (event.key === "ArrowUp") {
                                    event.preventDefault();
                                    moveActive(-1);
                                } else if (event.key === "ArrowRight" && moveWithinSkills(1)) {
                                    event.preventDefault();
                                } else if (event.key === "ArrowLeft" && moveWithinSkills(-1)) {
                                    event.preventDefault();
                                }
                            }}
                            placeholder={palettePlaceholder}
                            className="nb-command-input h-full min-w-0 flex-1 border-0 bg-transparent text-[15px] font-medium text-foreground outline-none ring-0 shadow-none focus:border-0 focus:outline-none focus:ring-0 focus:shadow-none focus-visible:border-0 focus-visible:outline-none focus-visible:ring-0 placeholder:font-normal placeholder:text-muted-foreground/60 [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden"
                            style={{ outline: "none", boxShadow: "none" }}
                            aria-label={palettePlaceholder}
                            role="combobox"
                            aria-expanded={isOpen}
                            aria-autocomplete="list"
                            aria-busy={previews.isFetching || previews.isDebouncing}
                            aria-controls={searchContext === "settings" ? "settings-search-results" : supportsPreviews && normalizedQuery ? "global-search-preview-results" : undefined}
                            aria-activedescendant={activeResult ? resultDomId(activeResult, searchContext === "settings") : undefined}
                        />
                        {normalizedQuery ? (
                            <>
                                <button type="button" onClick={() => setQuery("")} className="nb-touch-target inline-flex size-7 items-center justify-center rounded-[5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" aria-label="Clear search">
                                    <X className="size-4" aria-hidden />
                                </button>
                                <span data-testid="global-search-enter-hint" aria-hidden className="inline-flex shrink-0 items-center gap-1 rounded-[3px] border border-border bg-muted/60 px-2 py-0.5 text-[11px] font-mono font-medium text-muted-foreground">
                                    <span className="hidden sm:inline">Enter</span><kbd>↵</kbd>
                                </span>
                            </>
                        ) : (
                            <button type="button" onClick={onClose} className="nb-touch-target inline-flex h-7 shrink-0 items-center justify-center rounded-[3px] border border-border bg-muted/60 px-2 text-[11px] font-mono font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" aria-label="Close search">
                                <kbd>Esc</kbd>
                            </button>
                        )}
                    </div>

                    <div className="sr-only" aria-live="polite">{previews.isDebouncing
                        ? ""
                        : previews.isFetching && resultCount === 0
                            ? "Searching"
                            : normalizedQuery.length >= 2
                                ? `${resultCount} preview results`
                                : "Type at least two characters to preview results"}</div>

                    {staffCommand ? (
                        <div className="shrink-0 border-b border-border p-2">
                            <button type="button" onClick={() => { onClose(); router.push(staffCommand.href); }}
                                className="flex min-h-10 w-full items-center gap-2.5 rounded-[8px] px-3 text-left text-sm text-foreground transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none">
                                <ShieldCheck className="size-4 text-muted-foreground" aria-hidden="true" />
                                <span className="flex-1">{staffCommand.label}</span>
                                <span className="nb-meta">Staff</span>
                            </button>
                        </div>
                    ) : null}

                    {searchContext === "settings" ? (
                        <div className="flex min-h-0 flex-1 flex-col sm:max-h-[480px]">
                            {!normalizedQuery && recentSearches.length ? (
                                <div className="shrink-0 border-b border-border px-5 py-4">
                                    <RecentSearchList items={recentSearches} onSelectQuery={setQuery} onOpenPreview={openPreviewResult} onConnect={connectProfile} connectingUserId={sendRequest.isPending ? sendRequest.variables?.userId : undefined} onRemove={removeRecentSearch} />
                                </div>
                            ) : null}
                            <AppScrollArea id="settings-search-results" axis="y" role="listbox" aria-label="Settings search results" className="min-h-0 flex-1 p-2">
                                <div className="flex items-center justify-between px-3 pb-1.5 pt-2">
                                    <span className="nb-micro uppercase tracking-[0.09em] text-muted-foreground">Settings · {settingsResults.length}</span>
                                </div>
                                {settingsResults.length ? settingsResults.map((result, index) => (
                                    <SettingsSearchResultCard key={result.id} result={result} index={index} activeIndex={activeIndex} onActivate={setActiveIndex} onOpen={openSettingsResult} />
                                )) : (
                                    <div className="px-5 py-12 text-center">
                                        <p className="text-sm font-medium text-foreground">No setting matches “{normalizedQuery}”.</p>
                                        <p className="mt-1 text-xs text-muted-foreground">Try theme, privacy, notifications, or editor.</p>
                                    </div>
                                )}
                            </AppScrollArea>
                        </div>
                    ) : supportsPreviews ? (
                        <AppScrollArea id="global-search-preview-results" axis="y" role={normalizedQuery ? "listbox" : "region"} aria-busy={previews.isFetching || previews.isDebouncing} aria-label={normalizedQuery ? searchContext === "network" ? "People results" : searchContext === "project" ? "Task search results" : "Workspace search results" : "Search guidance and recent searches"} className="min-h-0 min-w-0 flex-1 sm:max-h-[480px]">
                            {normalizedQuery.length === 0 ? (
                                <div className="px-5 pt-3 pb-6 sm:pt-3 sm:pb-6">
                                    {recentSearches.length ? (
                                        <RecentSearchList items={recentSearches} onSelectQuery={setQuery} onOpenPreview={openPreviewResult} onConnect={connectProfile} connectingUserId={sendRequest.isPending ? sendRequest.variables?.userId : undefined} onRemove={removeRecentSearch} />
                                    ) : (
                                        /* Hide Search by options when recent searches are present */
                                        <div>
                                            <p className="nb-micro uppercase tracking-[0.09em] text-muted-foreground">Search by</p>
                                            <div className="mt-2.5 flex flex-wrap gap-1.5">
                                                {presentation.hints.map((hint) => (
                                                    <span key={hint} className="rounded-[3px] border border-border bg-muted/50 px-2.5 py-1 font-mono text-xs text-muted-foreground">
                                                        {hint}
                                                    </span>
                                                ))}
                                            </div>
                                            <p className="mt-4 nb-meta text-xs text-muted-foreground/80">Start typing to preview matching {searchContext === "network" ? "builders" : searchContext === "project" ? "tasks" : "projects"}.</p>
                                        </div>
                                    )}
                                </div>
                            ) : normalizedQuery.length < 2 ? (
                                <div className="px-5 py-5 nb-meta text-xs text-muted-foreground">Type one more character to preview results.</div>
                            ) : previews.isDebouncing || previews.isFetching && previewResults.length === 0 ? (
                                <SearchSkeletons />
                            ) : previews.isError ? (
                                <div className="flex flex-col items-center px-5 py-12 text-center">
                                    <span className="flex size-10 items-center justify-center rounded-[5px] bg-amber-500/10 text-amber-600 dark:text-amber-400">
                                        <RotateCcw className="size-4" aria-hidden />
                                    </span>
                                    <p className="mt-3 text-sm font-medium text-foreground">{isRateLimited ? "Search is temporarily paused" : "Preview unavailable"}</p>
                                    <p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">{isRateLimited ? "Wait a moment before trying again." : "Retry the preview or press Enter to run the full search without losing your query."}</p>
                                    {!isRateLimited ? (
                                        <button type="button" onClick={() => void previews.refetch()} className="mt-3 inline-flex items-center gap-2 rounded-[5px] border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted">
                                            <RotateCcw className="size-3.5" aria-hidden />
                                            Retry preview
                                        </button>
                                    ) : null}
                                </div>
                            ) : previewResults.length === 0 ? (
                                <div className="px-5 py-12 text-center">
                                    <p className="text-sm font-medium text-foreground">No {searchContext === "network" ? "builders" : searchContext === "project" ? "workspace work or links" : "projects"} match “{normalizedQuery}”.</p>
                                    <p className="mt-1 text-xs text-muted-foreground">Try a {presentation.hints.map((hint) => hint.toLowerCase()).join(", ")}.</p>
                                </div>
                            ) : (
                                <div className="p-2">
                                    <div className="flex items-center justify-between px-3 pb-1.5 pt-2">
                                        <span className="nb-micro uppercase tracking-[0.09em] text-muted-foreground">{resultLabel}</span>
                                        {previews.isFetching ? <span className="nb-meta text-[11px] text-muted-foreground/70">Refreshing…</span> : null}
                                    </div>
                                    {orgResults.map(({ result, index }) => <OrgSearchResultCard key={result.id} result={result} index={index} activeIndex={activeIndex} onActivate={setActiveIndex} onOpen={openPreviewResult} />)}
                                    {projectResults.map(({ result, index }) => <WorkspaceSearchResultCard key={result.id} result={result} index={index} activeIndex={activeIndex} onActivate={setActiveIndex} onOpen={openPreviewResult} />)}
                                    {profileResults.map(({ result, index }) => <ProfileSearchResultCard key={result.id} result={result} index={index} activeIndex={activeIndex} onActivate={setActiveIndex} onOpen={openPreviewResult} onConnect={connectProfile} isConnecting={sendRequest.isPending && sendRequest.variables?.userId === result.userId} />)}
                                    {taskResults.map(({ result, index }) => <TaskSearchResultCard key={result.id} result={result} index={index} activeIndex={activeIndex} onActivate={setActiveIndex} onOpen={openPreviewResult} />)}
                                    {linkResults.map(({ result, index }) => <LinkSearchResultCard key={result.id} result={result} index={index} activeIndex={activeIndex} onActivate={setActiveIndex} onOpen={openPreviewResult} />)}
                                    {skillResults.length ? (
                                        <div className="mt-2 border-t border-border pt-3">
                                            <div className="flex items-center justify-between px-3 pb-2">
                                                <span className="nb-micro uppercase tracking-[0.09em] text-muted-foreground">Skills in these workspaces</span>
                                            </div>
                                            <div className="relative before:pointer-events-none before:absolute before:left-0 before:top-0 before:z-10 before:h-full before:w-6 before:bg-gradient-to-r before:from-card before:to-transparent after:pointer-events-none after:absolute after:right-0 after:top-0 after:z-10 after:h-full after:w-8 after:bg-gradient-to-l after:from-card after:to-transparent">
                                                <AppScrollArea axis="x" variant="hidden" stableGutter={false} className="flex w-full min-w-0 flex-nowrap gap-1.5 px-3 pb-2" data-testid="related-skills-scroll">
                                                    {skillResults.map(({ result, index }) => (
                                                        <button
                                                            id={resultDomId(result)}
                                                            key={result.id}
                                                            type="button"
                                                            role="option"
                                                            tabIndex={-1}
                                                            aria-selected={index === activeIndex}
                                                            onMouseEnter={() => setActiveIndex(index)}
                                                            onFocus={() => setActiveIndex(index)}
                                                            onClick={() => openPreviewResult(result)}
                                                            className={`nb-touch-target inline-flex h-[28px] shrink-0 items-center gap-1.5 rounded-[3px] border px-2.5 text-xs font-mono transition-colors ${index === activeIndex ? "border-primary/40 bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground"}`}
                                                        >
                                                            <SkillIcon skill={resolveClientSkill(result.title)} size={14} />{result.title}
                                                        </button>
                                                    ))}
                                                </AppScrollArea>
                                            </div>
                                        </div>
                                    ) : null}
                                </div>
                            )}
                        </AppScrollArea>
                    ) : null}

                </form>
            </DialogContent>
        </Dialog>
    );
}

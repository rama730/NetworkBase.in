"use client";

import { memo, useCallback, useEffect, useId, useMemo, useReducer, useRef, useState, type KeyboardEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ClipboardList, Copy, ExternalLink, FileText, Hash, Link2, SquareTerminal, Plus, X, Search, Loader2, Pencil } from "lucide-react";
import { Virtuoso } from "react-virtuoso";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { toast } from "sonner";

import {
    normalizeReadmeReferenceLabel,
    type ProjectDocInlineReference,
    type ProjectDocReferenceOption,
    type ProjectDocSmartBlockPreview,
} from "@/lib/projects/doc-blocks";
import { normalizeProjectDocSlug, type ProjectDocHeading } from "@/lib/projects/doc";
import {
    PROJECT_DOC_PRIMARY_COMMAND_GROUPS,
    type ProjectDocCommandGroup,
    type ProjectDocQuickCommand,
    type ProjectDocRailReport,
} from "@/lib/projects/doc-quick-console";
import type { ProjectDocRailAction, ProjectDocRailTabId } from "@/lib/projects/doc-view-model";
import { buildProjectDocPlainText } from "@/lib/projects/doc-plain-text";
import { cn } from "@/lib/utils";
import { useProjectMarkdowns } from "@/hooks/hub/useProjectDocData";
import { readProjectMarkdownSearchAction } from "@/app/actions/project";


type ReadmeRailVariant = "rail" | "compact";

const COMMAND_GROUP_ORDER: ProjectDocCommandGroup[] = [
    "recommended",
    "install",
    "claude",
    "agents",
    "config",
    "options",
    "uninstall",
    "develop",
    "quality",
    "deploy",
    "database",
    "other",
];
const LARGE_RAIL_LIST_THRESHOLD = 80;

function groupCommandsByIntent(commands: ProjectDocQuickCommand[]) {
    const grouped = new Map<ProjectDocCommandGroup, ProjectDocQuickCommand[]>();
    commands.forEach((command) => {
        const list = grouped.get(command.group) ?? [];
        list.push(command);
        grouped.set(command.group, list);
    });
    return Array.from(grouped.entries()).sort((a, b) => {
        const aIndex = COMMAND_GROUP_ORDER.indexOf(a[0]);
        const bIndex = COMMAND_GROUP_ORDER.indexOf(b[0]);
        return (aIndex < 0 ? COMMAND_GROUP_ORDER.length : aIndex) - (bIndex < 0 ? COMMAND_GROUP_ORDER.length : bIndex);
    });
}

function renderReadmeRailTabIcon(id: ProjectDocRailTabId) {
    const className = "h-3.5 w-3.5 shrink-0";
    switch (id) {
        case "brief": return <FileText className={className} />;
        case "commands": return <SquareTerminal className={className} />;
        case "links": return <Link2 className={className} />;
        case "outline": return <Hash className={className} />;
        case "search": return <Search className={className} />;
        default: return <ClipboardList className={className} />;
    }
}

function cleanRailBriefText(value: string | null | undefined, maxLength = 360) {
    return buildProjectDocPlainText(value, { maxLength });
}

async function copyTextWithFallback(value: string) {
    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        return;
    }
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(textarea);
    if (!copied) throw new Error("Clipboard fallback failed");
}

type ReadmeRailState = {
    openTab: ProjectDocRailTabId | null;
    selectedActionId: string | null;
};

type ReadmeRailAction =
    | { type: "toggle_tab"; id: ProjectDocRailTabId }
    | { type: "close_tab" }
    | { type: "select_action"; actionId: string; closePanel: boolean }
    | { type: "sync_tabs"; availableTabIds: ProjectDocRailTabId[] };

function readmeRailReducer(state: ReadmeRailState, action: ReadmeRailAction): ReadmeRailState {
    switch (action.type) {
        case "toggle_tab":
            return { ...state, openTab: state.openTab === action.id ? null : action.id };
        case "close_tab":
            return { ...state, openTab: null };
        case "select_action":
            return { selectedActionId: action.actionId, openTab: action.closePanel ? null : state.openTab };
        case "sync_tabs":
            return state.openTab && !action.availableTabIds.includes(state.openTab)
                ? { ...state, openTab: null }
                : state;
        default:
            return state;
    }
}

function ReadmeRailTabButton({
    id,
    instanceId,
    label,
    count,
    active,
    onToggle,
}: {
    id: ProjectDocRailTabId;
    instanceId: string;
    label: string;
    count?: number | null;
    active: boolean;
    onToggle: (id: ProjectDocRailTabId) => void;
}) {
    return (
        <button
            type="button"
            id={`readme-rail-${instanceId}-tab-${id}`}
            role="tab"
            data-readme-rail-tab={id}
            aria-selected={active}
            aria-expanded={active}
            aria-controls={`readme-rail-${instanceId}-panel-${id}`}
            onClick={() => onToggle(id)}
            className={cn(
                "relative inline-flex h-[32px] min-w-0 items-center justify-center gap-1.5 rounded-[5px] border px-2.5 text-[12px] font-medium transition-colors focus-visible:outline-none",
                active
                    ? "border-primary bg-primary/10 text-primary font-semibold shadow-xs"
                    : "border-border bg-muted/40 text-muted-foreground hover:border-foreground/20 hover:text-foreground hover:bg-muted/70",
            )}
        >
            {renderReadmeRailTabIcon(id)}
            <span className="truncate">{label}</span>
            {typeof count === "number" ? (
                <span
                    className={cn(
                        "h-4 min-w-4 px-1 rounded-[3px] font-mono text-[10px] font-semibold uppercase tracking-wider inline-flex items-center justify-center",
                        active ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground",
                    )}
                >
                    {count}
                </span>
            ) : null}
        </button>
    );
}

const ReferenceRow = memo(function ReferenceRow({
    action,
    option,
    fallback,
    active,
    highlighted,
    onExecuteAction,
}: {
    action: ProjectDocRailAction;
    option?: ProjectDocReferenceOption | null;
    fallback: ProjectDocInlineReference;
    active: boolean;
    highlighted: boolean;
    onExecuteAction: (action: ProjectDocRailAction) => void;
}) {
    const label = normalizeReadmeReferenceLabel(fallback.kind, option?.title || fallback.label);
    const detail = option?.context || option?.status || option?.kindLabel || option?.subtitle || null;
    const stateLabel = action.previewLoading
        ? "Loading project link"
        : action.previewError
            ? "Could not load this project link"
            : action.openHref || detail
                ? null
                : "Private or missing project link";
    const content = (
        <>
            <span className="truncate text-[13px] font-semibold text-foreground">{label}</span>
            {action.previewLoading ? (
                <span aria-hidden="true" className="nb-skeleton mt-1 h-3 w-28 max-w-full rounded-[3px]">
                    <span className="sr-only">Loading project link</span>
                </span>
            ) : detail || stateLabel ? (
                <span
                    data-readme-preview-state={action.previewError ? "error" : stateLabel ? "unavailable" : "ready"}
                    className={cn(
                        "truncate text-xs",
                        action.previewError ? "text-destructive" : "text-muted-foreground",
                    )}
                >
                    {detail || stateLabel}
                </span>
            ) : null}
        </>
    );

    return (
        <div
            className={cn(
                "group flex min-w-0 items-center gap-1 rounded-[5px] transition-[background-color,box-shadow]",
                active && "bg-primary/10",
                highlighted && "ring-2 ring-primary/20",
            )}
        >
            <button
                type="button"
                onClick={() => onExecuteAction(action)}
                className="flex min-w-0 flex-1 items-center gap-2 rounded-[5px] px-2 py-1.5 text-left transition hover:bg-muted focus-visible:outline-none"
                aria-current={active ? "location" : undefined}
                title={`Show ${label}`}
            >
                <Link2 className={cn("size-3.5 shrink-0", active ? "text-primary" : "text-muted-foreground")} />
                <span className="flex min-w-0 flex-col">{content}</span>
            </button>
            {action.openHref ? (
                <a
                    href={action.openHref}
                    className="mr-1 inline-flex size-7 shrink-0 items-center justify-center rounded-[5px] text-muted-foreground transition hover:bg-card hover:text-foreground focus-visible:outline-none"
                    aria-label={`Open ${label}`}
                    title={`Open ${label}`}
                >
                    <ExternalLink className="size-3.5" />
                </a>
            ) : null}
        </div>
    );
});

const CommandShortcutRow = memo(function CommandShortcutRow({
    action,
    command,
    active,
    highlighted,
    copied,
    onExecuteAction,
}: {
    action: ProjectDocRailAction;
    command: ProjectDocQuickCommand;
    active: boolean;
    highlighted: boolean;
    copied: boolean;
    onExecuteAction: (action: ProjectDocRailAction) => void;
}) {
    const copyCommand = () => onExecuteAction(action);

    return (
        <div
            className={cn(
                "group flex min-w-0 items-stretch gap-1 rounded-[5px] border border-border bg-card p-1.5 transition-colors hover:border-foreground/20",
                active && "border-primary bg-primary/10 shadow-xs",
                highlighted && "ring-2 ring-primary/20",
            )}
        >
            <button
                type="button"
                onClick={copyCommand}
                aria-current={active ? "location" : undefined}
                className="min-w-0 flex-1 rounded-[3px] px-1.5 py-1 text-left outline-none transition"
                title={`Copy and show ${command.label}`}
            >
                <span className="mb-1.5 flex min-w-0 flex-wrap items-center gap-1.5">
                    <span
                        className={cn(
                            "min-w-0 break-words text-xs font-semibold text-foreground transition [overflow-wrap:anywhere]",
                            active && "text-primary",
                        )}
                    >
                        {command.label}
                    </span>
                    {command.detail ? (
                        <span className="max-w-full rounded-[3px] border border-border bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                            {command.detail}
                        </span>
                    ) : null}
                    {command.platforms.map((platform) => (
                        <span
                            key={platform}
                            className="max-w-full rounded-[3px] border border-border bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
                        >
                            {platform}
                        </span>
                    ))}
                    {command.ecosystemTags.map((tag) => (
                        <span
                            key={tag}
                            className="max-w-full rounded-[3px] border border-primary/20 bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-primary"
                        >
                            {tag}
                        </span>
                    ))}
                    <span
                        className={cn(
                            "max-w-full rounded-[3px] border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider font-semibold",
                            command.confidence === "high" && "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
                            command.confidence === "medium" && "border-sky-500/20 bg-sky-500/10 text-sky-700 dark:text-sky-400",
                            command.confidence === "low" && "border-border bg-muted text-muted-foreground",
                        )}
                    >
                        {command.confidenceLabel}
                    </span>
                    {command.riskLabel ? (
                        <span
                            className={cn(
                                "max-w-full rounded-[3px] border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider font-semibold",
                                command.riskLevel === "danger"
                                    ? "border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-400"
                                    : "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-400",
                            )}
                        >
                            {command.riskLabel}
                        </span>
                    ) : null}
                </span>
                <code
                    aria-current={active ? "location" : undefined}
                    className="block min-w-0 whitespace-pre-wrap break-words rounded-[3px] bg-muted/40 px-2 py-1.5 font-mono text-[11px] leading-5 text-foreground [overflow-wrap:anywhere]"
                >
                    {command.command}
                </code>
            </button>
            <button
                type="button"
                onClick={copyCommand}
                className={cn(
                    "inline-flex size-7 shrink-0 items-center justify-center rounded-[5px] border border-border bg-card text-muted-foreground transition hover:text-foreground hover:bg-muted focus-visible:outline-none",
                    active && "border-primary text-primary",
                )}
                aria-label={`Copy ${command.label}`}
                title={copied ? "Copied" : "Copy command"}
            >
                {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                <span className="sr-only" aria-live="polite">{copied ? "Copied" : "Copy command"}</span>
            </button>
        </div>
    );
});

const HeadingRow = memo(function HeadingRow({
    action,
    heading,
    active,
    highlighted,
    onExecuteAction,
}: {
    action: ProjectDocRailAction;
    heading: ProjectDocHeading;
    active: boolean;
    highlighted: boolean;
    onExecuteAction: (action: ProjectDocRailAction) => void;
}) {
    const showHeading = () => onExecuteAction(action);

    return (
        <a
            href={`#${heading.id}`}
            onClick={(event) => {
                event.preventDefault();
                showHeading();
            }}
            onKeyDown={(event) => {
                if (event.key !== " ") return;
                event.preventDefault();
                showHeading();
            }}
            aria-current={active ? "location" : undefined}
            className={cn(
                "block truncate rounded-[5px] px-2 py-1 text-[13px] text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground",
                heading.level > 2 && "pl-4 text-xs",
                heading.level > 3 && "pl-6",
                active && "bg-primary/10 font-semibold text-primary",
                highlighted && "ring-2 ring-primary/20",
            )}
        >
            {heading.text}
        </a>
    );
});

function DocumentSwitcher({
    projectId,
    activeSlug,
    }: {
    projectId: string;
    activeSlug: string;
    canEdit?: boolean;
    }) {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();

    const [isLinkDialogOpen, setIsLinkDialogOpen] = useState(false);

    const { data: markdowns = [], isLoading } = useProjectMarkdowns(projectId);

    // Client-side sorting fallback
    const sortedMarkdowns = useMemo(() => {
        return [...markdowns].sort((a, b) => {
            if (a.slug === "readme") return -1;
            if (b.slug === "readme") return 1;
            return a.filename.localeCompare(b.filename, undefined, { sensitivity: 'base', numeric: true });
        });
    }, [markdowns]);

    const handleSelect = (slug: string) => {
        const params = new URLSearchParams(searchParams ? searchParams.toString() : "");
        params.set("tab", "docs");
        params.set("doc", normalizeProjectDocSlug(slug));
        router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    };

    return (
        <div className={cn("grid gap-2 shrink-0 w-full mb-3", sortedMarkdowns.length > 4 ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-2")}>
            {isLoading ? (
                <div className="flex h-[34px] items-center justify-center px-3 text-muted-foreground text-xs gap-1.5 shrink-0">
                    <Loader2 className="size-3.5 animate-spin text-primary" />
                    Loading...
                </div>
            ) : (
                sortedMarkdowns.map((doc) => (
                    <button
                        key={doc.id}
                        type="button"
                        onClick={() => handleSelect(doc.slug)}
                        className={cn(
                            "inline-flex h-[34px] items-center justify-center rounded-[5px] border px-3 text-[13px] font-medium transition-colors truncate shrink-0 select-none",
                            doc.slug === activeSlug
                                ? "border-primary bg-primary/10 text-primary font-semibold shadow-xs"
                                : "border-border bg-card text-muted-foreground hover:border-foreground/20 hover:text-foreground hover:bg-muted/40",
                        )}
                    >
                        <FileText className="size-3.5 shrink-0 mr-1.5 text-muted-foreground" />
                        <span className="truncate">{doc.filename}</span>
                    </button>
                ))
            )}





        </div>
    );
}

function SearchPanel({ projectId, onSelectMatch }: { projectId: string; onSelectMatch: (docSlug: string, line: number) => void }) {
    const [query, setQuery] = useState("");
    const [results, setResults] = useState<any[]>([]);
    const [searching, setSearching] = useState(false);

    useEffect(() => {
        const trimmed = query.trim();
        if (!trimmed) {
            setResults([]);
            return;
        }

        const timer = setTimeout(async () => {
            setSearching(true);
            try {
                const res = await readProjectMarkdownSearchAction(projectId, trimmed);
                if (res.success) {
                    setResults(res.results);
                } else {
                    toast.error(res.error || "Search failed");
                }
            } catch (err) {
                console.error(err);
            } finally {
                setSearching(false);
            }
        }, 300);

        return () => clearTimeout(timer);
    }, [query, projectId]);

    return (
        <div className="space-y-4">
            <div className="relative">
                <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
                <input
                    type="text"
                    placeholder="Search docs..."
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className="h-[34px] w-full rounded-[5px] border border-border bg-card pl-9 pr-8 text-[13px] text-foreground placeholder:text-muted-foreground focus:border-foreground/30 focus:outline-none transition-colors"
                />
                {query && (
                    <button
                        type="button"
                        onClick={() => setQuery("")}
                        className="absolute right-2 top-2 p-0.5 rounded-[3px] hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                    >
                        <X className="size-3" />
                    </button>
                )}
            </div>

            <div className="space-y-4 max-h-[24rem] overflow-y-auto pr-1 app-scroll app-scroll-y">
                {searching ? (
                    <div className="flex items-center justify-center py-8 text-muted-foreground text-[13px] gap-2">
                        <Loader2 className="size-4 animate-spin text-primary" />
                        Searching documents...
                    </div>
                ) : query && results.length === 0 ? (
                    <div className="nb-empty-state nb-grid-ground my-2 py-6 text-center" role="status">
                        <div className="nb-empty-state-icon-box mb-2">
                            <Search className="nb-empty-state-icon" />
                        </div>
                        <h4 className="nb-empty-state-title">No matches found</h4>
                        <p className="nb-empty-state-desc">No matches found for &quot;{query}&quot;</p>
                    </div>
                ) : !query ? (
                    <div className="text-center py-8 text-muted-foreground text-xs">
                        Type a search query to search across all documents.
                    </div>
                ) : (
                    results.map((docResult) => (
                        <div key={docResult.slug} className="space-y-1.5">
                            <div className="flex items-center gap-1.5 px-1">
                                <FileText className="size-3.5 text-muted-foreground" />
                                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{docResult.filename}</span>
                            </div>
                            <div className="space-y-1">
                                {docResult.matches.map((match: any) => (
                                    <button
                                        key={match.line}
                                        type="button"
                                        onClick={() => onSelectMatch(docResult.slug, match.line)}
                                        className="flex w-full flex-col gap-0.5 rounded-[5px] border border-border bg-card p-2.5 text-left hover:border-foreground/20 hover:bg-muted/40 transition-colors group"
                                    >
                                        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                                            <span>Line {match.line}</span>
                                            <span className="opacity-0 group-hover:opacity-100 text-primary font-semibold transition-opacity">Jump to line &rarr;</span>
                                        </div>
                                        <p className="line-clamp-2 font-mono text-[11px] leading-relaxed text-foreground">
                                            {match.text}
                                        </p>
                                    </button>
                                ))}
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}

export function ProjectDocQuickConsole({
    projectId,
    docSlug = "readme",
    excerpt,
    headings,
    commands,
    references,
    report,
    railActions,
    recommendedAction,
    highlightedTargetId,
    highlightedTargetToken,
    instanceId,
    onRailAction,
    onOpenTabChange,
    onSelectedActionChange,
    openTab,
    railTabs,
    referencePreviewByKey,
    referencesError = false,
    referencesLoading = false,
    selectedActionId,
    variant = "rail",
    className,
}: {
    projectId: string;
    docSlug?: string;
    excerpt?: string | null;
    headings: ProjectDocHeading[];
    commands: ProjectDocQuickCommand[];
    references: ProjectDocInlineReference[];
    report?: ProjectDocRailReport | null;
    railActions: ProjectDocRailAction[];
    recommendedAction?: ProjectDocRailAction | null;
    highlightedTargetId?: string | null;
    highlightedTargetToken?: number | null;
    instanceId?: string;
    onRailAction?: (action: ProjectDocRailAction) => void;
    onOpenTabChange?: (openTab: ProjectDocRailTabId | null) => void;
    onSelectedActionChange?: (selectedActionId: string | null) => void;
    openTab?: ProjectDocRailTabId | null;
    railTabs?: ProjectDocRailTabId[];
    referencePreviewByKey?: Map<string, ProjectDocSmartBlockPreview>;
    referencesError?: boolean;
    referencesLoading?: boolean;
    selectedActionId?: string | null;
    variant?: ReadmeRailVariant;
    className?: string;

}) {
    const generatedId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
    const railInstanceId = instanceId ?? generatedId;
    const reportSignals = report?.signals ?? [];
    const cleanExcerpt = cleanRailBriefText(excerpt);
    const cleanSummary = cleanRailBriefText(report?.summary);
    const briefItems = report?.briefItems ?? [];
    const primaryCommands = useMemo(() => commands.filter((command) => PROJECT_DOC_PRIMARY_COMMAND_GROUPS.has(command.group)), [commands]);
    const configCommands = useMemo(() => commands.filter((command) => command.group === "config"), [commands]);
    const optionCommands = useMemo(() => commands.filter((command) => command.group === "options"), [commands]);
    const commandGroups = useMemo(() => groupCommandsByIntent(primaryCommands), [primaryCommands]);
    const configCommandGroups = useMemo(() => groupCommandsByIntent(configCommands), [configCommands]);
    const optionCommandGroups = useMemo(() => groupCommandsByIntent(optionCommands), [optionCommands]);
    const actionByCommandId = useMemo(() => {
        const map = new Map<string, ProjectDocRailAction>();
        railActions.forEach((action) => {
            if (action.kind === "command" && action.command) map.set(action.command.id, action);
        });
        return map;
    }, [railActions]);
    const actionByReferenceKey = useMemo(() => {
        const map = new Map<string, ProjectDocRailAction>();
        railActions.forEach((action) => {
            if (action.kind === "reference" && action.referencePreviewKey) map.set(action.referencePreviewKey, action);
        });
        return map;
    }, [railActions]);
    const actionByHeadingId = useMemo(() => {
        const map = new Map<string, ProjectDocRailAction>();
        railActions.forEach((action) => {
            if (action.kind === "heading" && action.heading) map.set(action.heading.id, action);
        });
        return map;
    }, [railActions]);
    const briefStartAction = recommendedAction?.kind === "command" && recommendedAction.command ? recommendedAction : null;
    const briefFactItems = briefItems.filter((item) => item.label.toLowerCase() !== "start here");
    const briefAvailable = Boolean(
        cleanExcerpt
        || cleanSummary
        || briefItems.length
        || reportSignals.length
        || report?.summaryItems.length
        || report?.nextAction
        || report?.limitations.length
        || briefStartAction,
    );
    const hasInstallCommands = primaryCommands.some((command) => (
        command.group === "install"
        || command.group === "recommended"
        || command.group === "claude"
        || command.group === "agents"
    ));
    const commandTabLabel = hasInstallCommands ? "Install" : "Commands";
    const tabListRef = useRef<HTMLDivElement | null>(null);
    const copiedTimerRef = useRef<number | null>(null);
    const [copiedActionId, setCopiedActionId] = useState<string | null>(null);
    const [railAnnouncement, setRailAnnouncement] = useState("");
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();

    const handleSelectMatch = useCallback((matchSlug: string, line: number) => {
        const normalizedMatchSlug = normalizeProjectDocSlug(matchSlug);
        const normalizedActiveSlug = normalizeProjectDocSlug(docSlug);
        const params = new URLSearchParams(searchParams ? searchParams.toString() : "");
        params.set("tab", "docs");
        params.set("doc", normalizedMatchSlug);

        if (normalizedMatchSlug === normalizedActiveSlug) {
            const targetId = `line-${line}`;
            onRailAction?.({
                id: `search-jump-${line}`,
                kind: "heading",
                railTab: "search",
                label: `Line ${line}`,
                description: null,
                targetId,
                copyText: null,
                openHref: null,
                sourceIndex: 0,
                platforms: [],
            });
        } else {
            router.replace(`${pathname}?${params.toString()}#line-${line}`, { scroll: false });
        }
    }, [docSlug, pathname, searchParams, router, onRailAction]);

    const [localRailState, dispatchRail] = useReducer(readmeRailReducer, { openTab: null, selectedActionId: null });
    const railState = {
        openTab: openTab !== undefined ? openTab : localRailState.openTab,
        selectedActionId: selectedActionId !== undefined ? selectedActionId : localRailState.selectedActionId,
    };
    const availableTabIds = useMemo(() => {
        if (railTabs?.length) return railTabs;
        const ids: ProjectDocRailTabId[] = [];
        if (briefAvailable) ids.push("brief");
        if (primaryCommands.length) ids.push("commands");
        if (references.length) ids.push("links");
        if (headings.length) ids.push("outline");
        if (configCommands.length) ids.push("config");
        if (optionCommands.length) ids.push("options");
        ids.push("search");
        return ids;
    }, [briefAvailable, configCommands.length, headings.length, optionCommands.length, primaryCommands.length, railTabs, references.length]);
    const hasContent = availableTabIds.length > 0;
    useEffect(() => {
        if (railState.openTab && !availableTabIds.includes(railState.openTab)) {
            onOpenTabChange?.(null);
            dispatchRail({ type: "close_tab" });
        } else {
            dispatchRail({ type: "sync_tabs", availableTabIds });
        }
    }, [availableTabIds, onOpenTabChange, railState.openTab]);

    useEffect(() => () => {
        if (copiedTimerRef.current) window.clearTimeout(copiedTimerRef.current);
    }, []);

    const executeRailAction = useCallback((action: ProjectDocRailAction) => {
        const nextOpenTab = variant === "compact" ? null : railState.openTab;
        onSelectedActionChange?.(action.id);
        onOpenTabChange?.(nextOpenTab);
        dispatchRail({ type: "select_action", actionId: action.id, closePanel: variant === "compact" });
        onRailAction?.(action);

        if (!action.copyText) {
            setRailAnnouncement(`Moved to ${action.label}`);
            return;
        }
        setRailAnnouncement(`Copying ${action.label} and moving to document target`);
        void copyTextWithFallback(action.copyText)
            .then(() => {
                setCopiedActionId(action.id);
                setRailAnnouncement(`Copied ${action.label} and moved to document target`);
                if (copiedTimerRef.current) window.clearTimeout(copiedTimerRef.current);
                copiedTimerRef.current = window.setTimeout(() => {
                    setCopiedActionId((current) => current === action.id ? null : current);
                }, 1400);
            })
            .catch((error) => {
                console.error("[ProjectDocQuickConsole] Copy command failed", error);
                setRailAnnouncement(`Could not copy ${action.label}, but moved to document target`);
            });
    }, [onOpenTabChange, onRailAction, onSelectedActionChange, railState.openTab, variant]);

    if (!hasContent) return null;

    const handleTabListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === "Escape") {
            onOpenTabChange?.(null);
            dispatchRail({ type: "close_tab" });
            return;
        }
        if (event.key !== "ArrowRight" && event.key !== "ArrowLeft" && event.key !== "Home" && event.key !== "End") return;
        event.preventDefault();
        const buttons = Array.from(tabListRef.current?.querySelectorAll<HTMLButtonElement>("[data-readme-rail-tab]") ?? []);
        if (!buttons.length) return;
        const currentIndex = Math.max(0, buttons.findIndex((button) => button === document.activeElement));
        const nextIndex = event.key === "Home"
            ? 0
            : event.key === "End"
                ? buttons.length - 1
                : event.key === "ArrowRight"
                    ? (currentIndex + 1) % buttons.length
                    : (currentIndex - 1 + buttons.length) % buttons.length;
        buttons[nextIndex]?.focus();
    };

    const toggleRailTab = (id: ProjectDocRailTabId) => {
        const nextOpenTab = railState.openTab === id ? null : id;
        onOpenTabChange?.(nextOpenTab);
        dispatchRail({ type: "toggle_tab", id });
    };

    const renderCommandGroups = (groups: Array<[ProjectDocCommandGroup, ProjectDocQuickCommand[]]>) => (
        <div className="space-y-3">
            {groups.map(([group, groupCommands]) => (
                <div key={group} className="space-y-1.5">
                    {groups.length > 1 ? (
                        <p className="px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                            {groupCommands[0]?.groupLabel}
                        </p>
                    ) : null}
                    {groupCommands.map((command) => {
                        const action = actionByCommandId.get(command.id);
                        if (!action) return null;
                        return (
                            <CommandShortcutRow
                                key={action.id}
                                action={action}
                                active={railState.selectedActionId === action.id}
                                command={command}
                                copied={copiedActionId === action.id}
                                highlighted={highlightedTargetId === action.targetId && railState.selectedActionId === action.id}
                                onExecuteAction={executeRailAction}
                            />
                        );
                    })}
                </div>
            ))}
        </div>
    );

    const renderCommandRow = (command: ProjectDocQuickCommand) => {
        const action = actionByCommandId.get(command.id);
        if (!action) return null;
        return (
            <CommandShortcutRow
                key={action.id}
                action={action}
                active={railState.selectedActionId === action.id}
                command={command}
                copied={copiedActionId === action.id}
                highlighted={highlightedTargetId === action.targetId && railState.selectedActionId === action.id}
                onExecuteAction={executeRailAction}
            />
        );
    };

    const renderCommandList = (list: ProjectDocQuickCommand[], groups: Array<[ProjectDocCommandGroup, ProjectDocQuickCommand[]]>) => {
        if (list.length <= LARGE_RAIL_LIST_THRESHOLD) return renderCommandGroups(groups);
        return (
            <div className="h-[28rem] min-h-0">
                <Virtuoso
                    data={list}
                    itemContent={(_, command) => (
                        <div className="pb-2 pr-1">
                            {renderCommandRow(command)}
                        </div>
                    )}
                />
            </div>
        );
    };

    const renderBriefPanel = () => (
        <div className="space-y-5">
            {briefFactItems.length || cleanExcerpt || briefStartAction?.command ? (
                <section>
                    <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-primary">
                        <FileText className="size-3.5" />
                        Doc Brief
                    </div>
                    {briefFactItems.length ? (
                        <dl className="grid gap-2.5">
                            {briefFactItems.map((item, index) => (
                                <div key={`${item.label}:${index}`} className="min-w-0 rounded-[5px] border border-border bg-card p-2.5">
                                    <dt className="nb-ui-label text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{item.label}</dt>
                                    <dd className="break-words text-xs leading-5 text-foreground [overflow-wrap:anywhere] mt-0.5">{item.value}</dd>
                                </div>
                            ))}
                        </dl>
                    ) : cleanExcerpt ? (
                        <p className="nb-compact text-sm text-foreground leading-relaxed">{cleanExcerpt}</p>
                    ) : null}
                    {briefStartAction?.command ? (
                        <div className={cn("space-y-1.5", (briefFactItems.length || cleanExcerpt) && "mt-3")}>
                            <p className="px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                                Start here
                            </p>
                            <CommandShortcutRow
                                action={briefStartAction}
                                active={railState.selectedActionId === briefStartAction.id}
                                command={briefStartAction.command}
                                copied={copiedActionId === briefStartAction.id}
                                highlighted={highlightedTargetId === briefStartAction.targetId && railState.selectedActionId === briefStartAction.id}
                                onExecuteAction={executeRailAction}
                            />
                        </div>
                    ) : null}
                </section>
            ) : null}

            {cleanSummary || reportSignals.length || report?.summaryItems.length || report?.warnings.length || report?.limitations.length ? (
                <section>
                    <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-primary">
                        <ClipboardList className="size-3.5" />
                        Doc Report
                    </div>
                    {cleanSummary && !briefItems.some((item) => item.value === cleanSummary) ? (
                        <p className="nb-compact text-sm text-foreground leading-relaxed">{cleanSummary}</p>
                    ) : null}
                    {report?.summaryItems.length ? (
                        <dl className="mt-3 grid gap-2">
                            {report.summaryItems.map((item) => (
                                <div key={`${item.label}:${item.value}`} className="min-w-0">
                                    <dt className="nb-ui-label text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{item.label}</dt>
                                    <dd className="break-words text-xs leading-5 text-foreground [overflow-wrap:anywhere] mt-0.5">{item.value}</dd>
                                </div>
                            ))}
                        </dl>
                    ) : null}
                    {report?.warnings.length ? (
                        <div className="mt-3 space-y-1">
                            {report.warnings.map((warning, index) => (
                                <p key={`${warning}-${index}`} className="rounded-[5px] border border-amber-500/20 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-700 dark:text-amber-400">
                                    {warning}
                                </p>
                            ))}
                        </div>
                    ) : null}
                    {report?.limitations.length ? (
                        <div className="mt-3 space-y-1">
                            {report.limitations.map((limitation, index) => (
                                <p key={`${limitation}-${index}`} className="rounded-[5px] border border-border bg-muted/40 px-2.5 py-1.5 text-xs text-muted-foreground">
                                    {limitation}
                                </p>
                            ))}
                        </div>
                    ) : null}
                    {report?.platforms.length ? (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                            {report.platforms.map((platform) => (
                                <span
                                    key={platform}
                                    className="inline-flex h-5 items-center rounded-[3px] border border-border bg-muted/60 px-[7px] font-mono text-[11px] uppercase tracking-[0.09em] leading-none text-muted-foreground"
                                >
                                    {platform}
                                </span>
                            ))}
                        </div>
                    ) : null}
                    {reportSignals.length ? (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                            {reportSignals.map((signal) => (
                                <span
                                    key={signal}
                                    className="inline-flex h-5 items-center rounded-[3px] border border-border bg-muted/40 px-[7px] font-mono text-[11px] uppercase tracking-[0.09em] leading-none text-muted-foreground"
                                >
                                    {signal}
                                </span>
                            ))}
                        </div>
                    ) : null}
                </section>
            ) : null}
        </div>
    );

    const renderLinksPanel = () => (
        <section>
            <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-primary">
                <Link2 className="size-3.5" />
                Project Links
            </div>
            <div className="space-y-1">
                {references.map((reference, index) => {
                    const key = `${reference.kind}:${reference.id}:${index}`;
                    const action = actionByReferenceKey.get(key);
                    if (!action) return null;
                    const previewOption = action.previewOption ?? referencePreviewByKey?.get(key)?.items[0] ?? null;
                    const referenceAction = {
                        ...action,
                        openHref: action.openHref ?? previewOption?.href ?? null,
                        previewLoading: action.previewLoading ?? referencesLoading,
                        previewError: action.previewError ?? referencesError,
                    };
                    return (
                        <ReferenceRow
                            key={referenceAction.id}
                            action={referenceAction}
                            active={railState.selectedActionId === referenceAction.id}
                            fallback={reference}
                            highlighted={highlightedTargetId === referenceAction.targetId && railState.selectedActionId === referenceAction.id}
                            onExecuteAction={executeRailAction}
                            option={previewOption}
                        />
                    );
                })}
            </div>
        </section>
    );

    const renderOutlinePanel = () => (
        <section>
            <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-primary">
                <Hash className="size-3.5" />
                On This Document
            </div>
            <nav className="space-y-1" aria-label="Document sections">
                {headings.length > LARGE_RAIL_LIST_THRESHOLD ? (
                    <div className="h-[28rem] min-h-0">
                        <Virtuoso
                            data={headings}
                            itemContent={(_, heading) => {
                                const action = actionByHeadingId.get(heading.id);
                                if (!action) return null;
                                return (
                                    <div className="pb-1 pr-1">
                                        <HeadingRow
                                            action={action}
                                            active={railState.selectedActionId === action.id}
                                            heading={heading}
                                            highlighted={highlightedTargetId === action.targetId && railState.selectedActionId === action.id}
                                            onExecuteAction={executeRailAction}
                                        />
                                    </div>
                                );
                            }}
                        />
                    </div>
                ) : headings.map((heading) => {
                    const action = actionByHeadingId.get(heading.id);
                    if (!action) return null;
                    return (
                        <HeadingRow
                            key={action.id}
                            action={action}
                            active={railState.selectedActionId === action.id}
                            heading={heading}
                            highlighted={highlightedTargetId === action.targetId && railState.selectedActionId === action.id}
                            onExecuteAction={executeRailAction}
                        />
                    );
                })}
            </nav>
        </section>
    );

    const baseTabs = [
        briefAvailable
            ? {
                id: "brief" as const,
                label: "Brief",
                count: report?.signals.length || null,
                content: renderBriefPanel,
            }
            : null,
        primaryCommands.length
            ? {
                id: "commands" as const,
                label: commandTabLabel,
                count: primaryCommands.length,
                content: () => (
                    <section>
                        <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-primary">
                            <SquareTerminal className="size-3.5" />
                            Quick Commands
                        </div>
                        {renderCommandList(primaryCommands, commandGroups)}
                    </section>
                ),
            }
            : null,
        references.length
            ? {
                id: "links" as const,
                label: "Links",
                count: references.length,
                content: renderLinksPanel,
            }
            : null,
        headings.length
            ? {
                id: "outline" as const,
                label: "Outline",
                count: headings.length,
                content: renderOutlinePanel,
            }
            : null,
        configCommands.length
            ? {
                id: "config" as const,
                label: "Config",
                count: configCommands.length,
                content: () => (
                    <section>
                        <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-primary">
                            <ClipboardList className="size-3.5" />
                            Config
                        </div>
                        {renderCommandList(configCommands, configCommandGroups)}
                    </section>
                ),
            }
            : null,
        optionCommands.length
            ? {
                id: "options" as const,
                label: "Options",
                count: optionCommands.length,
                content: () => (
                    <section>
                        <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-primary">
                            <ClipboardList className="size-3.5" />
                            Options
                        </div>
                        {renderCommandList(optionCommands, optionCommandGroups)}
                    </section>
                ),
            }
            : null,
        {
            id: "search" as const,
            label: "Search",
            count: null,
            content: () => (
                <section>
                    <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-primary">
                        <Search className="size-3.5" />
                        Search Documents
                    </div>
                    <SearchPanel projectId={projectId} onSelectMatch={handleSelectMatch} />
                </section>
            ),
        },
    ].filter((tab): tab is NonNullable<typeof tab> => Boolean(tab));
    const tabOrder = new Map(availableTabIds.map((id, index) => [id, index]));
    const tabs = baseTabs
        .filter((tab) => availableTabIds.includes(tab.id))
        .sort((a, b) => (tabOrder.get(a.id) ?? 999) - (tabOrder.get(b.id) ?? 999));
    const activeTab = tabs.find((tab) => tab.id === railState.openTab) ?? null;

    return (
        <aside
            aria-label="Document tools"
            className={cn(
                variant === "compact"
                    ? "sticky top-20 z-20 flex max-h-[min(70dvh,calc(100dvh-var(--ui-topnav-height)-6rem))] min-h-0 flex-col space-y-3 rounded-[8px] border border-border bg-card p-3 shadow-lg backdrop-blur-none"
                    : "flex h-[calc(100dvh-var(--ui-topnav-height)-4.5rem)] max-h-[calc(100dvh-var(--ui-topnav-height)-4.5rem)] min-h-0 flex-col space-y-3 border-l border-border pl-6",
                className,
            )}
            data-readme-highlight-token={highlightedTargetToken ?? undefined}
            data-readme-rail-variant={variant}
        >
            <span className="sr-only" aria-live="polite">{railAnnouncement}</span>
            <DocumentSwitcher
                projectId={projectId}
                activeSlug={docSlug}
            />
            <motion.div
                ref={tabListRef}
                className={cn("grid shrink-0 gap-2", variant === "compact" ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-2")}
                aria-label="Document rail buttons"
                role="tablist"
                onKeyDown={handleTabListKeyDown}
            >
                {tabs.map((tab) => (
                    <ReadmeRailTabButton
                        key={tab.id}
                        active={railState.openTab === tab.id}
                        count={tab.count}
                        id={tab.id}
                        instanceId={railInstanceId}
                        label={tab.label}
                        onToggle={toggleRailTab}
                    />
                ))}
            </motion.div>
            <AnimatePresence initial={false} mode="wait">
                {activeTab ? (
                    <motion.div
                        key={activeTab.id}
                        id={`readme-rail-${railInstanceId}-panel-${activeTab.id}`}
                        role="tabpanel"
                        aria-labelledby={`readme-rail-${railInstanceId}-tab-${activeTab.id}`}
                        initial={variant === "compact" ? { height: 0, opacity: 0 } : { opacity: 0 }}
                        animate={variant === "compact" ? { height: "auto", opacity: 1 } : { opacity: 1 }}
                        exit={variant === "compact" ? { height: 0, opacity: 0 } : { opacity: 0 }}
                        transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
                        className="min-h-0 flex-1 overflow-hidden border-t border-border"
                        data-readme-compact-panel={variant === "compact" ? "true" : undefined}
                    >
                        <div
                            className={cn(
                                "space-y-5 pt-3",
                                variant === "rail" && "h-full min-h-0 overflow-y-auto overscroll-contain pb-10 pr-1 app-scroll app-scroll-y app-scroll-gutter",
                                variant === "compact" && "max-h-[min(70dvh,28rem)] overflow-y-auto overscroll-contain pb-10 pr-1 app-scroll app-scroll-y app-scroll-gutter",
                            )}
                        >
                            {activeTab.content()}
                        </div>
                    </motion.div>
                ) : null}
            </AnimatePresence>
        </aside>
    );
}

"use client";
import { PixelBeat } from "@/components/ui/PixelBeat";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useInfiniteQuery } from "@tanstack/react-query";
import { ArrowRight, Check, ChevronDown, ChevronLeft, Copy, ExternalLink, Laptop, Plus, Search, X } from "@/components/ui/icons";
import {
    SUPPORTED_IDES,
    type IdeDefinition,
    type SupportedIde,
    buildIdeLaunchUri,
    buildIdeMarketplaceUri,
    dispatchIdeProtocol,
    getPreferredIde,
    resolveIdeFromSession,
    setPreferredIde,
} from "@/lib/extension/ide-protocol";
import { useExtensionSessionsData } from "@/hooks/useSettingsQueries";
import { useLaptopInstalledIdes } from "@/hooks/useLaptopInstalledIdes";
import { useAuth } from "@/hooks/use-auth";
import { queryKeys } from "@/lib/query-keys";
import { copyText } from "@/lib/clipboard";
import { Button } from "@/components/ui/button";
import { PixelSpinner } from "@/components/auth/pixel";
import { loadProjects, type IdeWorkspace } from "@/components/workspaces/v2/files-tab/IdeWorkspacePicker";

type View = "editors" | "connect" | "workspace" | "opening" | "did" | "help";
const CLI = "npx @networkbase/cli init";

function EditorIcon({ ide, size = 16 }: { ide: IdeDefinition; size?: number }) {
    return <Image src={ide.icon} alt="" width={size} height={size} unoptimized className="shrink-0 object-contain" style={{ width: size, height: size }} />;
}

/**
 * My work's code editor (shell redesign v3): footer cells like the top bar — the default editor by name (it opens your
 * work there), and ▾ for the rest — and one sheet that rises from the footer inside the panel. Its views swap in place:
 * your editors, connect another, choose a workspace (My work has no single workspace), opening → did it open?, and setup
 * help. The terminal strip is ink, like the sign-in "$ nb login" chip.
 */
export function MyWorkEditor({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
    const sessions = useExtensionSessionsData();
    const { installedList, platform, isLoading: detecting } = useLaptopInstalledIdes();
    const { user } = useAuth();
    const [view, setView] = useState<View>("editors");
    const [back, setBack] = useState<View | null>(null);
    const [preferred, setPreferred] = useState<SupportedIde>(getPreferredIde);
    const [target, setTarget] = useState<SupportedIde>(getPreferredIde);
    const [search, setSearch] = useState("");
    const [workspaceSearch, setWorkspaceSearch] = useState("");
    const [chosen, setChosen] = useState<IdeWorkspace | null>(null);
    const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");
    const cellsRef = useRef<HTMLDivElement>(null);
    const sheetRef = useRef<HTMLDivElement>(null);
    const mounted = useRef(true);
    useEffect(() => () => { mounted.current = false; }, []);

    const connected = useMemo(() => {
        const seen = new Set<SupportedIde>();
        return (sessions.data?.sessions ?? []).flatMap((session) => {
            if (session.clientVersion === "pending" || !(session.editorPlatform || session.editorName)) return [];
            const id = resolveIdeFromSession(session);
            const ide = SUPPORTED_IDES[id];
            if (!ide || seen.has(id)) return [];
            seen.add(id);
            return [ide];
        });
    }, [sessions.data?.sessions]);
    const active = connected.find((ide) => ide.id === preferred) ?? connected[0];
    const platformLabel = platform === "darwin" ? "Mac" : platform === "win32" ? "PC" : "computer";

    const workspaces = useInfiniteQuery({
        queryKey: queryKeys.myWork.ideProjects(user?.id ?? null),
        queryFn: ({ pageParam, signal }) => loadProjects(pageParam, signal),
        initialPageParam: null as string | null,
        getNextPageParam: (page) => (page.projectPage?.hasMore ? page.projectPage.nextCursor : undefined),
        enabled: open && view === "workspace" && Boolean(user?.id),
        staleTime: 30_000,
    });

    const go = (next: View, from: View | null = null) => { setView(next); setBack(from); };
    const close = () => { onOpenChange(false); setSearch(""); setWorkspaceSearch(""); };
    // A click anywhere else in My work closes the sheet (its own menus and the cells don't).
    useEffect(() => {
        if (!open) return;
        const onDown = (event: PointerEvent) => {
            const node = event.target as Node;
            if (sheetRef.current?.contains(node) || cellsRef.current?.contains(node)) return;
            if ((event.target as HTMLElement).closest?.("[data-radix-popper-content-wrapper], [data-sonner-toaster]")) return;
            onOpenChange(false);
        };
        document.addEventListener("pointerdown", onDown, true);
        return () => document.removeEventListener("pointerdown", onDown, true);
    }, [open, onOpenChange]);
    // The sheet takes focus at its search, or its first control.
    useEffect(() => {
        if (!open) return;
        const timer = setTimeout(() => sheetRef.current?.querySelector<HTMLElement>("input, button.nb-mw-erow, .nb-mw-sheet-body button")?.focus(), 40);
        return () => clearTimeout(timer);
    }, [open, view]);

    const openWorkspaceView = (ide: SupportedIde) => { setTarget(ide); setWorkspaceSearch(""); go("workspace", connected.length > 1 ? "editors" : null); onOpenChange(true); };
    const launch = (project: IdeWorkspace) => {
        setPreferredIde(target); setPreferred(target); setChosen(project); go("opening");
        // Keep the click gesture for the browser's protocol prompt; if nothing takes the link, show setup help.
        dispatchIdeProtocol(buildIdeLaunchUri({ ide: target, projectId: project.id, projectSlug: project.slug }), () => { if (mounted.current) go("help"); });
        setTimeout(() => { if (mounted.current) setView((v) => (v === "opening" ? "did" : v)); }, 1300);
    };
    const marketplace = (ide: SupportedIde) => { setTarget(ide); dispatchIdeProtocol(buildIdeMarketplaceUri(ide)); };

    const matches = (ide: IdeDefinition) => `${ide.name} ${ide.description}`.toLowerCase().includes(search.trim().toLowerCase());
    const installed = new Set(installedList.map((ide) => ide.id));
    const connecting = view === "connect" || !connected.length;
    const targetName = SUPPORTED_IDES[target]?.name ?? "your editor";

    const head = (label: React.ReactNode, backTo: View | null) => (
        <div className="nb-mw-sheet-head">
            {backTo ? <button type="button" onClick={() => go(backTo)} aria-label="Back"><ChevronLeft className="size-4" aria-hidden="true" /></button> : null}
            <span className="k">{label}</span>
            <button type="button" onClick={close} aria-label="Close" title="Close  Esc"><X className="size-4" aria-hidden="true" /></button>
        </div>
    );
    const field = (label: string, value: string, set: (v: string) => void) => (
        <label className="nb-mw-qfield" style={{ ["--n" as string]: 1 }}>
            <Search className="size-[15px] shrink-0" aria-hidden="true" />
            <input type="search" aria-label={label} placeholder={`${label}…`} value={value} onChange={(event) => set(event.target.value)} autoComplete="off" />
        </label>
    );
    const listKeys = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
        const rows = [...(sheetRef.current?.querySelectorAll<HTMLElement>(".nb-mw-erow") ?? [])];
        if (!rows.length) return;
        event.preventDefault();
        event.stopPropagation();
        const at = rows.indexOf(document.activeElement as HTMLElement);
        rows[at < 0 ? 0 : Math.max(0, Math.min(rows.length - 1, at + (event.key === "ArrowDown" ? 1 : -1)))]?.focus();
    };

    const terminal = (
        <div className="nb-mw-term" style={{ ["--n" as string]: 6 }}>
            <div className="nb-mw-term-in">
                <code>{CLI}</code>
                <button type="button" onClick={() => void copyText(CLI).then(() => setCopied("done"), () => setCopied("failed")).finally(() => setTimeout(() => mounted.current && setCopied("idle"), 1500))} aria-label={copied === "done" ? "Copied" : "Copy command"}>
                    {copied === "done" ? <Check className="size-[13px]" aria-hidden="true" /> : <Copy className="size-[13px]" aria-hidden="true" />}
                    {copied === "done" ? "Copied" : copied === "failed" ? "Select it" : "Copy"}
                </button>
            </div>
            <p>Links a folder to a workspace. Then <code>nb push &lt;files&gt;</code>.</p>
        </div>
    );
    const sheetFoot = (
        <div className="nb-mw-sheet-foot">
            <button type="button" onClick={() => { setTarget(active?.id ?? preferred); go("help", view); }}>Setup help<ExternalLink className="size-[13px]" aria-hidden="true" /></button>
            <Link href="/docs/agents" onClick={close}><span className="ai"><b>AI agents</b>Claude Code · Codex · Cursor</span><span className="set">Set up</span></Link>
        </div>
    );

    let sheet: React.ReactNode = null;
    if (open && view === "workspace") {
        const projects = workspaces.data?.pages.flatMap((page) => page.projects) ?? [];
        const filtered = projects.filter((project) => `${project.name} ${project.slug ?? ""}`.toLowerCase().includes(workspaceSearch.trim().toLowerCase()));
        sheet = (
            <div ref={sheetRef} className="nb-mw-sheet" role="dialog" aria-label="Choose a workspace" onKeyDown={listKeys}>
                {head(<>Open in <b>{targetName}</b></>, back)}
                <div className="nb-mw-sheet-body">
                    <p className="nb-mw-sheet-lead" style={{ ["--n" as string]: 0 }}>Choose a workspace. It opens in {targetName} with its files and tasks.</p>
                    {field("Search workspaces", workspaceSearch, setWorkspaceSearch)}
                    {!user ? <p role="status" className="nb-mw-sheet-lead">Sign in to open your workspaces.</p>
                        : workspaces.isPending ? <div role="status" aria-label="Loading workspaces" className="grid gap-1">{[60, 44, 52].map((w) => <div key={w} className="nb-mw-ghost" style={{ gridTemplateColumns: "24px 1fr" }}><div className="nb-skeleton size-6 rounded-md" /><div className="nb-skeleton h-3 rounded-[3px]" style={{ width: `${w}%` }} /></div>)}</div>
                        : workspaces.isError && !workspaces.data ? <div role="alert" className="nb-mw-err">Couldn’t load your workspaces.<button type="button" onClick={() => void workspaces.refetch()}>Retry</button></div>
                        : (
                            <div className="nb-mw-elist" style={{ ["--n" as string]: 2 }}>
                                {filtered.map((project) => (
                                    <button key={project.id} type="button" className="nb-mw-erow" aria-label={project.name} onClick={() => launch(project)}>
                                        <span className="grid size-6 place-items-center rounded-md bg-secondary font-mono text-[10px] font-semibold text-muted-foreground" aria-hidden="true">{project.name.slice(0, 2).toUpperCase()}</span>
                                        <span className="min-w-0"><b>{project.name}</b>{project.slug ? <span className="esub">workspaces/{project.slug}</span> : null}</span>
                                        <span className="go" aria-hidden="true">Open<ArrowRight className="size-3" /></span>
                                    </button>
                                ))}
                                {!filtered.length ? <p role="status" className="nb-mw-sheet-lead px-2 py-3">{projects.length ? workspaces.hasNextPage ? "No matching workspaces. Load more or try another name." : "No matching workspaces. Try another name." : "Join or create a workspace to open it in your editor."}</p> : null}
                                {workspaces.hasNextPage ? (
                                    <button type="button" className="nb-mw-erow add" disabled={workspaces.isFetchingNextPage} onClick={() => void workspaces.fetchNextPage()}>
                                        <span className="pl" aria-hidden="true"><ChevronDown className="size-3.5" /></span><span>{workspaces.isFetchingNextPage ? <><PixelBeat />Loading workspaces…</> : "Load more workspaces"}</span>
                                    </button>
                                ) : null}
                                {workspaces.isFetchNextPageError ? <p role="alert" className="text-xs text-destructive">Couldn’t load more workspaces. Try again.</p> : null}
                            </div>
                        )}
                </div>
            </div>
        );
    } else if (open && (view === "opening" || view === "did")) {
        sheet = (
            <div ref={sheetRef} className="nb-mw-sheet" role="dialog" aria-label={`Opening in ${targetName}`}>
                {head(<>Open in <b>{targetName}</b></>, null)}
                <div className="nb-mw-sheet-body">
                    {view === "opening" ? (
                        <div className="nb-mw-opening" role="status"><PixelSpinner /><b>Opening {chosen?.name} in {targetName}…</b><span>Your browser may ask to open {targetName}. Allow it.</span></div>
                    ) : (
                        <div className="nb-mw-opening">
                            <b>Did {targetName} open {chosen?.name}?</b>
                            <span>If nothing happened, the NetworkBase extension may not be installed yet.</span>
                            <span className="row"><Button size="sm" onClick={close}>Yes, it opened</Button><Button size="sm" variant="outline" onClick={() => go("help")}>Nothing opened</Button></span>
                        </div>
                    )}
                </div>
            </div>
        );
    } else if (open && view === "help") {
        sheet = (
            <div ref={sheetRef} className="nb-mw-sheet" role="dialog" aria-label={`Connect ${targetName}`}>
                {head(<>Connect <b>{targetName}</b></>, back)}
                <div className="nb-mw-sheet-body">
                    <p className="nb-mw-sheet-lead" style={{ ["--n" as string]: 0 }}>If nothing opened, install NetworkBase for VS Code in {targetName}, then try again.</p>
                    <ol className="nb-mw-steps" style={{ ["--n" as string]: 1 }}>
                        <li><span>Find <b>NetworkBase Workspace</b> in {targetName}’s extensions.</span></li>
                        <li><span>Install the extension and sign in to NetworkBase.</span></li>
                        <li><span>Open your workspace or task in your connected editor.</span></li>
                    </ol>
                    <div className="grid gap-2" style={{ ["--n" as string]: 2 }}>
                        <Button size="sm" onClick={() => marketplace(target)}><ExternalLink className="size-3.5" aria-hidden="true" />Open marketplace in {targetName}</Button>
                        <Button size="sm" variant="outline" onClick={() => (chosen ? launch(chosen) : openWorkspaceView(target))}>Try opening {targetName}</Button>
                        <Button size="sm" variant="ghost" asChild><Link href="/settings?tab=integrations" onClick={close}>Extension settings</Link></Button>
                    </div>
                </div>
            </div>
        );
    } else if (open) {
        const groups = connecting
            ? [
                { label: `Installed on your ${platformLabel}`, items: installedList.filter((ide) => matches(ide) && !connected.some((c) => c.id === ide.id)), connected: false },
                { label: installed.size ? "Other supported editors" : "Supported editors", items: Object.values(SUPPORTED_IDES).filter((ide) => !installed.has(ide.id) && !connected.some((c) => c.id === ide.id) && matches(ide)), connected: false },
            ]
            : [{ label: "Connected", items: connected.filter(matches), connected: true }];
        sheet = (
            <div ref={sheetRef} className="nb-mw-sheet" role="dialog" aria-label="Desktop editor picker" onKeyDown={listKeys}>
                {head(connecting ? (connected.length ? "Connect another editor" : "Connect your code editor") : "Code editors", connecting && connected.length ? "editors" : null)}
                <div className="nb-mw-sheet-body">
                    <p className="nb-mw-sheet-lead" style={{ ["--n" as string]: 0 }}>{connecting ? "Choose an editor to connect to NetworkBase." : "Open your work or connect another editor."}</p>
                    {sessions.isPending ? null : field("Search editors", search, setSearch)}
                    {sessions.isError ? <div role="status" className="nb-mw-err">Couldn’t load editor connections.<button type="button" onClick={() => void sessions.refetch()}>Retry</button></div> : null}
                    {sessions.isPending ? (
                        <div role="status" aria-label="Loading editor connections" className="grid gap-1">{[60, 44].map((w) => <div key={w} className="nb-mw-ghost" style={{ gridTemplateColumns: "24px 1fr" }}><div className="nb-skeleton size-6 rounded-md" /><div className="nb-skeleton h-3 rounded-[3px]" style={{ width: `${w}%` }} /></div>)}</div>
                    ) : (
                        <>
                            {detecting && connecting ? <p role="status" className="nb-mw-sheet-lead">Checking available editors…</p> : null}
                            {groups.filter((group) => group.items.length).map((group, index) => (
                                <section key={group.label} className="nb-mw-sec" aria-label={group.label} style={{ ["--n" as string]: index + 2 }}>
                                    <div className="nb-mw-sec-h">{group.label} · <b>{group.items.length}</b></div>
                                    <div className="nb-mw-elist">
                                        {group.items.map((ide) => group.connected ? (
                                            <button key={ide.id} type="button" className="nb-mw-erow" onClick={() => openWorkspaceView(ide.id)}>
                                                <EditorIcon ide={ide} size={24} />
                                                <span className="min-w-0"><b>{ide.name}</b><span className="esub">Connected to NetworkBase</span></span>
                                                {ide.id === active?.id ? <span className="def" aria-label="Preferred editor">Default</span> : <span className="go" aria-hidden="true">Open<ArrowRight className="size-3" /></span>}
                                            </button>
                                        ) : (
                                            <button key={ide.id} type="button" className="nb-mw-erow" onClick={() => marketplace(ide.id)}>
                                                <EditorIcon ide={ide} size={24} />
                                                <span className="min-w-0"><b>{ide.name}</b><span className="esub">{ide.description}</span></span>
                                                <span className="go" aria-hidden="true">{installed.has(ide.id) ? "Installed" : "Set up"}<ExternalLink className="size-3" /></span>
                                            </button>
                                        ))}
                                    </div>
                                </section>
                            ))}
                            {groups.every((group) => !group.items.length) ? <p role="status" className="nb-mw-sheet-lead px-2 py-3">No matching editors. Try another name.</p> : null}
                            {!connecting ? (
                                <button type="button" className="nb-mw-erow add" onClick={() => { setSearch(""); go("connect", "editors"); }}>
                                    <span className="pl" aria-hidden="true"><Plus className="size-3.5" /></span><span>Connect another editor</span>
                                </button>
                            ) : null}
                        </>
                    )}
                    {terminal}
                </div>
                {sheetFoot}
            </div>
        );
    }

    return (
        <>
            {sheet}
            <div ref={cellsRef} className="nb-mw-ed-cells" data-testid="open-in-ide-tool">
                {active ? (
                    <>
                        <button type="button" className="nb-mw-ed" aria-label={`Open in ${active.name}`} title={`Open in ${active.name}`} aria-expanded={open && view !== "editors" && view !== "connect"} onClick={() => (open && view === "workspace" ? close() : openWorkspaceView(active.id))}>
                            <EditorIcon ide={active} />
                            <span className="t">{active.name}</span>
                        </button>
                        <button type="button" className="nb-mw-ed-more" aria-haspopup="dialog" aria-expanded={open && (view === "editors" || view === "connect")} aria-label="Choose desktop editor" title="Choose desktop editor" onClick={() => { if (open && (view === "editors" || view === "connect")) close(); else { setSearch(""); go("editors"); onOpenChange(true); } }}>
                            <ChevronDown className="size-[15px]" aria-hidden="true" />
                        </button>
                    </>
                ) : (
                    <button type="button" className="nb-mw-ed" aria-haspopup="dialog" aria-expanded={open} aria-label="Connect your code editor" onClick={() => { if (open) close(); else { setSearch(""); go("connect"); onOpenChange(true); } }}>
                        <Laptop className="size-4 shrink-0 text-primary" aria-hidden="true" />
                        <span className="t">{sessions.isPending ? "Code editor" : "Connect your code editor"}</span>
                        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    </button>
                )}
            </div>
        </>
    );
}

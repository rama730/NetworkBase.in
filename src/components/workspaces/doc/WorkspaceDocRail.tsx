"use client";

import { PixelBeat } from "@/components/ui/PixelBeat";

import { useState } from "react";
import { ChevronDown, FileText, Plus, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { toast } from "@/lib/feedback";

import { AddDocDialog } from "@/components/workspaces/doc/AddDocDialog";
import { RecordDecisionDialog } from "@/components/workspaces/doc/DocDecisions";
import { NewGoalsDialog } from "@/components/workspaces/doc/DocGoals";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { normalizeWorkspaceDocSlug } from "@/lib/workspaces/doc";
import type { WorkspaceDocListItem } from "@/lib/workspaces/doc";
import {
    WORKSPACE_DOC_LIST_QUERY_KEY,
    WORKSPACE_DOCS_QUERY_KEY,
    useWorkspaceDocList,
} from "@/hooks/workspaces/useWorkspaceDocData";
import { cn } from "@/lib/utils";
import { FromOrgDocs, OrgDocChips, useOrgDocs } from "@/components/organizations/OrgDocParts";
import { docTitle } from "@/lib/organizations/doc-rules";
import { useAddedWorkflows } from "@/components/workspaces/workflows/useWorkspaceWorkflows";
import { railSections, type DocSection } from "@/lib/workspaces/doc-sections";
import { NewLaunchDialog } from "@/components/workspaces/doc/DocLaunch";
import { NewMeetingDialog } from "@/components/workspaces/doc/DocMeeting";

const EMPTY_LINE: Record<DocSection, string> = {
    pages: "+ New page", meetings: "+ New meeting", decisions: "+ Record a decision", launches: "+ New launch",
    goals: "+ New goals document", ideas: "+ New idea list", offsite: "+ Plan an off-site",
};

/** Collapsed rail sections, remembered per person in this browser (S1); works without storage too. */
function useCollapsedSections(projectId: string): [DocSection[], (id: DocSection) => void] {
    const key = `nb:doc-sections-collapsed:${projectId}`;
    const [collapsed, setState] = useState<DocSection[]>(() => {
        try { return typeof window === "undefined" ? [] : JSON.parse(window.localStorage.getItem(key) ?? "[]"); } catch { return []; }
    });
    const toggle = (id: DocSection) => setState((current) => {
        const next = current.includes(id) ? current.filter((c) => c !== id) : [...current, id];
        try { window.localStorage.setItem(key, JSON.stringify(next)); } catch { /* storage off: still works for this visit */ }
        return next;
    });
    return [collapsed, toggle];
}

const ACTIVE_ITEM = "border-foreground/20 bg-muted text-foreground font-semibold";
const IDLE_ITEM = "border-border bg-card text-muted-foreground hover:border-foreground/20 hover:text-foreground hover:bg-muted/40";

export type DocRailState = {
    docs: WorkspaceDocListItem[];
    isLoading: boolean;
    navigate: (slug: string | null, replace?: boolean) => void;
    /** Add document; from a rail section's + it lands in that section (report 38.3 S1). */
    openAdd: (section?: DocSection) => void;
    askRemove: (doc: WorkspaceDocListItem | null) => void;
    dialogs: React.JSX.Element;
    /** Report 38.11 W9–W10 (A4.1): Open action items or the Meetings calendar (state, not the URL: the page drops unknown params). */
    view: "actions" | "calendar" | null;
    openView: (view: "actions" | "calendar") => void;
};

// One state machine for the desktop rail and the mobile bar: select, add, remove.
export function useDocRail(projectId: string, activeSlug: string): DocRailState {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const queryClient = useQueryClient();
    const { data: docs = [], isLoading } = useWorkspaceDocList(projectId);
    const [addOpen, setAddOpen] = useState(false);
    const [addSection, setAddSection] = useState<DocSection | null>(null);
    const [recording, setRecording] = useState(false);
    const [removing, setRemoving] = useState<WorkspaceDocListItem | null>(null);
    const [view, setView] = useState<"actions" | "calendar" | null>(null);

    // Opening a doc is a history entry; leaving a removed doc replaces it.
    const navigate = (slug: string | null, replace = false) => {
        setView(null);
        const params = new URLSearchParams(searchParams ? searchParams.toString() : "");
        params.set("tab", "docs");
        params.delete("from"); // own docs, not an org doc opened in place
        if (slug) params.set("doc", normalizeWorkspaceDocSlug(slug));
        else params.delete("doc");
        router[replace ? "replace" : "push"](`${pathname}?${params.toString()}`, { scroll: false });
    };

    const confirmRemove = async () => {
        if (!removing) return;
        const { unlinkWorkspaceDocAction } = await import("@/app/actions/workspace/doc");
        const result = await unlinkWorkspaceDocAction(projectId, removing.slug);
        if (!result.success) throw new Error(result.error);
        await Promise.all([
            queryClient.invalidateQueries({ queryKey: WORKSPACE_DOC_LIST_QUERY_KEY(projectId) }),
            queryClient.invalidateQueries({ queryKey: WORKSPACE_DOCS_QUERY_KEY(projectId) }),
        ]);
        if (removing.slug === activeSlug) navigate(null, true);
        toast.success("Removed from Documents");
    };

    const dialogs = (
        <>
            {/* Report 38.10 W1 (A3.1): Launches' + makes a launch (name, date, preset), not a blank document. */}
            {addSection === "launches" ? <NewLaunchDialog projectId={projectId} open={addOpen} onOpenChange={setAddOpen} />
                : addSection === "meetings" ? <NewMeetingDialog projectId={projectId} open={addOpen} onOpenChange={setAddOpen} />
                : addSection === "goals" ? <NewGoalsDialog projectId={projectId} open={addOpen} onOpenChange={setAddOpen} />
                : <AddDocDialog projectId={projectId} open={addOpen} onOpenChange={setAddOpen} section={addSection} />}
            <RecordDecisionDialog projectId={projectId} open={recording} onOpenChange={setRecording} />
            <ConfirmDialog
                open={removing !== null}
                onOpenChange={(open) => !open && setRemoving(null)}
                title={`Remove ${removing ? docTitle(removing.filename) : "doc"} from Docs?`}
                description="The file stays in Files."
                confirmLabel="Remove"
                variant="destructive"
                onConfirm={confirmRemove}
            />
        </>
    );

    return { docs, isLoading, navigate, openAdd: (section?: DocSection) => {
        // Decisions' + records one (S4): it gets the next D-number rather than being an unnumbered page.
        if (section === "decisions") return setRecording(true);
        setAddSection(section ?? null); setAddOpen(true);
    }, askRemove: setRemoving, dialogs, view, openView: setView };
}

function AddDocButton({ onClick, className }: { onClick: () => void; className?: string }) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-label="Add document"
            title="Add document"
            className={cn("inline-flex items-center justify-center rounded-[5px] border border-border bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground", className)}
        >
            <Plus className="size-3.5" />
        </button>
    );
}

export function WorkspaceDocRail({
    projectId,
    activeSlug,
    canEdit = false,
    rail: passedRail,
    visibility = "inherit_workspace",
}: {
    projectId: string;
    activeSlug: string;
    canEdit?: boolean;
    rail?: DocRailState;
    /** The open doc's visibility, for the org admin options. */
    visibility?: string;
}) {
    const internalRail = useDocRail(projectId, activeSlug);
    const rail = passedRail ?? internalRail;
    // Org docs (report §19): groups, labels, the From <org> section and admin options.
    const org = useOrgDocs(projectId).data ?? null;
    const orgById = new Map((org?.docs ?? []).map((doc) => [doc.id, doc]));
    // Report 38.3 S1: a workspace's sections once a document workflow is added; organizations keep their groups.
    const added = useAddedWorkflows();
    const sections = org?.mode === "org" ? [] : railSections(rail.docs, added);
    const [collapsed, setCollapsed] = useCollapsedSections(projectId);
    const grouped = org?.mode === "org"
        ? [
            ...org.groups.map((group) => ({ id: null as DocSection | null, name: group.name, docs: rail.docs.filter((doc) => orgById.get(doc.id)?.group === group.id).map((doc) => ({ ...doc, prefix: null as string | null })) })),
            { id: null as DocSection | null, name: "Other", docs: rail.docs.filter((doc) => !orgById.has(doc.id)).map((doc) => ({ ...doc, prefix: null as string | null })) },
        ].filter((section) => section.docs.length > 0)
        : sections.length
            ? sections.map((section) => ({ id: section.id as DocSection | null, name: section.label as string | null, docs: section.docs }))
            : [{ id: null as DocSection | null, name: null as string | null, docs: rail.docs.map((doc) => ({ ...doc, prefix: null as string | null })) }];

    return (
        <aside className="hidden w-full xl:block xl:w-[260px] shrink-0 border-l border-border pl-6" aria-label="Workspace documents">
            <div className="sticky top-[calc(var(--workspace-tabs-height,42px)+1rem)] space-y-2">
                <div className="flex items-center justify-between gap-2 pb-2">
                    <span className="nb-ui-label text-[11px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
                        Documents
                    </span>
                    <span className="flex items-center gap-1.5">
                        {rail.isLoading ? (
                            <PixelBeat className="text-muted-foreground" />
                        ) : (
                            <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-[3px] border border-border bg-muted/60 px-1 font-mono text-[10px] max-md:text-[11px] font-semibold text-muted-foreground">
                                {rail.docs.length}
                            </span>
                        )}
                        {canEdit ? <AddDocButton onClick={() => rail.openAdd()} className="size-6" /> : null}
                    </span>
                </div>

                <nav className="space-y-1" aria-label="Documents list">
                    {rail.isLoading ? (
                        <div className="space-y-1.5">
                            <div aria-hidden="true" className="nb-skeleton h-[34px] w-full rounded-[5px]" />
                            <div aria-hidden="true" className="nb-skeleton h-[34px] w-full rounded-[5px]" />
                        </div>
                    ) : (
                        grouped.map((section) => [
                            section.id ? (
                                <div key={`section:${section.id}`} className="flex items-center gap-1 pt-2" data-testid={`doc-section-${section.id}`}>
                                    <button type="button" aria-expanded={!collapsed.includes(section.id)} onClick={() => setCollapsed(section.id!)}
                                        className="flex min-w-0 flex-1 items-center gap-1 px-1 text-left text-[11px] text-muted-foreground hover:text-foreground">
                                        <ChevronDown aria-hidden="true" className={cn("size-3 transition-transform duration-[180ms]", collapsed.includes(section.id) && "-rotate-90")} />
                                        <span className="truncate">{section.name}</span>
                                        <span className="font-mono text-[10px]">{section.docs.length}</span>
                                    </button>
                                    {canEdit ? (
                                        <button type="button" onClick={() => rail.openAdd(section.id!)} aria-label={`Add to ${section.name}`} title={`Add to ${section.name}`}
                                            className="nb-touch-target inline-flex size-5 items-center justify-center rounded-[4px] text-muted-foreground hover:bg-muted hover:text-foreground">
                                            <Plus className="size-3" />
                                        </button>
                                    ) : null}
                                </div>
                            ) : section.name ? <p key={`group:${section.name}`} className="px-1 pt-2 text-[11px] text-muted-foreground">{section.name}</p> : null,
                            // Report 38.11 W9 (A4.1): every open action item across meetings.
                            section.id === "meetings" && !collapsed.includes(section.id) ? (
                                <div key="meetings:views" className="flex flex-wrap gap-x-3 px-1 py-1">
                                    {([["calendar", "Calendar"], ["actions", "Open action items"]] as const).map(([v, label]) => (
                                        <button key={v} type="button" onClick={() => rail.openView(v)} aria-pressed={rail.view === v}
                                            className={cn("text-left text-[12px] hover:text-foreground", rail.view === v ? "font-semibold text-foreground" : "text-muted-foreground")} data-testid={v === "actions" ? "rail-open-action-items" : "rail-meetings-calendar"}>
                                            {label}
                                        </button>
                                    ))}
                                </div>
                            ) : null,
                            section.id && canEdit && section.docs.length === 0 && !collapsed.includes(section.id) ? (
                                <button key={`empty:${section.id}`} type="button" onClick={() => rail.openAdd(section.id!)} className="block w-full px-1 py-1 text-left text-[12px] text-muted-foreground hover:text-foreground">
                                    {EMPTY_LINE[section.id]}
                                </button>
                            ) : null,
                            ...(section.id && collapsed.includes(section.id) ? [] : section.docs).map((doc) => {
                            const isActive = doc.slug === activeSlug;
                            return (
                                <div key={doc.id} className="group relative">
                                    <button
                                        type="button"
                                        onClick={() => rail.navigate(doc.slug)}
                                        aria-current={isActive ? "page" : undefined}
                                        className={cn(
                                            "flex w-full items-center gap-2 rounded-[5px] border px-2.5 py-2 text-left text-[13px] font-medium transition-colors select-none",
                                            canEdit && "pr-8",
                                            isActive ? ACTIVE_ITEM : IDLE_ITEM,
                                        )}
                                    >
                                        <FileText className={cn("size-3.5 shrink-0", isActive ? "text-foreground" : "text-muted-foreground")} />
                                        <span className="min-w-0 flex-1 truncate">{doc.prefix ? <span className="font-mono text-[11px] text-muted-foreground">{doc.prefix} · </span> : null}{doc.title ?? docTitle(doc.filename)}</span>
                                        <OrgDocChips item={org?.mode === "org" ? orgById.get(doc.id) : undefined} />
                                    </button>
                                    {canEdit ? (
                                        <button
                                            type="button"
                                            onClick={() => rail.askRemove(doc)}
                                            aria-label={`Remove ${docTitle(doc.filename)} from Docs`}
                                            title="Remove from docs"
                                            className="absolute right-1.5 top-1/2 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-[4px] text-muted-foreground opacity-0 pointer-coarse:opacity-100 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                                        >
                                            <X className="size-3.5" />
                                        </button>
                                    ) : null}
                                </div>
                            );
                            }),
                        ])
                    )}
                </nav>
                {org ? <FromOrgDocs data={org} activeSlug={activeSlug} /> : null}
                {/* Live-fix 24: the document's options moved to ⋯ in its header. */}
            </div>
            {!passedRail && canEdit ? rail.dialogs : null}
        </aside>
    );
}

export function WorkspaceDocMobileBar({
    projectId,
    activeSlug,
    canEdit = false,
    rail: passedRail,
}: {
    projectId: string;
    activeSlug: string;
    canEdit?: boolean;
    rail?: DocRailState;
}) {
    const internalRail = useDocRail(projectId, activeSlug);
    const rail = passedRail ?? internalRail;
    const org = useOrgDocs(projectId).data ?? null;
    // Report 38.3 W11: on phones the sections become a Section menu over the chips.
    const added = useAddedWorkflows();
    const sections = org?.mode === "org" ? [] : railSections(rail.docs, added);
    const activeSection = sections.find((section) => section.docs.some((doc) => doc.slug === activeSlug))?.id ?? "pages";
    const [picked, setPicked] = useState<DocSection | null>(null);
    const shownSection = picked ?? activeSection;
    const chips = sections.length ? sections.find((section) => section.id === shownSection)?.docs ?? [] : rail.docs;
    const fromOrg = org?.mode === "child" ? <div className="mb-6 xl:hidden"><FromOrgDocs data={org} activeSlug={activeSlug} /></div> : null;

    if (rail.docs.length <= 1 && !rail.isLoading && !canEdit) return fromOrg;

    return (
        <>
        {sections.length ? (
            <label className="mb-2 flex items-center gap-2 text-[12px] text-muted-foreground xl:hidden">
                Section
                <select className="nb-select" data-size="sm" value={shownSection} onChange={(event) => setPicked(event.target.value as DocSection)} data-testid="doc-section-menu">
                    {sections.map((section) => <option key={section.id} value={section.id}>{section.label} ({section.docs.length})</option>)}
                </select>
            </label>
        ) : null}
        <div className="mb-6 flex flex-wrap items-center gap-2 border-b border-border pb-4 xl:hidden max-md:flex-nowrap max-md:overflow-x-auto max-md:snap-x">
            {rail.isLoading ? (
                <div className="flex h-[32px] items-center justify-center px-3 text-muted-foreground text-xs gap-1.5 shrink-0">
                    <PixelBeat className="text-muted-foreground" />
                    Loading documents…
                </div>
            ) : (
                chips.map((doc) => {
                    const isActive = doc.slug === activeSlug;
                    return (
                        <button
                            key={doc.id}
                            type="button"
                            onClick={() => rail.navigate(doc.slug)}
                            aria-current={isActive ? "page" : undefined}
                            ref={isActive ? (element) => element?.scrollIntoView({ block: "nearest", inline: "nearest" }) : undefined}
                            className={cn(
                                "nb-touch-target inline-flex h-[32px] items-center justify-center rounded-[5px] border px-3 text-[12px] font-medium transition-colors truncate shrink-0 select-none max-md:snap-start",
                                isActive ? ACTIVE_ITEM : IDLE_ITEM,
                            )}
                        >
                            <FileText className="size-3.5 shrink-0 mr-1.5 text-muted-foreground" />
                            <span className="truncate">{doc.title ?? docTitle(doc.filename)}</span>
                        </button>
                    );
                })
            )}
            {/* Report 38.11 W11 (A4.1): phones reach Calendar and Open action items from the Meetings row too. */}
            {shownSection === "meetings" && sections.length ? ([["calendar", "Calendar"], ["actions", "Open action items"]] as const).map(([v, label]) => (
                <button key={v} type="button" onClick={() => rail.openView(v)} aria-pressed={rail.view === v} data-testid={`mobile-meetings-${v}`}
                    className={cn("nb-touch-target inline-flex h-[32px] shrink-0 items-center rounded-[5px] border px-3 text-[12px] font-medium max-md:snap-start", rail.view === v ? ACTIVE_ITEM : IDLE_ITEM)}>
                    {label}
                </button>
            )) : null}
            {canEdit ? (
                <AddDocButton onClick={() => rail.openAdd(sections.length ? shownSection : undefined)} className="nb-touch-target h-[32px] w-[32px] shrink-0" />
            ) : null}
        </div>
        {fromOrg}
        </>
    );
}

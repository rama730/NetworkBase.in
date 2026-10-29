"use client";

import { useState } from "react";
import { FileText, Loader2, Plus, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { toast } from "@/lib/feedback";

import { AddDocDialog } from "@/components/projects/doc/AddDocDialog";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { normalizeProjectDocSlug } from "@/lib/projects/doc";
import type { ProjectDocListItem } from "@/lib/projects/doc";
import {
    PROJECT_DOC_LIST_QUERY_KEY,
    PROJECT_DOCS_QUERY_KEY,
    useProjectDocList,
} from "@/hooks/projects/useProjectDocData";
import { cn } from "@/lib/utils";
import { FromOrgDocs, OrgDocAdminTools, OrgDocChips, useOrgDocs } from "@/components/organizations/OrgDocParts";

const ACTIVE_ITEM = "border-foreground/20 bg-muted text-foreground font-semibold";
const IDLE_ITEM = "border-border bg-card text-muted-foreground hover:border-foreground/20 hover:text-foreground hover:bg-muted/40";

export type DocRailState = {
    docs: ProjectDocListItem[];
    isLoading: boolean;
    navigate: (slug: string | null, replace?: boolean) => void;
    openAdd: () => void;
    askRemove: (doc: ProjectDocListItem | null) => void;
    dialogs: React.JSX.Element;
};

// One state machine for the desktop rail and the mobile bar: select, add, remove.
export function useDocRail(projectId: string, activeSlug: string): DocRailState {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const queryClient = useQueryClient();
    const { data: docs = [], isLoading } = useProjectDocList(projectId);
    const [addOpen, setAddOpen] = useState(false);
    const [removing, setRemoving] = useState<ProjectDocListItem | null>(null);

    // Opening a doc is a history entry; leaving a removed doc replaces it.
    const navigate = (slug: string | null, replace = false) => {
        const params = new URLSearchParams(searchParams ? searchParams.toString() : "");
        params.set("tab", "docs");
        params.delete("from"); // own docs, not an org doc opened in place
        if (slug) params.set("doc", normalizeProjectDocSlug(slug));
        else params.delete("doc");
        router[replace ? "replace" : "push"](`${pathname}?${params.toString()}`, { scroll: false });
    };

    const confirmRemove = async () => {
        if (!removing) return;
        const { unlinkProjectDocAction } = await import("@/app/actions/project/doc");
        const result = await unlinkProjectDocAction(projectId, removing.slug);
        if (!result.success) throw new Error(result.error);
        await Promise.all([
            queryClient.invalidateQueries({ queryKey: PROJECT_DOC_LIST_QUERY_KEY(projectId) }),
            queryClient.invalidateQueries({ queryKey: PROJECT_DOCS_QUERY_KEY(projectId) }),
        ]);
        if (removing.slug === activeSlug) navigate(null, true);
        toast.success("Removed from Documents");
    };

    const dialogs = (
        <>
            <AddDocDialog projectId={projectId} open={addOpen} onOpenChange={setAddOpen} />
            <ConfirmDialog
                open={removing !== null}
                onOpenChange={(open) => !open && setRemoving(null)}
                title={`Remove ${removing?.filename ?? "doc"} from Docs?`}
                description="The file stays in Files."
                confirmLabel="Remove"
                variant="destructive"
                onConfirm={confirmRemove}
            />
        </>
    );

    return { docs, isLoading, navigate, openAdd: () => setAddOpen(true), askRemove: setRemoving, dialogs };
}

function AddDocButton({ onClick, className }: { onClick: () => void; className?: string }) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-label="Add doc"
            title="Add doc"
            className={cn("inline-flex items-center justify-center rounded-[5px] border border-border bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground", className)}
        >
            <Plus className="size-3.5" />
        </button>
    );
}

export function ProjectDocRail({
    projectId,
    activeSlug,
    canEdit = false,
    rail: passedRail,
    visibility = "inherit_project",
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
    const grouped = org?.mode === "org"
        ? [
            ...org.groups.map((group) => ({ name: group.name, docs: rail.docs.filter((doc) => orgById.get(doc.id)?.group === group.id) })),
            { name: "Other", docs: rail.docs.filter((doc) => !orgById.has(doc.id)) },
        ].filter((section) => section.docs.length > 0)
        : [{ name: null as string | null, docs: rail.docs }];

    return (
        <aside className="hidden w-full xl:block xl:w-[260px] shrink-0 border-l border-border pl-6" aria-label="Project documents">
            <div className="sticky top-[calc(var(--project-tabs-height,42px)+1rem)] space-y-2">
                <div className="flex items-center justify-between gap-2 pb-2">
                    <span className="nb-ui-label text-[11px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
                        Documents
                    </span>
                    <span className="flex items-center gap-1.5">
                        {rail.isLoading ? (
                            <Loader2 className="size-3 animate-spin text-muted-foreground" />
                        ) : (
                            <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-[3px] border border-border bg-muted/60 px-1 font-mono text-[10px] max-md:text-[11px] font-semibold text-muted-foreground">
                                {rail.docs.length}
                            </span>
                        )}
                        {canEdit ? <AddDocButton onClick={rail.openAdd} className="size-6" /> : null}
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
                            section.name ? <p key={`group:${section.name}`} className="px-1 pt-2 text-[11px] text-muted-foreground">{section.name}</p> : null,
                            ...section.docs.map((doc) => {
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
                                        <span className="min-w-0 flex-1 truncate">{doc.filename}</span>
                                        <OrgDocChips item={org?.mode === "org" ? orgById.get(doc.id) : undefined} />
                                    </button>
                                    {canEdit ? (
                                        <button
                                            type="button"
                                            onClick={() => rail.askRemove(doc)}
                                            aria-label={`Remove ${doc.filename} from Docs`}
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
                {org ? <OrgDocAdminTools data={org} doc={orgById.get(rail.docs.find((doc) => doc.slug === activeSlug)?.id ?? "")} visibility={visibility} /> : null}
            </div>
            {!passedRail && canEdit ? rail.dialogs : null}
        </aside>
    );
}

export function ProjectDocMobileBar({
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
    const fromOrg = org?.mode === "child" ? <div className="mb-6 xl:hidden"><FromOrgDocs data={org} activeSlug={activeSlug} /></div> : null;

    if (rail.docs.length <= 1 && !rail.isLoading && !canEdit) return fromOrg;

    return (
        <>
        <div className="mb-6 flex flex-wrap items-center gap-2 border-b border-border pb-4 xl:hidden max-md:flex-nowrap max-md:overflow-x-auto max-md:snap-x">
            {rail.isLoading ? (
                <div className="flex h-[32px] items-center justify-center px-3 text-muted-foreground text-xs gap-1.5 shrink-0">
                    <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
                    Loading documents…
                </div>
            ) : (
                rail.docs.map((doc) => {
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
                            <span className="truncate">{doc.filename}</span>
                        </button>
                    );
                })
            )}
            {canEdit ? (
                <AddDocButton onClick={rail.openAdd} className="nb-touch-target h-[32px] w-[32px] shrink-0" />
            ) : null}
        </div>
        {fromOrg}
        </>
    );
}

"use client";

import { useEffect, useState } from "react";
import { BookOpenText, Plus } from "lucide-react";
import { useSearchParams } from "next/navigation";

import { AddDocDialog } from "@/components/workspaces/doc/AddDocDialog";
import { Button } from "@/components/ui/button";
import { WorkspaceDocViewer } from "@/components/workspaces/doc/WorkspaceDocViewer";
import { SkeletonDoc } from "@/components/workspaces/skeletons/SkeletonDoc";
import { useWorkspaceDoc } from "@/hooks/workspaces/useWorkspaceDocData";
import { normalizeWorkspaceDocSlug } from "@/lib/workspaces/doc";
import type { Workspace } from "@/types/discover";
import { OrgDocBanner, useMarkOrgDocOpened, useOrgDocs } from "@/components/organizations/OrgDocParts";
import { ItemMenu } from "@/components/reports/ItemMenu";
import { LabLibrary } from "@/components/organizations/LabLibrary";

export default function DocTab({
    projectId,
    project,
}: {
    projectId: string;
    project: Workspace;
}) {
    const searchParams = useSearchParams();
    const paramDoc = searchParams?.get("doc");
    // ?from=org: an org doc read in place inside a child project (report §19.7).
    if (searchParams?.get("from") === "org" && paramDoc) {
        return <OrgDocInPlace project={project} docSlug={normalizeWorkspaceDocSlug(paramDoc)} />;
    }
    // Report 35.4 (B6.4a): a research lab's Library lives in Documents (members only; it checks the lab itself).
    if (searchParams?.get("view") === "library" && project.kind === "organization") return <LabLibrary orgId={projectId} />;
    return <OwnDocs projectId={projectId} project={project} paramDoc={paramDoc ?? null} />;
}

function OrgDocInPlace({ project, docSlug }: { project: Workspace; docSlug: string }) {
    const orgQuery = useOrgDocs(project.id);
    const org = orgQuery.data?.mode === "child" ? orgQuery.data : null;
    if (orgQuery.isLoading) return <SkeletonDoc />;
    if (!org || !org.docs.some((doc) => doc.slug === docSlug)) {
        return (
            <div className="nb-empty-state py-12" role="alert">
                <BookOpenText className="nb-empty-state-icon" aria-hidden="true" />
                <p className="nb-card-title mt-4 text-foreground">You don’t have access to this document</p>
                <p className="nb-compact mt-2 text-muted-foreground">This organization document isn’t shared with this workspace.</p>
            </div>
        );
    }
    return <OrgDocFrame project={project} orgId={org.orgId} orgTitle={org.orgTitle} orgSlug={org.orgSlug} docSlug={docSlug} />;
}

function OrgDocFrame({ project, orgId, orgTitle, orgSlug, docSlug }: { project: Workspace; orgId: string; orgTitle: string; orgSlug: string | null; docSlug: string }) {
    const query = useWorkspaceDoc(orgId, docSlug);
    useMarkOrgDocOpened(query.data?.version ? orgId : null, docSlug, project.id);
    if (query.isLoading) return <SkeletonDoc />;
    if (!query.data?.version) return null;
    const projectSlug = project.slug || project.id;
    return (
        <WorkspaceDocViewer
            key={`${orgId}:${docSlug}:${query.data.version.id}`}
            project={{ ...project, id: orgId, slug: orgSlug ?? undefined, title: orgTitle }}
            payload={{ ...query.data, canEdit: false }}
            docSlug={docSlug}
            inPlaceBanner={<OrgDocBanner
                orgTitle={orgTitle}
                href={`/org/${encodeURIComponent(orgSlug ?? orgId)}?tab=docs&doc=${encodeURIComponent(docSlug)}`}
                backHref={`/workspaces/${encodeURIComponent(projectSlug)}?tab=docs`}
            />}
        />
    );
}

function OwnDocs({ projectId, project, paramDoc }: { projectId: string; project: Workspace; paramDoc: string | null }) {
    const readmeQuery = useWorkspaceDoc(projectId, paramDoc ? normalizeWorkspaceDocSlug(paramDoc) : null);
    const docSlug = readmeQuery.data?.docSlug ?? "readme";
    const canEdit = readmeQuery.data?.canEdit ?? false;
    const hasDocs = (readmeQuery.data?.docs?.length ?? 0) > 0;
    const [addOpen, setAddOpen] = useState(false);
    const [addGroup, setAddGroup] = useState<string | null>(null);
    const orgDocs = useOrgDocs(projectId).data;
    const isOrg = orgDocs?.mode === "org" && orgDocs.signedIn;
    const reportDocId = readmeQuery.data?.docs?.find((doc) => doc.slug === docSlug)?.id ?? null;
    useMarkOrgDocOpened(isOrg && readmeQuery.data?.version ? projectId : null, docSlug, projectId);
    // Live-fix 27: the address names the document you're reading, not a made-up doc=readme.
    const openedSlug = readmeQuery.data?.version ? readmeQuery.data.docSlug : null;
    useEffect(() => {
        if (!openedSlug || paramDoc === openedSlug) return;
        const url = new URL(window.location.href);
        url.searchParams.set("doc", openedSlug);
        window.history.replaceState(window.history.state, "", url);
    }, [openedSlug, paramDoc]);

    if (readmeQuery.isLoading) return <SkeletonDoc />;

    if (readmeQuery.isError) {
        const code = (readmeQuery.error as { code?: string | null }).code;
        return (
            <div className="nb-empty-state py-12" role="alert">
                <BookOpenText className="nb-empty-state-icon" aria-hidden="true" />
                <p className="nb-card-title mt-4 text-foreground">
                    {code === "NOT_FOUND" ? "Document unavailable" : code === "FORBIDDEN" ? "You don’t have access to this document" : "Couldn’t load documents. Try again."}
                </p>
                <p className="nb-compact mt-2 text-muted-foreground">
                    {code === "NOT_FOUND"
                        ? "This doc link is invalid, or the doc was removed."
                        : code === "FORBIDDEN"
                            ? "This doc is not visible to you."
                            : "Check your connection and try again."}
                </p>
                {code ? null : (
                    <Button className="mt-4" variant="outline" onClick={() => void readmeQuery.refetch()}>
                        Retry
                    </Button>
                )}
            </div>
        );
    }

    if (readmeQuery.data?.version) {
        return (
            <WorkspaceDocViewer
                key={`${projectId}:${docSlug}:${readmeQuery.data.version.id}`}
                project={project}
                payload={readmeQuery.data}
                docSlug={docSlug}
                reportMenu={!canEdit && reportDocId ? (
                    // Report a doc from its "⋯" menu (C15); editors fix their own docs instead.
                    <div className="mb-3 flex justify-end"><ItemMenu label="Doc actions" report={{ kind: "doc", targetId: reportDocId, noun: "doc" }} /></div>
                ) : undefined}
            />
        );
    }

    // Report 33.2 layer 11: an empty company handbook shows its four sections, each with Add a page.
    // Report 35.2 call 3 (B6.1b): a lab's guide starts the same way with six lab sections; Safety pages are Required reading.
    if (!hasDocs && canEdit && orgDocs?.mode === "org" && (orgDocs.orgType === "company" || orgDocs.orgType === "research")) {
        const lab = orgDocs.orgType === "research";
        return (
            <section aria-label={lab ? "Lab guide" : "Handbook"} className="mx-auto max-w-2xl space-y-3 py-8" data-testid="empty-handbook">
                <p className="nb-card-title text-foreground">{lab ? "Write your lab guide" : "Your handbook"}</p>
                <p className="nb-compact text-muted-foreground">{lab
                    ? "Six sections to start. Pages in Safety and training are Required reading. Each page stays a draft until you publish it."
                    : "Four sections to start. Each page stays a draft until you publish it."}</p>
                <ul className="divide-y divide-border rounded-md border border-border">
                    {orgDocs.groups.map((g) => (
                        <li key={g.id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-[13px]">
                            <span className="font-medium">{g.name}</span>
                            <Button size="sm" variant="outline" onClick={() => setAddGroup(g.id)}><Plus className="size-3.5" />Add a page<span className="sr-only"> to {g.name}</span></Button>
                        </li>
                    ))}
                </ul>
                <AddDocDialog projectId={projectId} open={Boolean(addGroup)} onOpenChange={(o) => { if (!o) setAddGroup(null); }} orgGroup={addGroup} />
            </section>
        );
    }

    return (
        <div className="nb-empty-state nb-grid-ground py-12" role="status">
            <BookOpenText className="nb-empty-state-icon" aria-hidden="true" />
            <p className="nb-card-title mt-4 text-foreground">
                {hasDocs ? "Not published yet" : orgDocs?.mode === "org" && !canEdit ? (orgDocs.isInside ? "Nothing shared yet" : "No public documents") : "No documents yet"}
            </p>
            <p className="nb-compact mt-2 text-muted-foreground">
                {hasDocs
                    ? "This doc has no published version yet."
                    : orgDocs?.mode === "org"
                        // Report §7.4: what each person sees with no documents.
                        ? canEdit ? "Add the first document. It stays a draft until you publish it." : orgDocs.isInside ? "Documents your admins publish show here." : "This organization hasn’t made any documents public."
                    : canEdit
                        ? "Add Markdown files from Files to see them here."
                        : "This workspace has no docs visible to you."}
            </p>
            {canEdit ? (
                <>
                    <Button className="mt-4" onClick={() => setAddOpen(true)}>
                        <Plus className="size-4" />
                        Add document
                    </Button>
                    <AddDocDialog projectId={projectId} open={addOpen} onOpenChange={setAddOpen} />
                </>
            ) : null}
        </div>
    );
}

"use client";

import { useState } from "react";
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
import { ReportButton } from "@/components/reports/ReportDialog";

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
                <p className="nb-card-title mt-4 text-foreground">Doc not visible</p>
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
    const orgDocs = useOrgDocs(projectId).data;
    const isOrg = orgDocs?.mode === "org" && orgDocs.signedIn;
    const reportDocId = readmeQuery.data?.docs?.find((doc) => doc.slug === docSlug)?.id ?? null;
    useMarkOrgDocOpened(isOrg && readmeQuery.data?.version ? projectId : null, docSlug, projectId);

    if (readmeQuery.isLoading) return <SkeletonDoc />;

    if (readmeQuery.isError) {
        const code = (readmeQuery.error as { code?: string | null }).code;
        return (
            <div className="nb-empty-state py-12" role="alert">
                <BookOpenText className="nb-empty-state-icon" aria-hidden="true" />
                <p className="nb-card-title mt-4 text-foreground">
                    {code === "NOT_FOUND" ? "Doc unavailable" : code === "FORBIDDEN" ? "Doc not visible" : "Docs could not be loaded"}
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
                inPlaceBanner={isOrg && !canEdit && reportDocId ? (
                    // Report an org doc (report §30.3); editors fix their own docs instead.
                    <div className="mb-3 flex justify-end"><ReportButton kind="doc" targetId={reportDocId} noun="doc" /></div>
                ) : undefined}
            />
        );
    }

    return (
        <div className="nb-empty-state nb-grid-ground py-12" role="status">
            <BookOpenText className="nb-empty-state-icon" aria-hidden="true" />
            <p className="nb-card-title mt-4 text-foreground">
                {hasDocs ? "Not published yet" : "No documents yet"}
            </p>
            <p className="nb-compact mt-2 text-muted-foreground">
                {hasDocs
                    ? "This doc has no published version yet."
                    : canEdit
                        ? "Pin Markdown files from Files to read them here."
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

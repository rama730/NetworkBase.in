"use client";

import { useState } from "react";
import { BookOpenText, Plus } from "lucide-react";
import { useSearchParams } from "next/navigation";

import { AddDocDialog } from "@/components/projects/doc/AddDocDialog";
import { Button } from "@/components/ui/button";
import { ProjectDocViewer } from "@/components/projects/doc/ProjectDocViewer";
import { SkeletonDoc } from "@/components/projects/skeletons/SkeletonDoc";
import { useProjectDoc } from "@/hooks/projects/useProjectDocData";
import { normalizeProjectDocSlug } from "@/lib/projects/doc";
import type { Project } from "@/types/discover";

export default function DocTab({
    projectId,
    project,
}: {
    projectId: string;
    project: Project;
}) {
    const searchParams = useSearchParams();
    const paramDoc = searchParams?.get("doc");
    const readmeQuery = useProjectDoc(projectId, paramDoc ? normalizeProjectDocSlug(paramDoc) : null);
    const docSlug = readmeQuery.data?.docSlug ?? "readme";
    const canEdit = readmeQuery.data?.canEdit ?? false;
    const hasDocs = (readmeQuery.data?.docs?.length ?? 0) > 0;
    const [addOpen, setAddOpen] = useState(false);

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
            <ProjectDocViewer
                key={`${projectId}:${docSlug}:${readmeQuery.data.version.id}`}
                project={project}
                payload={readmeQuery.data}
                docSlug={docSlug}
            />
        );
    }

    return (
        <div className="nb-empty-state nb-grid-ground py-12" role="status">
            <BookOpenText className="nb-empty-state-icon" aria-hidden="true" />
            <p className="nb-card-title mt-4 text-foreground">
                {hasDocs ? "Not published yet" : "No docs yet"}
            </p>
            <p className="nb-compact mt-2 text-muted-foreground">
                {hasDocs
                    ? "This doc has no published version yet."
                    : canEdit
                        ? "Pin Markdown files from Files to read them here."
                        : "This project has no docs visible to you."}
            </p>
            {canEdit ? (
                <>
                    <Button className="mt-4" onClick={() => setAddOpen(true)}>
                        <Plus className="size-4" />
                        Add doc
                    </Button>
                    <AddDocDialog projectId={projectId} open={addOpen} onOpenChange={setAddOpen} />
                </>
            ) : null}
        </div>
    );
}

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
    const [addOpen, setAddOpen] = useState(false);

    if (readmeQuery.isLoading) return <SkeletonDoc />;

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
                No docs yet
            </p>
            <p className="nb-compact mt-2 text-muted-foreground">
                {canEdit
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

"use client";

import { BookOpenText } from "lucide-react";
import { useSearchParams } from "next/navigation";

import { ProjectDocViewer } from "@/components/projects/doc/ProjectDocViewer";
import { SkeletonDoc } from "@/components/projects/skeletons/SkeletonDoc";
import { useProjectDoc } from "@/hooks/hub/useProjectDocData";
import { normalizeProjectDocSlug } from "@/lib/projects/doc";
import type { Project } from "@/types/hub";

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
                Document unavailable
            </p>
            <p className="nb-compact mt-2 text-muted-foreground">
                This project has not published a document that is visible to you.
            </p>
        </div>
    );
}

"use client";

import React, { useMemo, useState, useCallback, Suspense } from "react";
import dynamic from "next/dynamic";
import { cn } from "@/lib/utils";
import type { Project } from "@/types/discover";
import { isTrustedPublicReadmeImageHost } from "@/lib/workspaces/doc-media";
import { useFilesStore } from "@/stores/files";
import type { FilesStoreState } from "@/stores/files/types";

const ProjectDocRenderer = dynamic(
  () => import("@/components/workspaces/doc/WorkspaceDocRenderer").then((mod) => mod.ProjectDocRenderer),
  { ssr: false }
);

interface MarkdownPreviewProps {
  content: string;
  className?: string;
  projectId?: string;
  project?: Project;
  fidelity?: "app" | "github";
}

const EMPTY_PREVIEW_MAP = new Map();

/**
 * MarkdownPreview
 *
 * Ponytail Framework ("shrink:", "stdlib:", "native:"):
 * Reuses the canonical `ProjectDocRenderer` from the Docs tab directly as-is
 * rather than maintaining a separate parallel Markdown rendering engine.
 * Ensures 100% visual and behavioral parity between the Docs tab and Files tab
 * for READMEs and Markdown files with zero duplication and zero hydration errors.
 */
export default function MarkdownPreview({
  content,
  className,
  projectId,
  project,
  fidelity = "github",
}: MarkdownPreviewProps) {
  const [allowRemoteImages, setAllowRemoteImages] = useState(false);
  const handleAllowRemoteImages = useCallback(() => setAllowRemoteImages(true), []);

  const gitRepoUrl = useFilesStore(
    (s: FilesStoreState) => (projectId ? s.byProjectId[projectId]?.git?.repoUrl : null)
  );
  const gitBranch = useFilesStore(
    (s: FilesStoreState) => (projectId ? s.byProjectId[projectId]?.git?.branch : null)
  );

  const projectObject = useMemo<Project>(() => {
    if (project) return project;
    return {
      id: projectId || "project",
      title: "",
      status: "active",
      slug: projectId,
      githubRepoUrl: gitRepoUrl ?? null,
      githubDefaultBranch: gitBranch ?? null,
    } as Project;
  }, [project, projectId, gitRepoUrl, gitBranch]);

  const hasUntrustedRemoteImages = useMemo(() => {
    const matches = content.matchAll(
      /(?:!\[.*?\]\((https?:\/\/[^\s)]+|\/\/[^\s)]+)\)|<img[^>]+src=["'](https?:\/\/[^"']+|\/\/[^"']+)["'])/gi
    );
    for (const match of matches) {
      const url = match[1] || match[2];
      if (url && !isTrustedPublicReadmeImageHost(url)) {
        return true;
      }
    }
    return false;
  }, [content]);

  return (
    <div className={cn("markdown-body overflow-auto h-full p-4 sm:p-6 bg-card text-foreground", className)}>
      {hasUntrustedRemoteImages && !allowRemoteImages ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-[5px] border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          <span>Remote images in this preview are blocked for privacy.</span>
          <button
            type="button"
            onClick={handleAllowRemoteImages}
            className="rounded-[3px] border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted transition-colors pointer-coarse:h-9"
          >
            Load all remote images
          </button>
        </div>
      ) : null}
      <Suspense fallback={<div className="text-sm text-muted-foreground p-4">Loading preview…</div>}>
        <ProjectDocRenderer
          content={content}
          project={projectObject}
          allowExternalImages={allowRemoteImages}
          allowSmartBlocks={false}
          previewByKey={EMPTY_PREVIEW_MAP}
          previewsLoading={false}
          fidelity={fidelity}
          onAllowExternalImages={handleAllowRemoteImages}
        />
      </Suspense>
    </div>
  );
}

'use client';

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast, feedbackError } from "@/lib/feedback";
import { resolveProjectUpdateMentionTargetAction, type ProjectUpdateView } from "@/app/actions/workspace/updates";
import {
    ProjectUpdateMediaFrame,
    ProjectUpdateMediaViewer,
    isProjectUpdateVideoMedia,
} from "@/components/workspaces/updates/WorkspaceUpdateMediaFrame";
import { type ProjectUpdateMediaItem } from "@/lib/workspaces/updates";
import { cn } from "@/lib/utils";
import { splitMarkdownByInlineReferences } from "@/lib/workspaces/doc-blocks";
import { isSafeHttpUrl } from "@/lib/security/urls";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type UpdateReferenceLinkKind = "task" | "sprint" | "file";

function normalizeUpdateReferenceLinkKind(kind: string): UpdateReferenceLinkKind | null {
  if (kind === "task" || kind === "tasks") return "task";
  if (kind === "sprint" || kind === "sprints") return "sprint";
  if (kind === "file" || kind === "files") return "file";
  return null;
}

function referenceFallbackHref(reference: { kind: string; id: string }, projectId: string, projectSlug?: string | null) {
  const slug = encodeURIComponent(projectSlug || projectId);
  const id = encodeURIComponent(reference.id);
  const kind = normalizeUpdateReferenceLinkKind(reference.kind);
  if (kind === "task") return `/workspaces/${slug}?tab=tasks&drawerType=task&drawerId=${id}`;
  if (kind === "sprint") return `/workspaces/${slug}?tab=sprints&sprintId=${id}`;
  if (kind === "file") return `/workspaces/${slug}?tab=files&fileId=${id}`;
  return `/workspaces/${slug}?tab=updates`;
}

function ReferenceLink({
  reference,
  projectId,
  projectSlug,
}: {
  reference: { kind: string; id: string; label: string };
  projectId: string;
  projectSlug?: string | null;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const normalizedKind = normalizeUpdateReferenceLinkKind(reference.kind);
  const isClickable = Boolean(normalizedKind);
  const fallbackHref = referenceFallbackHref(reference, projectId, projectSlug);

  const handleClick = async (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    e.stopPropagation();

    if (!isClickable || loading) return;
    setLoading(true);
    try {
      const result = await resolveProjectUpdateMentionTargetAction(projectId, {
        kind: normalizedKind,
        id: reference.id,
      });
      if (!result.success) {
        toast.error(feedbackError(result.error || "This item is not available or you do not have access", "This item is not available or you do not have access"));
        return;
      }
      router.push(result.href);
    } catch (err) {
      console.error("Failed to navigate to project update mention:", err);
      toast.error("This item is not available or you do not have access");
    } finally {
      setLoading(false);
    }
  };

  if (!isClickable) {
    if (reference.kind === "contributors") {
      const initial = reference.label.trim().charAt(0).toUpperCase() || "U";
      return (
        <span className="inline-flex items-center gap-1 mx-1 rounded-[3px] border border-border bg-muted/60 px-1.5 py-0.5 font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-foreground">
          <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[2px] bg-primary/10 text-[10px] font-semibold text-primary">
            {initial}
          </span>
          {reference.label}
        </span>
      );
    }
    return (
      <span className="mx-0.5 inline font-medium text-primary">
        {reference.label}
      </span>
    );
  }

  return (
    <a
      href={fallbackHref}
      onClick={handleClick}
      aria-disabled={loading}
      className={cn(
        "mx-0.5 inline cursor-pointer p-0 align-baseline text-sm font-medium text-primary underline-offset-2 transition hover:underline aria-disabled:cursor-not-allowed aria-disabled:opacity-75",
        loading && "nb-skeleton"
      )}
    >
      {reference.label}
    </a>
  );
}

const REFERENCE_HREF = /^#nb-update-ref-(\d+)$/;

/**
 * An update's text as the author wrote it: Markdown (bold, lists, links, code), with inline `#task`-style
 * references still resolving through their access check. Raw HTML and images are dropped, and only safe web
 * links are clickable, the same rules as profile stories.
 */
export function ProjectUpdateContent({
  content,
  projectId,
  projectSlug,
  className,
}: {
  content: string;
  projectId: string;
  projectSlug?: string | null;
  className?: string;
}) {
  if (!content.trim()) return null;
  // References become placeholder links in one Markdown pass, so paragraphs and lists stay whole around them.
  const references: Array<{ kind: string; id: string; label: string }> = [];
  const markdown = splitMarkdownByInlineReferences(content)
    .map((segment) => {
      if (segment.kind === "markdown") return segment.content;
      references.push(segment.reference);
      return `[${segment.reference.label.replace(/[\[\]\\*_`<>]/g, "")}](#nb-update-ref-${references.length - 1})`;
    })
    .join("");

  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          img: () => null,
          a: ({ href, children }) => {
            const match = REFERENCE_HREF.exec(href ?? "");
            const reference = match ? references[Number(match[1])] : null;
            if (reference) {
              return <ReferenceLink reference={reference} projectId={projectId} projectSlug={projectSlug} />;
            }
            if (!href || !isSafeHttpUrl(href)) return <span>{children}</span>;
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(event) => event.stopPropagation()}
                className="text-primary underline underline-offset-2 break-words"
              >
                {children}
              </a>
            );
          },
          ul: ({ children }) => <ul className="list-disc pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-5">{children}</ol>,
          code: ({ children }) => <code className="rounded-[3px] bg-muted px-1 py-px font-mono text-[0.9em]">{children}</code>,
          h1: ({ children }) => <p className="font-semibold">{children}</p>,
          h2: ({ children }) => <p className="font-semibold">{children}</p>,
          h3: ({ children }) => <p className="font-semibold">{children}</p>,
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}

export function UpdateContextAndMedia({
  update,
  compact = false,
}: {
  update: ProjectUpdateView;
  compact?: boolean;
}) {
  const [viewerMedia, setViewerMedia] = useState<ProjectUpdateMediaItem | null>(null);
  const mediaItems = update.media.filter((item) => item.url || item.label);

  if (mediaItems.length === 0) return null;

  return (
    <div className={cn("mt-2 space-y-2", compact && "max-w-full")}>

      {mediaItems.map((item, index) =>
        item.url && (item.type === "image" || isProjectUpdateVideoMedia(item)) ? (
          <ProjectUpdateMediaFrame
            key={`${item.url}-${index}`}
            item={item}
            src={item.url}
            alt={item.altText || item.label || "Workspace update image"}
            className={compact ? "max-h-[220px] w-full object-cover" : undefined}
            onOpen={item.type === "image" ? () => setViewerMedia(item) : undefined}
            openLabel={`Open ${item.label || item.altText || "workspace update media"}`}
          />
        ) : (
          <a
            key={`${item.url ?? item.label}-${index}`}
            href={item.url ?? "#"}
            target={item.url ? "_blank" : undefined}
            rel={item.url ? "noreferrer" : undefined}
            className="inline-flex min-w-0 items-center font-mono text-xs text-foreground underline underline-offset-4 decoration-border hover:decoration-foreground transition-colors"
          >
            <span className="truncate">{item.label || item.url || "Linked item"}</span>
          </a>
        ),
      )}
      <ProjectUpdateMediaViewer
        item={viewerMedia}
        onOpenChange={(open) => {
          if (!open) setViewerMedia(null);
        }}
      />
    </div>
  );
}

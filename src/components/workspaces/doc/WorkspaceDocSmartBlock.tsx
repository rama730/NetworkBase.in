"use client";

import Link from "next/link";
import { AlertCircle, FileText, FolderKanban, FolderOpen, ListTodo, Sparkles, Timer, Users } from "@/components/ui/icons";

import { WorkspaceDocSmartBlockPreviewCard } from "@/components/workspaces/doc/WorkspaceDocReferencePreview";
import type { WorkspaceDocSmartBlock, WorkspaceDocSmartBlockPreview } from "@/lib/workspaces/doc-blocks";
import type { Workspace } from "@/types/discover";
import { cn } from "@/lib/utils";

const BLOCK_COPY: Record<WorkspaceDocSmartBlock["kind"], { title: string; icon: typeof Sparkles; tab: string; description: string }> = {
    roles: {
        title: "Open roles",
        icon: Users,
        tab: "settings",
        description: "Role needs and application context from the workspace.",
    },
    contributors: {
        title: "Contributors",
        icon: Users,
        tab: "dashboard",
        description: "People working in this workspace.",
    },
    files: {
        title: "Referenced files",
        icon: FolderOpen,
        tab: "files",
        description: "Managed files that are safe for this viewer.",
    },
    tasks: {
        title: "Referenced tasks",
        icon: ListTodo,
        tab: "tasks",
        description: "Workspace work items linked from the Doc.",
    },
    sprints: {
        title: "Sprint summary",
        icon: Timer,
        tab: "sprints",
        description: "Planning rhythm and sprint movement.",
    },
    projects: {
        title: "Workspaces",
        icon: FolderKanban,
        tab: "projects",
        description: "Workspaces inside this organization, live.",
    },
    unknown: {
        title: "Unknown doc block",
        icon: AlertCircle,
        tab: "readme",
        description: "This block is not recognized and is hidden from public readers.",
    },
};

export function WorkspaceDocSmartBlock({
    block,
    project,
    editorMode = false,
    preview,
    loading = false,
}: {
    block: WorkspaceDocSmartBlock;
    project: Workspace;
    editorMode?: boolean;
    preview?: WorkspaceDocSmartBlockPreview | null;
    loading?: boolean;
}) {
    if (block.kind === "unknown" && !editorMode) return null;
    if (preview) return <WorkspaceDocSmartBlockPreviewCard preview={preview} />;
    if (loading && block.kind !== "unknown") {
        return (
            <div className="my-4 rounded-[8px] border border-border bg-card/60 p-4">
                <div className="flex items-center gap-3">
                    <div aria-hidden="true" className="nb-skeleton size-8 rounded-[5px]" />
                    <div className="min-w-0 flex-1 space-y-2">
                        <div aria-hidden="true" className="nb-skeleton h-3 w-40 rounded-[3px]" />
                        <div aria-hidden="true" className="nb-skeleton h-3 w-64 max-w-full rounded-[3px]" />
                    </div>
                </div>
            </div>
        );
    }

    const copy = BLOCK_COPY[block.kind];
    const Icon = copy.icon;
    const slugOrId = project.slug || project.id;
    const href = `/workspaces/${encodeURIComponent(slugOrId)}?tab=${copy.tab}`;
    const roles = Array.isArray((project as any).openRoles) ? (project as any).openRoles : [];
    const collaborators = Array.isArray((project as any).collaborators) ? (project as any).collaborators : [];

    const summary =
        block.kind === "roles"
            ? `${roles.length} role${roles.length === 1 ? "" : "s"} listed`
            : block.kind === "contributors"
                ? `${collaborators.length} member${collaborators.length === 1 ? "" : "s"}`
                : block.kind === "files" || block.kind === "tasks"
                ? block.ids.length > 0 ? `${block.ids.length} specific item${block.ids.length === 1 ? "" : "s"} linked` : "Open the workspace to see current items"
                    : block.kind === "sprints"
                        ? "Open the sprint schedule"
                        : block.kind === "projects"
                        ? "Open the organization’s workspaces"
                        : "Needs editing";

    return (
        <div
            className={cn(
                "my-4 rounded-[8px] border p-4 bg-card transition-colors",
                block.kind === "unknown"
                    ? "border-amber-500/30 bg-amber-500/5 text-foreground"
                    : "border-border hover:border-foreground/20 text-foreground",
            )}
        >
            <div className="flex items-start gap-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-[5px] border border-border bg-muted/50 text-foreground">
                    <Icon className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                    <p className="nb-ui-label font-semibold text-foreground">{copy.title}</p>
                    <p className="nb-compact mt-0.5 text-xs text-muted-foreground">{copy.description}</p>
                    <p className="nb-meta mt-2 text-[11px] uppercase tracking-wider text-muted-foreground font-mono">{summary}</p>
                </div>
                {block.kind !== "unknown" ? (
                    <Link
                        href={href}
                        className="nb-touch-target inline-flex h-[28px] items-center justify-center rounded-[5px] border border-border bg-card px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted"
                    >
                        Open
                    </Link>
                ) : (
                    <FileText className="size-4 text-muted-foreground" />
                )}
            </div>
        </div>
    );
}

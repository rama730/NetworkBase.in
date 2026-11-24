"use client";

import { AlertTriangle, FileText, FolderKanban, ListTodo, Timer, Users } from "lucide-react";
import Image from "next/image";

import type { WorkspaceDocReferenceOption, WorkspaceDocSmartBlockPreview } from "@/lib/workspaces/doc-blocks";
import { getTaskTitlePresentation } from "@/lib/workspaces/task-presentation";
import { cn } from "@/lib/utils";

const KIND_ICON = {
    roles: Users,
    contributors: Users,
    files: FileText,
    tasks: ListTodo,
    sprints: Timer,
    projects: FolderKanban,
    unknown: AlertTriangle,
} as const;

function referenceMeta(option: WorkspaceDocReferenceOption) {
    return option.context || [option.status, option.meta, option.subtitle].filter(Boolean).join(" · ") || "Workspace reference";
}

export function WorkspaceDocReferenceOptionCard({ option }: { option: WorkspaceDocReferenceOption }) {
    const Icon = KIND_ICON[option.kind] ?? FileText;
    const titlePresentation = option.kind === "tasks"
        ? getTaskTitlePresentation(option)
        : null;
    const content = (
        <div className="flex min-w-0 items-center gap-2.5">
            {option.avatarUrl ? (
                <Image src={option.avatarUrl} alt="" width={32} height={32} sizes="32px" className="size-8 rounded-[5px] border border-border object-cover" />
            ) : (
                <span className="flex size-8 shrink-0 items-center justify-center rounded-[5px] border border-border bg-muted/50 text-muted-foreground">
                    <Icon className="size-3.5" />
                </span>
            )}
            <div className="min-w-0 flex-1">
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                    <p
                        className={cn("truncate nb-ui-label text-xs font-semibold text-foreground", titlePresentation?.className)}
                        aria-label={titlePresentation?.ariaLabel}
                    >
                        {option.title}
                    </p>
                    {option.status ? (
                        <span className="inline-flex h-5 items-center rounded-[3px] border border-border bg-muted/60 px-[7px] font-mono text-[11px] uppercase tracking-[0.09em] leading-none text-muted-foreground">
                            {option.status}
                        </span>
                    ) : null}
                </div>
                <p className="mt-0.5 truncate nb-meta text-[11px] text-muted-foreground">{referenceMeta(option)}</p>
                {option.badges?.length ? (
                    <div className="mt-1 flex flex-wrap gap-1">
                        {option.badges.slice(0, 3).map((badge) => (
                            <span key={badge} className="inline-flex h-5 items-center rounded-[3px] border border-border bg-muted/40 px-[7px] font-mono text-[11px] uppercase tracking-[0.09em] leading-none text-muted-foreground">
                                {badge}
                            </span>
                        ))}
                    </div>
                ) : null}
            </div>
        </div>
    );

    return <div className="rounded-[5px] border border-border bg-card px-3 py-2">{content}</div>;
}

export function WorkspaceDocSmartBlockPreviewCard({ preview }: { preview: WorkspaceDocSmartBlockPreview }) {
    const Icon = KIND_ICON[preview.kind] ?? FileText;
    return (
        <div
            className={cn(
                "my-3 rounded-[8px] border p-4 bg-card transition-colors",
                preview.safeUnavailable
                    ? "border-amber-500/30 bg-amber-500/5"
                    : "border-border hover:border-foreground/20",
            )}
        >
            <div className="flex items-start gap-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-[5px] border border-border bg-muted/50">
                    <Icon className={cn("size-4", preview.safeUnavailable ? "text-amber-500" : "text-muted-foreground")} />
                </span>
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                            <p className="nb-ui-label text-sm font-semibold text-foreground">{preview.title}</p>
                            <p className="nb-compact mt-0.5 text-xs text-muted-foreground">{preview.description}</p>
                        </div>
                        {preview.href && !preview.safeUnavailable ? (
                            <a href={preview.href} className="nb-touch-target inline-flex h-[28px] items-center justify-center rounded-[5px] border border-border bg-card px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted">
                                Open
                            </a>
                        ) : null}
                    </div>
                    {preview.items.length > 0 ? (
                        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                            {preview.items.slice(0, 4).map((item) => <WorkspaceDocReferenceOptionCard key={`${item.kind}-${item.id}`} option={item} />)}
                        </div>
                    ) : null}
                    {preview.unavailableCount > 0 ? (
                        <p className="mt-3 text-xs font-medium text-amber-600 dark:text-amber-400">
                            {preview.unavailableCount} referenced item{preview.unavailableCount === 1 ? "" : "s"} unavailable.
                        </p>
                    ) : null}
                </div>
            </div>
        </div>
    );
}

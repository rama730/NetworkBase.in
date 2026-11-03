"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { Camera } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { Workspace } from "@/types/discover";

export function getWorkspaceAvatarUrl(project: Partial<Workspace> | null | undefined): string | null {
    if (!project) return null;
    const raw = project.coverImage ?? (project as any).cover_image ?? (project as any).coverImageUrl ?? (project as any).cover_image_url;
    if (typeof raw !== "string") return null;
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
}

/**
 * Broadcast project metadata and cover updates across local windows and tabs (1M users scale)
 */
export function broadcastWorkspaceUpdated(projectId: string, update?: { coverImage?: string | null }) {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent("nb-project-updated", { detail: { projectId, update } }));
    if (typeof BroadcastChannel !== "undefined") {
        try {
            const channel = new BroadcastChannel("nb-project-updated-v1");
            channel.postMessage({ projectId, update });
            channel.close();
        } catch {
            // Ignore restricted cross-origin contexts
        }
    }
}

interface ProjectAvatarProps {
    project: Partial<Workspace>;
    /** "row": 24px, for list rows like the Overview's Workspaces (live-fix 17). */
    size?: "detail" | "card" | "row";
    className?: string;
    isOwner?: boolean;
    slugOrId?: string;
    priority?: boolean;
    /** Keep the slot without an image: initials, or for the owner a way to add one. */
    placeholder?: boolean;
}

export function WorkspaceAvatar({
    project,
    size = "detail",
    className,
    isOwner = false,
    slugOrId,
    priority,
    placeholder = false,
}: ProjectAvatarProps) {
    const avatarUrl = getWorkspaceAvatarUrl(project);
    const [hasError, setHasError] = useState(false);

    useEffect(() => {
        setHasError(false);
    }, [avatarUrl]);

    const hasImage = Boolean(avatarUrl) && !hasError;
    if (!hasImage && !placeholder) {
        return null;
    }

    const isDetail = size === "detail";
    const dimensionClasses = isDetail ? "size-[80px] rounded-xl" : size === "row" ? "size-6 rounded" : "size-11 rounded-md";
    const imageSize = isDetail ? "80px" : size === "row" ? "24px" : "44px";

    return (
        <div className="relative inline-flex shrink-0">
            <div
                data-testid="project-avatar"
                data-size={size}
                className={cn(
                    "group/avatar relative shrink-0 overflow-hidden border border-border/80 bg-muted/40 ring-1 ring-inset ring-black/5 dark:ring-white/10 transition-all duration-[180ms] ease-[cubic-bezier(.2,.8,.3,1)]",
                    dimensionClasses,
                    !isDetail && "group-hover:border-foreground/25 group-hover:shadow-xs",
                    !hasImage && "flex items-center justify-center",
                    !hasImage && isOwner && slugOrId && "border-dashed",
                    className
                )}
            >
                {!hasImage ? (isOwner && slugOrId ? (
                    <Link
                        href={`/workspaces/${slugOrId}?tab=settings#project-settings-general`}
                        aria-label="Add workspace avatar"
                        title="Add workspace avatar"
                        className="flex size-full items-center justify-center text-muted-foreground transition-colors duration-[180ms] hover:bg-muted hover:text-foreground"
                    >
                        <Camera className="size-5" aria-hidden="true" />
                    </Link>
                ) : (
                    <span className={cn("font-semibold text-muted-foreground", size === "row" ? "text-[10px]" : "text-lg max-md:text-sm")} aria-hidden="true">{(project.title || "").slice(0, 2).toUpperCase()}</span>
                )) : <>
                <Image
                    src={avatarUrl!}
                    // On a card the title sits right beside it: a decorative image, not a second title.
                    alt={size === "card" ? "" : `${project.title || "Workspace"} avatar`}
                    fill
                    sizes={imageSize}
                    priority={priority ?? isDetail}
                    loading={isDetail ? "eager" : "lazy"}
                    decoding="async"
                    style={{ objectFit: "cover" }}
                    className="object-cover"
                    onError={() => setHasError(true)}
                    unoptimized
                />
                {isDetail && isOwner && slugOrId && (
                    <Link
                        href={`/workspaces/${slugOrId}?tab=settings#project-settings-general`}
                        aria-label="Change workspace avatar"
                        title="Change workspace avatar"
                        className="absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 backdrop-blur-[2px] transition-opacity duration-[180ms] hover:opacity-100 focus:opacity-100 focus:outline-none"
                    >
                        <Camera className="size-4 text-white drop-shadow-xs" aria-hidden="true" />
                    </Link>
                )}
                </>}
            </div>
        </div>
    );
}

export default WorkspaceAvatar;

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
    size?: "detail" | "card";
    className?: string;
    isOwner?: boolean;
    slugOrId?: string;
    priority?: boolean;
}

export function WorkspaceAvatar({
    project,
    size = "detail",
    className,
    isOwner = false,
    slugOrId,
    priority,
}: ProjectAvatarProps) {
    const avatarUrl = getWorkspaceAvatarUrl(project);
    const [hasError, setHasError] = useState(false);

    useEffect(() => {
        setHasError(false);
    }, [avatarUrl]);

    if (!avatarUrl || hasError) {
        return null;
    }

    const isDetail = size === "detail";
    const dimensionClasses = isDetail ? "size-[80px] rounded-xl" : "size-11 rounded-md";
    const imageSize = isDetail ? "80px" : "44px";

    return (
        <div className="relative inline-flex shrink-0">
            <div
                data-testid="project-avatar"
                data-size={size}
                className={cn(
                    "group/avatar relative shrink-0 overflow-hidden border border-border/80 bg-muted/40 ring-1 ring-inset ring-black/5 dark:ring-white/10 transition-all duration-[180ms] ease-[cubic-bezier(.2,.8,.3,1)]",
                    dimensionClasses,
                    !isDetail && "group-hover:border-foreground/25 group-hover:shadow-xs",
                    className
                )}
            >
                <Image
                    src={avatarUrl}
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
            </div>
        </div>
    );
}

export default WorkspaceAvatar;

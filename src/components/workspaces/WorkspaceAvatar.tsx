"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { Camera } from "@/components/ui/icons";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { PixelPlace } from "@/components/ui/PixelPerson";
import type { PixelPlaceKind } from "@/lib/ui/avatar";
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
    /** Kept for callers; every workspace without a picture now shows its default pixel avatar. */
    placeholder?: boolean;
    /** The organization a child workspace sits in: it draws the desk under that org's roof, in the org's colours. */
    parentId?: string | null;
    /** Force the figure when the project object doesn't say (an org's own row, an invite to an org). */
    kind?: PixelPlaceKind;
}

/** Which default figure a place without a picture gets, and whose colours. */
export function workspacePixelFigure(project: Partial<Workspace>, parentId?: string | null, kind?: PixelPlaceKind) {
    const figure: PixelPlaceKind = kind ?? (project.kind === "organization" ? "organization" : parentId ? "child" : "workspace");
    const key = figure === "child" && parentId ? parentId : String(project.id ?? project.slug ?? project.title ?? "workspace");
    return { figure, key };
}

export function WorkspaceAvatar({
    project,
    size = "detail",
    className,
    isOwner = false,
    slugOrId,
    priority,
    parentId = null,
    kind,
}: ProjectAvatarProps) {
    const avatarUrl = getWorkspaceAvatarUrl(project);
    const [hasError, setHasError] = useState(false);

    useEffect(() => {
        setHasError(false);
    }, [avatarUrl]);

    // No picture: the default pixel avatar for its kind (shell redesign: headers, cards, lists and search always show one).
    const hasImage = Boolean(avatarUrl) && !hasError;
    const pixel = workspacePixelFigure(project, parentId, kind);

    const isDetail = size === "detail";
    const dimensionClasses = isDetail ? "size-[72px] rounded-lg" : size === "row" ? "size-[26px] rounded-md" : "size-11 rounded-md";
    const imageSize = isDetail ? "72px" : size === "row" ? "26px" : "44px";

    return (
        <div className="relative inline-flex shrink-0">
            <div
                data-testid="project-avatar"
                data-size={size}
                className={cn(
                    "group/avatar relative shrink-0 overflow-hidden border border-border/80 bg-muted/40 ring-1 ring-inset ring-black/5 dark:ring-white/10 transition-all duration-[180ms] ease-[cubic-bezier(.2,.8,.3,1)]",
                    dimensionClasses,
                    !isDetail && "group-hover:border-foreground/25 group-hover:shadow-xs",
                    !hasImage && "flex items-center justify-center border-transparent ring-0",
                    className
                )}
            >
                {!hasImage ? <>
                    <PixelPlace kind={pixel.figure} identityKey={pixel.key} size={isDetail ? 72 : size === "row" ? 26 : 44} className="size-full" />
                    {isOwner && slugOrId ? (
                        <Link
                            href={`/workspaces/${slugOrId}?tab=settings#project-settings-general`}
                            aria-label={project.kind === "organization" ? "Add organization image" : "Add workspace avatar"}
                            title={project.kind === "organization" ? "Add organization image" : "Add workspace avatar"}
                            className="absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 backdrop-blur-[2px] transition-opacity duration-[180ms] hover:opacity-100 focus:opacity-100 focus:outline-none"
                        >
                            <Camera className={cn("text-white drop-shadow-xs", isDetail ? "size-4" : "size-3.5")} aria-hidden="true" />
                        </Link>
                    ) : null}
                </> : <>
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

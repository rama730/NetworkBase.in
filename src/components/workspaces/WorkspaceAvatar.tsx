"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { Camera } from "lucide-react";
import Link from "next/link";
import { isToday, isAfter, subDays } from "@/lib/utils/date";
import { cn } from "@/lib/utils";
import { WorkspacePresenceBadge } from "@/components/presence/PersonPresence";
import { isLooseUuid } from "@/lib/validations/uuid";
import type { Workspace } from "@/types/discover";

export function getWorkspaceAvatarUrl(project: Partial<Workspace> | null | undefined): string | null {
    if (!project) return null;
    const raw = project.coverImage ?? (project as any).cover_image ?? (project as any).coverImageUrl ?? (project as any).cover_image_url;
    if (typeof raw !== "string") return null;
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
}

// Module-level cached date formatters map by locale to support 1M global users without re-creating Intl instances
const dateFormatterCache = new Map<string, Intl.DateTimeFormat>();

function getCachedDateFormatter(locale = "en-US"): Intl.DateTimeFormat {
    let formatter = dateFormatterCache.get(locale);
    if (!formatter) {
        formatter = new Intl.DateTimeFormat(locale, {
            month: "short",
            day: "numeric",
            year: "numeric",
        });
        dateFormatterCache.set(locale, formatter);
    }
    return formatter;
}

// Fallback & synchronous default instance
const projectDateFormatter = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
});
dateFormatterCache.set("en-US", projectDateFormatter);

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatWorkspaceOfflinePresenceLabel(
    value: string | Date | null | undefined,
    locale?: string
): string {
    if (!value) return "No recent activity";
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return "No recent activity";
    // Deterministic format on SSR / English baseline to eliminate ICU divergence across Node and browser
    let formattedDate: string;
    if (!locale || locale === "en-US" || locale.startsWith("en")) {
        formattedDate = `${d.getDate()} ${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
    } else {
        const formatter = getCachedDateFormatter(locale);
        formattedDate = formatter.format(d);
    }
    return `Last updated: ${formattedDate}`;
}

/**
 * Fine-grained relative recency for active projects (< 7 days)
 */
export function formatWorkspaceActivePresenceLabel(value: string | Date | null | undefined): string | null {
    if (!value) return null;
    const d = value instanceof Date ? value : new Date(value);
    const time = d.getTime();
    if (Number.isNaN(time)) return null;

    const now = Date.now();
    const diffMs = Math.max(0, now - time);
    const diffMinutes = Math.floor(diffMs / (60 * 1000));

    if (diffMinutes < 5) return "Active just now";
    if (diffMinutes < 60) return `Active ${diffMinutes}m ago`;

    const diffHours = Math.floor(diffMs / (60 * 60 * 1000));
    if (diffHours < 24 && isToday(d)) return `Active ${diffHours}h ago`;
    if (isToday(d)) return "Active today";

    const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));
    if (diffDays <= 7 && isAfter(d, subDays(new Date(), 7))) {
        return diffDays >= 1 ? `Active ${diffDays}d ago` : "Active this week";
    }

    return null;
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

let sharedPresenceChannel: BroadcastChannel | null = null;
if (typeof window !== "undefined" && typeof BroadcastChannel !== "undefined") {
    try {
        sharedPresenceChannel = new BroadcastChannel("nb-project-activity-v1");
        sharedPresenceChannel.onmessage = (msgEvent) => {
            const data = msgEvent.data;
            if (data?.projectId) {
                window.dispatchEvent(new CustomEvent("nb-project-activity", { detail: data }));
            }
        };
    } catch {
        // Ignore restricted environments
    }
}

export function WorkspacePresenceDot({
    lastActiveAt,
    compact = false,
    projectId,
    standalone = false,
    className,
}: {
    lastActiveAt?: string | Date | null;
    compact?: boolean;
    projectId?: string;
    standalone?: boolean;
    className?: string;
}) {
    const [liveActiveAt, setLiveActiveAt] = useState<string | Date | null | undefined>(lastActiveAt);
    const [clientLocale, setClientLocale] = useState<string | undefined>(undefined);

    useEffect(() => {
        setLiveActiveAt(lastActiveAt);
    }, [lastActiveAt]);

    useEffect(() => {
        if (typeof navigator !== "undefined" && navigator.language) {
            setClientLocale(navigator.language);
        }
    }, []);

    // Zero-cost real-time presence synchronization across open tabs & local actions
    useEffect(() => {
        if (typeof window === "undefined") return;

        const handleLocalActivity = (event: Event) => {
            const customEvent = event as CustomEvent<{ projectId?: string; timestamp?: string | Date }>;
            if (!projectId || !customEvent.detail?.projectId || customEvent.detail.projectId === projectId) {
                setLiveActiveAt(customEvent.detail?.timestamp ?? new Date());
            }
        };

        window.addEventListener("nb-project-activity", handleLocalActivity as EventListener);
        return () => {
            window.removeEventListener("nb-project-activity", handleLocalActivity as EventListener);
        };
    }, [projectId]);

    // Status (set by owners) and activity come from the shared Node badge;
    // the local event above keeps activity instant after your own changes.
    const activityLabel = formatWorkspaceActivePresenceLabel(liveActiveAt) ?? formatWorkspaceOfflinePresenceLabel(liveActiveAt, clientLocale);
    // 18 on a card's 44px avatar, 30 on the detail page's 80px one, 14 beside a title; the corner offset grows with the badge.
    const size = standalone ? 14 : compact ? 18 : 30;
    const offset = -Math.round(size * 0.2);
    return (
        <WorkspacePresenceBadge
            projectId={projectId && isLooseUuid(projectId) ? projectId : null}
            updatedAt={liveActiveAt ?? null}
            size={size}
            statusSize={standalone ? undefined : 20}
            style={standalone ? undefined : { right: offset, bottom: offset }}
            className={cn(standalone ? "" : "nb-person-presence-dot", className)}
            testId="project-avatar-presence-dot"
            activityLabel={activityLabel}
        />
    );
}

interface ProjectAvatarProps {
    project: Partial<Workspace>;
    size?: "detail" | "card";
    className?: string;
    showPresence?: boolean;
    isOwner?: boolean;
    slugOrId?: string;
    priority?: boolean;
}

export function WorkspaceAvatar({
    project,
    size = "detail",
    className,
    showPresence = true,
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
            {showPresence && (
                <WorkspacePresenceDot
                    lastActiveAt={project.updatedAt}
                    compact={!isDetail}
                    projectId={project.id || project.slug}
                />
            )}
        </div>
    );
}

export default WorkspaceAvatar;

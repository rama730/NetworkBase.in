"use client";

import { BarChart2, UsersRound } from "lucide-react";
import { useId } from "react";
import { formatCount, viewCountDisplay } from "@/lib/format-count";
import { cn } from "@/lib/utils";

interface ProjectStatsBarProps {
    viewCount?: number | null;
    followersCount?: number;
    /** The team sees a zero and why; the public doesn't. */
    isTeam?: boolean;

    className?: string;
    size?: "sm" | "md";
    testIdPrefix?: string;
}

export default function WorkspaceStatsBar({
    viewCount = 0,
    followersCount = 0,
    isTeam = false,

    className,
    size = "md",
    testIdPrefix = "project",
}: ProjectStatsBarProps) {
    const iconClass = size === "sm" ? "w-3 h-3" : "w-3.5 h-3.5";
    const textClass = size === "sm" ? "text-xs" : "text-xs";

    const noteId = useId();
    const views = viewCountDisplay(viewCount, isTeam);
    const viewsContent = (
        <>
            <BarChart2 className={cn(iconClass, "max-md:hidden")} aria-hidden="true" />
            <span className="nb-micro md:hidden">Views</span>
            {/* A new number fades in; `key` restarts it, and reduced motion skips it. */}
            <span key={views.text} className="font-semibold text-zinc-900 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200 dark:text-zinc-200 max-md:text-foreground">{viewCount === 0 ? views.exact : views.text}</span>
            <span className="sr-only"> views</span>
        </>
    );

    return (
        <div className={cn("flex items-center gap-3 font-mono tabular-nums text-zinc-500 dark:text-zinc-400 max-md:text-muted-foreground", textClass, className)}>
            {views.visible ? (isTeam ? (
                <>
                    <button type="button" popoverTarget={noteId} className="flex items-center gap-1 rounded-sm font-mono outline-offset-2" title={views.exact} aria-label={`${views.exact}. How views are counted`} data-testid={`${testIdPrefix}-view-count`}>
                        {viewsContent}
                    </button>
                    <div id={noteId} popover="auto" className="m-auto max-w-72 rounded-md border border-border bg-popover p-3 font-sans text-sm text-popover-foreground shadow-md">
                        Counts people outside the team. One person counts once every 24 hours.
                    </div>
                </>
            ) : (
                <div className="flex items-center gap-1" title={views.exact} aria-label={views.exact} data-testid={`${testIdPrefix}-view-count`}>
                    {viewsContent}
                </div>
            )) : null}
            <div className="flex items-center gap-1" title={`${followersCount.toLocaleString("en-US")} followers`} aria-label={`Followers: ${followersCount.toLocaleString("en-US")}`} data-testid={`${testIdPrefix}-follower-count`}>
                <UsersRound className={cn(iconClass, "max-md:hidden")} aria-hidden="true" />
                <span className="nb-micro md:hidden">Followers</span>
                <span className="font-semibold text-zinc-900 dark:text-zinc-200 max-md:text-foreground">{formatCount(followersCount)}</span>
                <span className="sr-only"> followers</span>
            </div>
        </div>
    );
}

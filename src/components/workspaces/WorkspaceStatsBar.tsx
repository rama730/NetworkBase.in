"use client";

import { BarChart2, UsersRound } from "lucide-react";
import { cn } from "@/lib/utils";

interface ProjectStatsBarProps {
    viewCount?: number;
    followersCount?: number;

    className?: string;
    size?: "sm" | "md";
    testIdPrefix?: string;
}

export default function ProjectStatsBar({
    viewCount = 0,
    followersCount = 0,

    className,
    size = "md",
    testIdPrefix = "project",
}: ProjectStatsBarProps) {
    const iconClass = size === "sm" ? "w-3 h-3" : "w-3.5 h-3.5";
    const textClass = size === "sm" ? "text-xs" : "text-xs";

    return (
        <div className={cn("flex items-center gap-3 font-mono tabular-nums text-zinc-500 dark:text-zinc-400 max-md:text-muted-foreground", textClass, className)}>
            <div className="flex items-center gap-1" title="Views" aria-label={`Views: ${viewCount.toLocaleString()}`} data-testid={`${testIdPrefix}-view-count`}>
                <BarChart2 className={cn(iconClass, "max-md:hidden")} aria-hidden="true" />
                <span className="nb-micro md:hidden">Views</span>
                <span className="font-semibold text-zinc-900 dark:text-zinc-200 max-md:text-foreground">{viewCount.toLocaleString()}</span>
                <span className="sr-only"> views</span>
            </div>
            <div className="flex items-center gap-1" title="Followers" aria-label={`Followers: ${followersCount.toLocaleString()}`} data-testid={`${testIdPrefix}-follower-count`}>
                <UsersRound className={cn(iconClass, "max-md:hidden")} aria-hidden="true" />
                <span className="nb-micro md:hidden">Followers</span>
                <span className="font-semibold text-zinc-900 dark:text-zinc-200 max-md:text-foreground">{followersCount.toLocaleString()}</span>
                <span className="sr-only"> followers</span>
            </div>
        </div>
    );
}

"use client";

import { cn } from "@/lib/utils";
import { ReactNode } from "react";

// Mobile card anatomy shared by project and profile cards (report F52).
// ponytail: shared classes instead of merging card components; merging changes desktop, revisit when a desktop pass is approved.
export const NB_CARD_HEADER_MOBILE = "max-md:px-4 max-md:py-3";

interface DashboardCardProps {
    title: string;
    badge?: ReactNode;
    action?: ReactNode;
    children: ReactNode;
    className?: string;
    compact?: boolean;
    noPadding?: boolean;
    id?: string;
}

interface DashboardCardHeaderProps {
    title: string;
    badge?: ReactNode;
    action?: ReactNode;
    compact?: boolean;
}

export function DashboardCardHeader({ title, badge, action, compact }: DashboardCardHeaderProps) {
    return (
        <div className={cn(
            "flex items-center justify-between gap-3 border-b border-border",
            compact ? "px-4 py-3" : cn("px-5 py-4", NB_CARD_HEADER_MOBILE)
        )}>
            <div className="flex min-w-0 items-center gap-2">
                <h2 className="nb-card-title min-w-0 text-foreground">{title}</h2>
                {badge}
            </div>
            {action}
        </div>
    );
}

export default function DashboardCard({
    title,
    badge,
    action,
    children,
    className,
    compact,
    noPadding,
    id,
}: DashboardCardProps) {
    return (
        <div
            id={id}
            className={cn(
                "rounded-[8px] border border-border bg-card shadow-none transition-colors",
                className
            )}
        >
            <DashboardCardHeader title={title} badge={badge} action={action} compact={compact} />
            <div className={cn(noPadding ? "" : compact ? "p-3" : "p-5 max-md:p-4")}>
                {children}
            </div>
        </div>
    );
}

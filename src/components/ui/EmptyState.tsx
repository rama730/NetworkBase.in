import React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
    icon: LucideIcon;
    title: string;
    description?: React.ReactNode;
    action?: React.ReactNode;
    className?: string;
    compact?: boolean;
}

export function EmptyState({
    icon: Icon,
    title,
    description,
    action,
    className,
    compact,
}: EmptyStateProps) {
    return (
        <div
            role="status"
            className={cn(
                "nb-empty-state nb-grid-ground",
                compact ? "py-8" : "py-12",
                className,
            )}
        >
            <Icon
                className={cn(
                    "text-muted-foreground mx-auto mb-4",
                    "w-6 h-6",
                )}
            />
            <p className="nb-card-title text-foreground">
                {title}
            </p>
            {description && (
                <div className="nb-compact mt-1 text-muted-foreground">
                    {description}
                </div>
            )}
            {action && <div className="mt-3">{action}</div>}
        </div>
    );
}

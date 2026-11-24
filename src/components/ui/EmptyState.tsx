import React from "react";
import { Lock } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PixelPerson, PixelPlace } from "@/components/ui/PixelPerson";

type Figure = "person" | "workspace" | "organization" | "child";

interface EmptyStateProps {
    /** A lucide icon, or `figure` for a pixel person / workspace / organization / child workspace. */
    icon?: LucideIcon;
    figure?: Figure;
    title: string;
    description?: React.ReactNode;
    action?: React.ReactNode;
    /** The "Only you see this" note, for empty parts only the owner can see. */
    onlyYou?: boolean;
    className?: string;
    compact?: boolean;
}

const FIGURE_KEY = "nb-empty";

/** Nothing here yet, in the mix style: a figure or icon, one title, one line, one action. */
export function EmptyState({ icon: Icon, figure, title, description, action, onlyYou, className, compact }: EmptyStateProps) {
    return (
        <div role="status" className={cn("nb-empty-state", compact ? "py-8" : "py-12", className)}>
            {figure ? (
                <span className="nb-empty-figure" aria-hidden="true">
                    {figure === "person" ? <PixelPerson identityKey={FIGURE_KEY} size={44} /> : <PixelPlace kind={figure} identityKey={FIGURE_KEY} size={44} />}
                </span>
            ) : Icon ? <Icon className="mx-auto mb-4 size-6 text-muted-foreground" aria-hidden="true" /> : null}
            <p className="nb-card-title text-foreground">{title}</p>
            {description ? <div className="nb-compact mt-1 text-muted-foreground">{description}</div> : null}
            {action ? <div className="mt-3">{action}</div> : null}
            {onlyYou ? <p className="nb-empty-only"><Lock className="size-3" aria-hidden="true" />Only you see this</p> : null}
        </div>
    );
}

/** A search or filter with nothing to show: says what was searched and clears it. */
export function NoResults({ query, onClear, className }: { query: string; onClear: () => void; className?: string }) {
    return (
        <EmptyState compact className={className} title={`Nothing matches “${query}”`} description="Check the spelling or try fewer words."
            action={<Button type="button" size="sm" variant="outline" onClick={onClear}>Clear search</Button>} />
    );
}

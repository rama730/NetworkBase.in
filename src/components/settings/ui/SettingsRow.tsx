"use client";

import React from "react";
import { cn } from "@/lib/utils";

export function SettingsRow({
    title,
    description,
    right,
    className,
    descriptionId,
    meta,
}: {
    title: string;
    description?: string;
    right?: React.ReactNode;
    className?: string;
    /** Lets the control point at the description (`aria-describedby`). */
    descriptionId?: string;
    /** A small mono line under the description: who and when (e.g. "Added by Asha · Nov 17"). */
    meta?: string;
}) {
    return (
        <div
            className={cn(
                "flex min-h-16 flex-col justify-center gap-3 py-3 sm:flex-row sm:items-center sm:justify-between",
                className
            )}
        >
            <div className="min-w-0 break-words">
                <div className="nb-ui-label text-foreground">
                    {title}
                </div>
                {description ? (
                    <div id={descriptionId} className="nb-compact mt-1 text-muted-foreground">
                        {description}
                    </div>
                ) : null}
                {meta ? <div className="mt-1 font-mono text-[11px] text-muted-foreground">{meta}</div> : null}
            </div>
            {right ? <div className="max-w-full sm:shrink-0">{right}</div> : null}
        </div>
    );
}

"use client";

import React from "react";
import { cn } from "@/lib/utils";

export function SettingsRow({
    title,
    description,
    right,
    className,
}: {
    title: string;
    description?: string;
    right?: React.ReactNode;
    className?: string;
}) {
    return (
        <div
            className={cn(
                "flex min-h-16 flex-col justify-center gap-3 py-3 sm:flex-row sm:items-center sm:justify-between",
                className
            )}
        >
            <div className="min-w-0">
                <div className="nb-ui-label text-foreground">
                    {title}
                </div>
                {description ? (
                    <div className="nb-compact mt-1 text-muted-foreground">
                        {description}
                    </div>
                ) : null}
            </div>
            {right ? <div className="shrink-0">{right}</div> : null}
        </div>
    );
}

"use client";

import React from "react";
import { cn } from "@/lib/utils";

export function DangerZoneCard({
    title = "Danger zone",
    description,
    children,
    className,
}: {
    title?: string;
    description?: string;
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <section
            className={cn(
                "rounded-lg border border-border bg-card",
                className
            )}
        >
            <div className="border-b border-border p-6">
                <h3 className="nb-card-title text-foreground">
                    {title}
                </h3>
                {description ? (
                    <div className="nb-compact mt-1 text-muted-foreground">
                        {description}
                    </div>
                ) : null}
            </div>
            <div className="p-6">{children}</div>
        </section>
    );
}

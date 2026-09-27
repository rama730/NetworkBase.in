"use client";

import React from "react";
import { cn } from "@/lib/utils";

export function SettingsSectionCard({
    title,
    description,
    children,
    className,
    testId,
}: {
    title: string;
    description?: string;
    children: React.ReactNode;
    className?: string;
    testId?: string;
}) {
    return (
        <section
            data-testid={testId}
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

"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { useOpenSettingsSections } from "./SettingsSectionLayout";

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
    const open = useOpenSettingsSections();
    return (
        <section
            data-testid={testId}
            className={cn(
                open
                    ? "space-y-4 border-b border-border pb-6 last:border-b-0 last:pb-0"
                    : "rounded-lg border border-border bg-card",
                className
            )}
        >
            <div className={open ? undefined : "border-b border-border p-6"}>
                <h3 className="nb-card-title text-foreground">
                    {title}
                </h3>
                {description ? (
                    <div className="nb-compact mt-1 text-muted-foreground">
                        {description}
                    </div>
                ) : null}
            </div>
            <div className={open ? undefined : "p-6"}>{children}</div>
        </section>
    );
}

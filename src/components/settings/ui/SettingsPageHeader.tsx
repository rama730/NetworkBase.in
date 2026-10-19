"use client";

import React from "react";

export function SettingsPageHeader({
    title,
    description,
    action,
    level = 1,
}: {
    title: string;
    description?: string;
    action?: React.ReactNode;
    level?: 1 | 2;
}) {
    const Heading = level === 1 ? "h1" : "h2";

    return (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
                <Heading className={level === 1 ? "nb-page-title text-foreground" : "nb-section-title text-foreground"}>
                    {title}
                </Heading>
                {description ? (
                    <p className="nb-compact mt-1 text-muted-foreground">
                        {description}
                    </p>
                ) : null}
            </div>
            {action ? <div className="shrink-0">{action}</div> : null}
        </div>
    );
}

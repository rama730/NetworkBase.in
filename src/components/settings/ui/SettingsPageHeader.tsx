"use client";

import React from "react";

export function SettingsPageHeader({
    title,
    description,
    action,
    level = 1,
    headingId,
}: {
    title: string;
    description?: string;
    action?: React.ReactNode;
    level?: 1 | 2;
    /** Lets a section point at its heading (`aria-labelledby`) and move focus to it. */
    headingId?: string;
}) {
    const Heading = level === 1 ? "h1" : "h2";

    return (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
                <Heading id={headingId} tabIndex={headingId ? -1 : undefined} className={level === 1 ? "nb-page-title text-foreground" : "nb-section-title text-foreground"}>
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

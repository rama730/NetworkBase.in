"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { useOpenSettingsSections } from "./SettingsSectionLayout";

export function SettingsRow({
    title,
    description,
    right,
    className,
    descriptionId,
    meta,
    id,
    findKeys,
    children,
}: {
    title: React.ReactNode;
    description?: React.ReactNode;
    right?: React.ReactNode;
    className?: string;
    /** Lets the control point at the description (`aria-describedby`). */
    descriptionId?: string;
    /** A small mono line under the description: who and when (e.g. "Added by Asha · Nov 17"). */
    meta?: React.ReactNode;
    /** An anchor for links and "Find a setting". */
    id?: string;
    findKeys?: string;
    /** Full-width content under the row (an inline form). */
    children?: React.ReactNode;
}) {
    const open = useOpenSettingsSections();
    if (open) {
        return (
            <div id={id} data-find={id && typeof title === "string" ? title : undefined} data-find-keys={findKeys} className={cn("nbs-row", className)}>
                <div className="min-w-0">
                    <div className="t">{title}</div>
                    {description ? <div id={descriptionId} className="d">{description}</div> : null}
                    {meta ? <div className="m">{meta}</div> : null}
                </div>
                {right ? <div className="ctl">{right}</div> : <div />}
                {children ? <div className="full">{children}</div> : null}
            </div>
        );
    }
    return (
        <div id={id} className={cn("flex min-h-16 flex-col justify-center gap-3 py-3 sm:flex-row sm:items-center sm:justify-between", className)}>
            <div className="min-w-0 break-words">
                <div className="nb-ui-label text-foreground">{title}</div>
                {description ? <div id={descriptionId} className="nb-compact mt-1 text-muted-foreground">{description}</div> : null}
                {meta ? <div className="mt-1 font-mono text-[11px] text-muted-foreground">{meta}</div> : null}
            </div>
            {right ? <div className="max-w-full sm:shrink-0">{right}</div> : null}
            {children}
        </div>
    );
}

/** Rows that run edge to edge on hairlines (mix); elsewhere a divided list. */
export function SettingsRows({ children, className }: { children: React.ReactNode; className?: string }) {
    const open = useOpenSettingsSections();
    return <div className={cn(open ? "nbs-rows" : "divide-y divide-border", className)}>{children}</div>;
}

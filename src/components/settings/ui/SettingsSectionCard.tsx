"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { useOpenSettingsSections } from "./SettingsSectionLayout";

/**
 * A group of settings. Inside the Settings page (open sections, mix style) it is a mono label with a rule, an optional
 * state ("· two-step off") and actions on the right, then full-width rows; elsewhere it keeps its card.
 */
export function SettingsSectionCard({
    title,
    description,
    children,
    className,
    testId,
    id,
    state,
    stateOk,
    right,
    flush,
    findKeys,
}: {
    title: string;
    description?: React.ReactNode;
    children: React.ReactNode;
    className?: string;
    testId?: string;
    /** An anchor inside the section (`#settings-<section>-<name>`), so search and links can land on this card. */
    id?: string;
    /** A short state after the label, in clay (or green with `stateOk`): "two-step off", "03". */
    state?: string;
    stateOk?: boolean;
    /** Actions at the right end of the label (Turn all off, Clear all). */
    right?: React.ReactNode;
    /** The children are rows or lists that run edge to edge; otherwise they get the group's side padding. */
    flush?: boolean;
    /** Extra words "Find a setting" matches for this group. */
    findKeys?: string;
}) {
    const open = useOpenSettingsSections();
    if (open) {
        return (
            <section id={id} data-testid={testId} data-find={id ? title : undefined} data-find-keys={findKeys} aria-label={title} className={cn("nbs-group", className)}>
                <h3 className="nbs-glabel">
                    {title}
                    {state ? <span className={cn("state", stateOk && "ok")}>· {state}</span> : null}
                    {right ? <span className="r">{right}</span> : null}
                </h3>
                {description ? <p className="nbs-ghelp">{description}</p> : null}
                {flush ? children : <div className="nbs-body">{children}</div>}
            </section>
        );
    }
    return (
        <section id={id} data-testid={testId} className={cn("rounded-lg border border-border bg-card", className)}>
            <div className="border-b border-border p-6">
                <h3 className="nb-card-title text-foreground">{title}</h3>
                {description ? <div className="nb-compact mt-1 text-muted-foreground">{description}</div> : null}
            </div>
            <div className="p-6">{children}</div>
        </section>
    );
}

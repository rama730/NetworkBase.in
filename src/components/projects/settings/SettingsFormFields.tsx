'use client';

import React, { useCallback, useId, useState } from "react";
import {
    Plus,
    X,
} from "lucide-react";
import { toast } from "@/lib/feedback";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SettingsPageHeader } from "@/components/settings/ui/SettingsPageHeader";
import { SettingsLoadState, type SettingsLoadStatus } from "./SettingsLoadState";
import { useOpenSettingsSections } from "@/components/settings/ui/SettingsSectionLayout";
import {
    OTHER_PROJECT_TYPE_ID,
    PROJECT_TYPE_OPTIONS,
} from "@/lib/projects/project-create-options";

export function SettingsCard({
    title,
    description,
    children,
    footer,
    danger = false,
    loadState,
    headingLevel = 3,
    className,
}: {
    title: string;
    description?: string;
    children: React.ReactNode;
    footer?: React.ReactNode;
    danger?: boolean;
    loadState?: SettingsLoadStatus;
    headingLevel?: 2 | 3;
    className?: string;
}) {
    const open = useOpenSettingsSections();
    return (
        <section
            className={cn(
                open ? "min-w-0 space-y-4" : "min-w-0 rounded-lg border bg-card shadow-none",
                !open && (danger ? "border-destructive/30 bg-destructive/5" : "border-border"),
                className,
            )}
        >
            <div className={cn(!open && "border-b border-border p-6", danger && "[&_h2]:text-destructive")}>
                {headingLevel === 2 ? <SettingsPageHeader level={2} title={title} description={description} /> : <>
                <h3 className={cn("nb-card-title", danger ? "text-destructive" : "text-foreground")}>{title}</h3>
                {description ? (
                    <p className={cn("nb-compact mt-1", danger ? "text-destructive/80" : "text-muted-foreground")}>{description}</p>
                ) : null}
                </>}

            </div>
            <div className={open ? undefined : "p-6"}>
                {loadState ? <SettingsLoadState {...loadState} /> : null}
                {(!loadState || loadState.hasData) ? <fieldset disabled={Boolean((loadState?.loading && !loadState.allowInteractionWhileLoading) || loadState?.error)} className="min-w-0">{children}</fieldset> : null}
            </div>
            {footer && (!loadState || loadState.hasData) ? (
                <div className={cn("flex flex-col gap-3 border-t border-border py-4 sm:flex-row sm:items-center sm:justify-between", !open && "bg-muted/10 px-6")}>
                    {footer}
                </div>
            ) : null}
        </section>
    );
}

export function TextField({
    label,
    value,
    onChange,
    placeholder,
    description,
    id,
    error,
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    description?: string;
    id?: string;
    error?: string;
}) {
    const generatedId = useId();
    const fieldId = id ?? generatedId;
    return (
        <label className="space-y-1.5 block">
            <span className="nb-ui-label text-foreground">{label}</span>
            {description ? <span className="nb-compact -mt-0.5 block text-muted-foreground">{description}</span> : null}
            <input
                id={fieldId}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? `${fieldId}-error` : undefined}
                value={value}
                onChange={(event) => onChange(event.target.value)}
                placeholder={placeholder}
                className="nb-touch-target h-[34px] w-full rounded-[5px] border border-border aria-invalid:border-destructive bg-card px-3 text-[13px] leading-[1.5] text-foreground placeholder:text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            {error && <span id={`${fieldId}-error`} className="block text-[12px] text-destructive">{error}</span>}
        </label>
    );
}

export function TextAreaField({
    label,
    value,
    onChange,
    placeholder,
    description,
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    description?: string;
}) {
    return (
        <label className="space-y-1.5 block">
            <span className="nb-ui-label text-foreground">{label}</span>
            {description ? <span className="nb-compact -mt-0.5 block text-muted-foreground">{description}</span> : null}
            <textarea
                value={value}
                onChange={(event) => onChange(event.target.value)}
                placeholder={placeholder}
                rows={4}
                className="min-h-[80px] w-full resize-y rounded-[5px] border border-border bg-card px-3 py-2 text-[13px] leading-[1.5] text-foreground placeholder:text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
        </label>
    );
}

export function ReadOnlySlugField({ slug }: { slug: string }) {
    const [copied, setCopied] = useState(false);
    const normalizedSlug = slug.trim() || "Not set";
    const handleCopy = useCallback(async () => {
        const trimmedSlug = slug.trim();
        if (!trimmedSlug || typeof navigator === "undefined" || !navigator.clipboard?.writeText) return;
        try {
            await navigator.clipboard.writeText(trimmedSlug);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1600);
        } catch (error) {
            console.error("Failed to copy project slug", error);
            toast.error("Failed to copy slug.");
        }
    }, [slug]);

    return (
        <div className="space-y-1.5">
            <span className="nb-ui-label text-foreground">Project slug</span>
            <div className="flex flex-col gap-2 rounded-[5px] border border-border bg-muted/40 px-3.5 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                    <p className="truncate font-mono text-sm font-medium text-foreground">{normalizedSlug}</p>
                    <p className="nb-compact mt-1 text-muted-foreground">
                        Project links use this slug. Editing is locked for now to avoid broken links and stale share previews.
                    </p>
                </div>
                {slug.trim() ? (
                    <Button type="button" variant="outline" size="sm" onClick={() => void handleCopy()} className="nb-touch-target h-[28px] shrink-0 rounded-[5px] border-border px-2.5 text-xs font-medium text-foreground hover:bg-muted">
                        {copied ? "Copied" : "Copy"}
                    </Button>
                ) : null}
            </div>
        </div>
    );
}

export function CategorySelector({
    choice,
    customValue,
    onChoiceChange,
    onCustomChange,
    description,
}: {
    choice: string;
    customValue: string;
    onChoiceChange: (value: string) => void;
    onCustomChange: (value: string) => void;
    description?: string;
}) {
    return (
        <div className="space-y-3">
            <label className="space-y-1.5 block">
                <span className="nb-ui-label text-foreground">Category</span>
                {description ? <span className="nb-compact -mt-0.5 block text-muted-foreground">{description}</span> : null}
                <select
                    value={choice}
                    onChange={(event) => onChoiceChange(event.target.value)}
                    className="nb-touch-target h-[34px] w-full rounded-[5px] border border-border bg-card px-3 text-[13px] leading-[1.5] text-foreground transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                    <option value="">Choose a category</option>
                    {PROJECT_TYPE_OPTIONS.map((type) => (
                        <option key={type.id} value={type.id}>
                            {type.label}
                        </option>
                    ))}
                    <option value={OTHER_PROJECT_TYPE_ID}>Others</option>
                </select>
            </label>
            {choice === OTHER_PROJECT_TYPE_ID ? (
                <TextField
                    label="Custom category"
                    value={customValue}
                    onChange={onCustomChange}
                    placeholder="Enter a custom category"
                />
            ) : null}
        </div>
    );
}

export function ChipEditor({
    label,
    description,
    values,
    onChange,
    suggestions,
    placeholder,
    tone,
    prefix = "",
    limit,
}: {
    label: string;
    description?: string;
    values: string[];
    onChange: (values: string[]) => void;
    suggestions: readonly string[];
    placeholder: string;
    tone?: "indigo" | "emerald";
    prefix?: string;
    limit: number;
}) {
    const [draft, setDraft] = useState("");
    const addValue = useCallback((rawValue: string) => {
        const nextValue = rawValue.trim();
        if (!nextValue) return;
        if (values.length >= limit) {
            toast.warning(`${label} can include up to ${limit} items.`);
            return;
        }
        if (values.some((value) => value.toLowerCase() === nextValue.toLowerCase())) {
            setDraft("");
            return;
        }
        onChange([...values, nextValue]);
        setDraft("");
    }, [label, limit, onChange, values]);
    const removeValue = useCallback((value: string) => {
        onChange(values.filter((item) => item !== value));
    }, [onChange, values]);

    return (
        <div className="min-w-0">
            <div className="flex items-center justify-between gap-3">
                <label className="nb-ui-label text-foreground">{label}</label>
                <span className="nb-compact text-muted-foreground">{values.length}/{limit}</span>
            </div>
            {description ? (
                <p className="nb-compact mt-1 text-muted-foreground">{description}</p>
            ) : null}
            <div className="mt-2 rounded-lg border border-border bg-muted/20 p-4">
                {values.length > 0 ? (
                    <div className="mb-3 flex min-w-0 flex-wrap gap-2">
                        {values.map((value) => (
                            <span
                                key={value}
                                className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-[3px] border border-border bg-muted/60 px-2 py-0.5 font-mono text-[11px] uppercase tracking-[0.09em] text-foreground transition-colors hover:border-border/80"
                            >
                                <span className="truncate">{prefix}{value}</span>
                                <button
                                    type="button"
                                    onClick={() => removeValue(value)}
                                    className="text-muted-foreground opacity-70 transition-opacity hover:opacity-100"
                                    aria-label={`Remove ${value}`}
                                >
                                    <X className="h-3.5 w-3.5" />
                                </button>
                            </span>
                        ))}
                    </div>
                ) : null}
                <div className="flex gap-2">
                    <input
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key !== "Enter") return;
                            event.preventDefault();
                            addValue(draft);
                        }}
                        className="nb-touch-target h-[34px] min-w-0 flex-1 rounded-[5px] border border-border bg-card px-3 text-[13px] leading-[1.5] text-foreground placeholder:text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        placeholder={placeholder}
                        disabled={values.length >= limit}
                    />
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => addValue(draft)}
                        disabled={values.length >= limit}
                        className="h-[34px] w-[34px] shrink-0 p-0 rounded-[5px] border-border text-foreground hover:bg-muted"
                        aria-label={`Add ${label.toLowerCase()}`}
                    >
                        <Plus className="h-4 w-4" />
                    </Button>
                </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
                {suggestions
                    .filter((suggestion) => !values.some((value) => value.toLowerCase() === suggestion.toLowerCase()))
                    .slice(0, 5)
                    .map((suggestion) => (
                        <button
                            key={suggestion}
                            type="button"
                            onClick={() => addValue(suggestion)}
                            disabled={values.length >= limit}
                            className="rounded-[3px] border border-border/60 bg-muted/40 px-2 py-0.5 font-mono text-[11px] uppercase tracking-[0.09em] text-muted-foreground transition hover:border-border hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            + {suggestion}
                        </button>
                    ))}
            </div>
        </div>
    );
}

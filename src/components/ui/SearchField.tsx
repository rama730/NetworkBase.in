"use client";

import { Search, X } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The app's search box (Discover, Network): 16px icon at the left, a clear × once there's text, 200
 * characters at most. Controlled: the page owns the text and decides when to search.
 */
export function SearchField({
    value,
    onChange,
    onEnter,
    label,
    placeholder = label,
    size = "default",
    pageSearch = false,
    className,
}: {
    value: string;
    onChange: (next: string) => void;
    onEnter?: (input: HTMLInputElement) => void;
    label: string;
    placeholder?: string;
    size?: "default" | "lg";
    /** The page's own search (Discover): the top bar's search box focuses it instead of opening a second search. */
    pageSearch?: boolean;
    className?: string;
}) {
    return (
        <div role="search" data-page-search={pageSearch || undefined} className={cn("relative min-w-0", className)}>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <input
                type="search"
                value={value}
                maxLength={200}
                onChange={(event) => onChange(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter") onEnter?.(event.currentTarget); }}
                placeholder={placeholder}
                aria-label={label}
                className={cn(
                    "w-full rounded-md border border-input bg-card pl-9 pr-9 text-base text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-primary md:text-sm pointer-coarse:h-11 [&::-webkit-search-cancel-button]:hidden",
                    size === "lg" ? "h-[var(--ui-control-height-lg)]" : "h-[var(--ui-control-height)]",
                )}
            />
            {value ? (
                <button type="button" onClick={() => onChange("")} className="nb-icon-button absolute right-1 top-1/2 -translate-y-1/2" aria-label="Clear search">
                    <X className="size-4" aria-hidden="true" />
                </button>
            ) : null}
        </div>
    );
}

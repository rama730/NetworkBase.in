"use client";

// ============================================================================
// Task Panel - MentionAutocomplete
// Floating member picker anchored to the caret in the comment composer.
// Conforms to NetworkBase drafting-table design tokens and Section 10 precision.
// ============================================================================

import * as React from "react";
import { Loader2 } from "lucide-react";

import { UserAvatar } from "@/components/ui/UserAvatar";
import { cn } from "@/lib/utils";

export interface MentionCandidate {
    id: string;
    username: string | null;
    fullName: string | null;
    avatarUrl: string | null;
    role?: "owner" | "admin" | "member" | "viewer";
}

interface MentionAutocompleteProps {
    /** Viewport-relative caret rectangle - the menu is positioned just below it. */
    anchorRect: { top: number; left: number; height: number } | null;
    /** Current `@query` (without the leading '@'). Used for highlighting. */
    query: string;
    candidates: MentionCandidate[];
    activeIndex: number;
    loading: boolean;
    error?: string | null;
    onSelect: (candidate: MentionCandidate) => void;
    onHoverIndex?: (index: number) => void;
}

const MENU_WIDTH = 300;

function getDisplayName(candidate: MentionCandidate): string {
    return (
        candidate.fullName?.trim() ||
        candidate.username?.trim() ||
        "Unnamed user"
    );
}

// Case-insensitive first-match highlighter. Returns the string split into
// [before, match, after]. When the query is empty or not found, the full
// string is returned as `before`.
function splitAroundMatch(text: string, query: string) {
    if (!text) return { before: "", match: "", after: "" };
    if (!query) return { before: text, match: "", after: "" };
    const lower = text.toLowerCase();
    const index = lower.indexOf(query.toLowerCase());
    if (index < 0) return { before: text, match: "", after: "" };
    return {
        before: text.slice(0, index),
        match: text.slice(index, index + query.length),
        after: text.slice(index + query.length),
    };
}

function Highlighted({ text, query }: { text: string; query: string }) {
    const { before, match, after } = splitAroundMatch(text, query);
    if (!match) return <>{text}</>;
    return (
        <>
            {before}
            <mark className="bg-primary/20 text-primary rounded-[2px] px-0.5">
                {match}
            </mark>
            {after}
        </>
    );
}

export function MentionAutocomplete({
    anchorRect,
    query,
    candidates,
    activeIndex,
    loading,
    error,
    onSelect,
    onHoverIndex,
}: MentionAutocompleteProps) {
    if (!anchorRect) return null;

    const top = anchorRect.top;
    const left = Math.max(4, anchorRect.left);

    const hasResults = candidates.length > 0;

    return (
        <div
            id="mention-autocomplete-listbox"
            role="listbox"
            aria-label="Mention teammates"
            data-testid="mention-autocomplete"
            data-composer-portal="true"
            className="absolute z-50 overflow-hidden rounded-[6px] border border-border bg-popover text-popover-foreground shadow-lg animate-in fade-in-0 zoom-in-95 duration-100"
            style={{ top, left, width: MENU_WIDTH }}
            // Don't let a pointer drag in the menu steal focus from the composer.
            onMouseDown={(event) => event.preventDefault()}
        >
            <div className="flex items-center justify-between border-b border-border/60 bg-muted/30 px-3 py-1.5">
                <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
                    Mention Teammates
                </span>
                {loading ? <Loader2 className="size-3 animate-spin text-muted-foreground" /> : null}
            </div>

            {error ? (
                <div className="px-3 py-2.5 text-xs text-destructive">{error}</div>
            ) : null}

            {!error && !loading && !hasResults ? (
                <div className="px-3 py-2.5 text-xs text-muted-foreground">
                    {query
                        ? `No teammates match "${query}".`
                        : "No teammates found on this project."}
                </div>
            ) : null}

            {hasResults ? (
                <ul className="max-h-60 overflow-y-auto p-1">
                    {candidates.map((candidate, index) => {
                        const active = index === activeIndex;
                        const displayName = getDisplayName(candidate);

                        const handleTriggerSelect = (e: React.SyntheticEvent) => {
                            e.preventDefault();
                            e.stopPropagation();
                            onSelect(candidate);
                        };

                        return (
                            <li key={candidate.id}>
                                <button
                                    id={`mention-option-${candidate.id}`}
                                    type="button"
                                    role="option"
                                    aria-selected={active}
                                    data-testid="mention-autocomplete-option"
                                    data-mention-candidate-id={candidate.id}
                                    onPointerDown={handleTriggerSelect}
                                    onMouseDown={handleTriggerSelect}
                                    onClick={handleTriggerSelect}
                                    onMouseEnter={() => onHoverIndex?.(index)}
                                    className={cn(
                                        "flex w-full items-center gap-2.5 rounded-[4px] px-2.5 py-1.5 text-left transition-colors",
                                        active
                                            ? "bg-accent text-accent-foreground font-medium"
                                            : "text-foreground hover:bg-muted/70",
                                    )}
                                >
                                    <UserAvatar
                                        identity={{
                                            fullName: candidate.fullName,
                                            username: candidate.username,
                                            avatarUrl: candidate.avatarUrl,
                                        }}
                                        size={24}
                                        roundedClassName="rounded-[4px] border border-border/60 shrink-0"
                                    />
                                    <div className="min-w-0 flex-1">
                                        <div className="truncate text-[12px] font-medium text-foreground leading-tight">
                                            <Highlighted text={displayName} query={query} />
                                        </div>
                                        {candidate.username ? (
                                            <div className="truncate font-mono text-[10px] text-muted-foreground">
                                                @<Highlighted text={candidate.username} query={query} />
                                            </div>
                                        ) : null}
                                    </div>
                                    {candidate.role && candidate.role !== "member" ? (
                                        <span
                                            className={cn(
                                                "rounded-[3px] border px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.09em] shrink-0",
                                                candidate.role === "owner"
                                                    ? "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                                                    : "border-border bg-muted/60 text-muted-foreground",
                                            )}
                                        >
                                            {candidate.role}
                                        </span>
                                    ) : null}
                                </button>
                            </li>
                        );
                    })}
                </ul>
            ) : null}
        </div>
    );
}

export default MentionAutocomplete;

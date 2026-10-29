"use client";

// ============================================================================
// Task Panel Overhaul - Wave 4: CommentBody
//
// Renders the raw `task_comments.content` string as a mix of plain text and
// inline mention chips. The raw form embeds mentions as `@{uuid|DisplayName}`
// tokens; this component delegates parsing to `parseMentions` and then maps
// each segment to a React node.
//
// Pre-mention comments have no tokens at all, so `parseMentions` returns a
// single text segment and the output matches the previous plain-text render.
// ============================================================================

import * as React from "react";

import { parseMentions } from "@/lib/workspaces/mention-tokens";
import { cn } from "@/lib/utils";

interface CommentBodyProps {
    content: string;
    viewerUserId?: string | null;
    /** Live member names by user id; the token's stored name is only a fallback. */
    memberNames?: ReadonlyMap<string, string>;
    className?: string;
}

function renderLinksAndTaskRefs(text: string, keyPrefix: string): React.ReactNode {
    const tokenRegex = /(https?:\/\/[^\s<]+[^<.,:;"')\]\s])|\b([A-Z]{2,10}-\d+)\b/g;
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = tokenRegex.exec(text)) !== null) {
        if (match.index > lastIndex) {
            parts.push(text.slice(lastIndex, match.index));
        }
        if (match[1]) {
            const url = match[1];
            parts.push(
                <a
                    key={`${keyPrefix}-url-${match.index}`}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline font-medium break-all"
                >
                    {url}
                </a>,
            );
        } else if (match[2]) {
            const taskId = match[2];
            parts.push(
                <span
                    key={`${keyPrefix}-tr-${match.index}`}
                    className="font-mono text-[12px] font-semibold text-primary"
                >
                    {taskId}
                </span>,
            );
        }
        lastIndex = match.index + match[0].length;
    }

    if (lastIndex < text.length) {
        parts.push(text.slice(lastIndex));
    }

    return parts;
}

function renderInlineChunks(text: string, keyPrefix: string): React.ReactNode {
    const inlineCodeRegex = /`([^`]+)`/g;
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = inlineCodeRegex.exec(text)) !== null) {
        if (match.index > lastIndex) {
            parts.push(renderLinksAndTaskRefs(text.slice(lastIndex, match.index), `${keyPrefix}-${lastIndex}`));
        }
        parts.push(
            <code
                key={`${keyPrefix}-ic-${match.index}`}
                className="rounded-[3px] border border-border bg-muted/60 px-1 py-0.5 font-mono text-[12px] font-medium text-foreground"
            >
                {match[1]}
            </code>,
        );
        lastIndex = match.index + match[0].length;
    }

    if (lastIndex < text.length) {
        parts.push(renderLinksAndTaskRefs(text.slice(lastIndex), `${keyPrefix}-${lastIndex}`));
    }

    return parts;
}

function renderFormattedText(text: string, keyPrefix: string): React.ReactNode {
    const codeBlockRegex = /```(?:[a-zA-Z0-9_-]*\n)?([\s\S]*?)```/g;
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = codeBlockRegex.exec(text)) !== null) {
        if (match.index > lastIndex) {
            parts.push(renderInlineChunks(text.slice(lastIndex, match.index), `${keyPrefix}-${lastIndex}`));
        }
        const codeContent = match[1]?.trim() ?? "";
        parts.push(
            <pre
                key={`${keyPrefix}-cb-${match.index}`}
                className="my-1.5 max-h-60 overflow-x-auto rounded-[5px] border border-border bg-muted/40 p-2.5 font-mono text-[12px] leading-relaxed text-foreground"
            >
                <code>{codeContent}</code>
            </pre>,
        );
        lastIndex = match.index + match[0].length;
    }

    if (lastIndex < text.length) {
        parts.push(renderInlineChunks(text.slice(lastIndex), `${keyPrefix}-${lastIndex}`));
    }

    return parts;
}

export function CommentBody({ content, viewerUserId, memberNames, className }: CommentBodyProps) {
    const { segments } = React.useMemo(() => parseMentions(content), [content]);

    return (
        <div className={cn("whitespace-pre-wrap break-words", className)}>
            {segments.map((segment, index) => {
                if (segment.type === "text") {
                    return (
                        <React.Fragment key={`t-${index}`}>
                            {renderFormattedText(segment.value, `t-${index}`)}
                        </React.Fragment>
                    );
                }
                const isMentioningViewer =
                    viewerUserId != null && segment.userId === viewerUserId;
                return (
                    <span
                        key={`m-${index}-${segment.userId}`}
                        data-mention-id={segment.userId}
                        className={cn(
                            "inline-flex items-center rounded-[3px] px-1.5 py-px text-[13px] font-medium align-baseline",
                            isMentioningViewer
                                ? "border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                                : "bg-primary/10 text-primary",
                        )}
                    >
                        @{memberNames?.get(segment.userId) ?? segment.displayName}
                    </span>
                );
            })}
        </div>
    );
}

export default CommentBody;

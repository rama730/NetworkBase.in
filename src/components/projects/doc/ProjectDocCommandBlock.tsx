"use client";

import { useMemo, useState } from "react";
import { Check, Copy } from "lucide-react";
import { projectDocEditorTargetId } from "@/lib/projects/doc-editor-source-map";
import { cn } from "@/lib/utils";

export type ProjectDocCommandLineTarget = {
    id: string;
    startLine: number;
    endLine: number;
};

async function copyTextWithFallback(value: string) {
    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        return;
    }
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(textarea);
    if (!copied) throw new Error("Clipboard fallback failed");
}

export function ProjectDocCommandBlock({
    code,
    language,
    id,
    highlighted,
    highlightedTargetId,
    highlightToken,
    lineTargets = [],
    onCopied,
    sourceLine,
    sourceOffset,
}: {
    code: string;
    language?: string | null;
    id?: string;
    editorTargetId?: string | null;
    highlighted?: boolean;
    highlightedTargetId?: string | null;
    highlightToken?: number | null;
    lineTargets?: ProjectDocCommandLineTarget[];
    onCopied?: (id: string) => void;
    sourceLine?: number | null;
    sourceOffset?: number | null;
}) {
    const [copied, setCopied] = useState(false);
    const codeLines = code.trimEnd().split("\n");
    const lineTargetByStartLine = useMemo(() => {
        const map = new Map<number, ProjectDocCommandLineTarget>();
        lineTargets.forEach((target) => map.set(target.startLine, target));
        return map;
    }, [lineTargets]);
    const highlightedLineTarget = useMemo(
        () => lineTargets.find((target) => target.id === highlightedTargetId) ?? null,
        [highlightedTargetId, lineTargets],
    );
    const rootEditorTargetId = projectDocEditorTargetId("command", sourceLine ?? null, sourceOffset ?? null);

    const handleCopy = async () => {
        if (id) onCopied?.(id);
        try {
            await copyTextWithFallback(code.trimEnd());
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1400);
        } catch (error) {
            console.error("[ProjectDocCommandBlock] Copy failed", error);
        }
    };

    return (
        <div
            id={id}
            tabIndex={id ? -1 : undefined}
            data-readme-target={id ? "true" : undefined}
            data-readme-target-kind={id ? "command" : undefined}
            data-readme-target-id={id}
            data-readme-command-block="true"
            data-readme-source-line={sourceLine ?? undefined}
            data-readme-source-offset={sourceOffset ?? undefined}
            data-readme-source-kind="command"
            data-readme-editor-target-id={rootEditorTargetId}
            data-readme-highlighted={highlighted || highlightedTargetId === rootEditorTargetId ? "true" : undefined}
            data-readme-highlight-token={highlighted || highlightedTargetId === rootEditorTargetId ? highlightToken ?? undefined : undefined}
            className={cn(
                "group relative my-4 scroll-mt-28 overflow-hidden rounded-[5px] border border-border bg-card text-foreground shadow-none outline-none transition-colors",
                highlighted && "border-primary bg-primary/5 ring-2 ring-primary/20",
            )}
        >
            {language ? (
                <div className="border-b border-border px-4 py-2 font-mono text-[11px] font-semibold uppercase tracking-[0.09em] text-muted-foreground bg-muted/20">
                    {language}
                </div>
            ) : null}
            <button
                type="button"
                onClick={handleCopy}
                data-readme-copy-button="true"
                title={copied ? "Copied" : "Copy"}
                aria-label={copied ? "Copied" : "Copy command"}
                className="absolute right-2 top-2 inline-flex size-7 items-center justify-center rounded-[5px] border border-border bg-card text-muted-foreground transition hover:text-foreground hover:bg-muted"
            >
                {copied ? <Check className="size-3.5 text-primary" /> : <Copy className="size-3.5" />}
                <span className="sr-only" aria-live="polite">{copied ? "Copied" : "Copy command"}</span>
            </button>
            <pre className="whitespace-pre-wrap break-words px-4 py-4 pr-12 font-mono text-[13px] leading-[1.6] [overflow-wrap:anywhere] pointer-coarse:text-[14px]">
                <code className="break-words [overflow-wrap:anywhere]">
                    {codeLines.map((line, index) => {
                        const target = lineTargetByStartLine.get(index);
                        const sourceLineForCode = typeof sourceLine === "number" ? sourceLine + index + 1 : null;
                        const lineEditorTargetId = projectDocEditorTargetId("command", sourceLineForCode, null);
                        const lineHighlighted = Boolean(
                            highlightedLineTarget
                            && index >= highlightedLineTarget.startLine
                            && index <= highlightedLineTarget.endLine,
                        ) || highlightedTargetId === lineEditorTargetId;
                        return (
                            <span
                                key={`${index}-${line}`}
                                id={target?.id}
                                tabIndex={target?.id ? -1 : undefined}
                                data-readme-target={target?.id ? "true" : undefined}
                                data-readme-target-kind={target?.id ? "command" : undefined}
                                data-readme-target-id={target?.id}
                                data-readme-source-line={sourceLineForCode ?? undefined}
                                data-readme-source-kind="command"
                                data-readme-editor-target-id={lineEditorTargetId}
                                data-readme-highlighted={lineHighlighted ? "true" : undefined}
                                data-readme-highlight-token={lineHighlighted ? highlightToken ?? undefined : undefined}
                                className={cn(
                                    "block min-w-0 scroll-mt-32 rounded-[3px] outline-none [overflow-wrap:anywhere]",
                                    lineHighlighted && "-mx-1 bg-primary/15 px-1 ring-1 ring-primary/20",
                                )}
                            >
                                {line || " "}
                            </span>
                        );
                    })}
                </code>
            </pre>
        </div>
    );
}

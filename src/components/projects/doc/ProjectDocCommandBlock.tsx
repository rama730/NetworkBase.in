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
    try {
        await navigator.clipboard.writeText(value);
        return;
    } catch {
        // Permission denied or unfocused document: fall through to execCommand.
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
    if (!copied) throw new Error("Couldn’t copy");
}

export function ProjectDocCommandBlock({
    code,
    language,
    id,
    lineTargets = [],
    sourceLine,
    sourceOffset,
}: {
    code: string;
    language?: string | null;
    id?: string;
    lineTargets?: ProjectDocCommandLineTarget[];
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
    const rootEditorTargetId = projectDocEditorTargetId("command", sourceLine ?? null, sourceOffset ?? null);

    const handleCopy = async () => {
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
            className="group relative my-4 scroll-mt-28 overflow-hidden rounded-[5px] border border-border bg-card text-foreground shadow-none outline-none"
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
                className={cn(
                    "nb-touch-target absolute right-2 top-2 inline-flex size-7 items-center justify-center rounded-[5px] border bg-card text-muted-foreground transition-colors hover:text-foreground hover:bg-muted",
                    copied ? "border-foreground/20 text-foreground" : "border-border",
                )}
            >
                {copied
                    ? <Check key="copied" className="size-3.5 animate-in zoom-in-50 fade-in duration-200 motion-reduce:animate-none" />
                    : <Copy key="copy" className="size-3.5 animate-in fade-in duration-150 motion-reduce:animate-none" />}
                <span className="sr-only" aria-live="polite">{copied ? "Copied" : "Copy command"}</span>
            </button>
            <pre className="whitespace-pre-wrap break-words px-4 py-4 pr-12 font-mono text-[13px] leading-[1.6] [overflow-wrap:anywhere] pointer-coarse:text-[14px]">
                <code className="break-words [overflow-wrap:anywhere]">
                    {codeLines.map((line, index) => {
                        const target = lineTargetByStartLine.get(index);
                        const sourceLineForCode = typeof sourceLine === "number" ? sourceLine + index + 1 : null;
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
                                data-readme-editor-target-id={projectDocEditorTargetId("command", sourceLineForCode, null)}
                                className="block min-w-0 scroll-mt-32 outline-none [overflow-wrap:anywhere]"
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

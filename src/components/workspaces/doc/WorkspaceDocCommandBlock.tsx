"use client";

import { useMemo, useState } from "react";
import { Check, Copy } from "lucide-react";
import { projectDocEditorTargetId } from "@/lib/workspaces/doc-editor-source-map";
import { cn } from "@/lib/utils";
import { COPY_FAILED, copyText } from "@/lib/clipboard";
import { toast } from "@/lib/feedback";
import { commandsOf } from "@/lib/terminal/ansi";
import terminal from "@/components/ui/terminal-block.module.css";

const SHELLS = new Set(["bash", "sh", "zsh", "shell", "console", "terminal", "powershell", "ps1", "cmd"]);

export type WorkspaceDocCommandLineTarget = {
    id: string;
    startLine: number;
    endLine: number;
};

export function WorkspaceDocCommandBlock({
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
    lineTargets?: WorkspaceDocCommandLineTarget[];
    sourceLine?: number | null;
    sourceOffset?: number | null;
}) {
    const [copied, setCopied] = useState(false);
    const codeLines = code.trimEnd().split("\n");
    const lineTargetByStartLine = useMemo(() => {
        const map = new Map<number, WorkspaceDocCommandLineTarget>();
        lineTargets.forEach((target) => map.set(target.startLine, target));
        return map;
    }, [lineTargets]);
    const rootEditorTargetId = projectDocEditorTargetId("command", sourceLine ?? null, sourceOffset ?? null);

    const isShell = !language || SHELLS.has(language.toLowerCase());
    // Commands are copied without their `$ ` prompts; a failed copy says so (report A9.1, finding 115).
    const handleCopy = async () => {
        try {
            await copyText(isShell ? commandsOf(code) : code.trimEnd());
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1400);
        } catch {
            toast.error(COPY_FAILED);
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
            className={cn(terminal.block, "group relative my-4 scroll-mt-28 outline-none")}
        >
            {language ? (
                <div className={terminal.header}>
                    <span className="nb-micro">{language}</span>
                </div>
            ) : null}
            <button
                type="button"
                onClick={handleCopy}
                data-readme-copy-button="true"
                title={copied ? "Copied" : "Copy"}
                aria-label={copied ? "Copied" : "Copy command"}
                className={cn(
                    "nb-touch-target absolute right-1.5 top-1 inline-flex size-7 items-center justify-center rounded-[5px] border bg-muted text-muted-foreground transition-colors hover:text-foreground hover:bg-card",
                    copied ? "border-foreground/20 text-foreground" : "border-border",
                )}
            >
                {copied
                    ? <Check key="copied" className="size-3.5 animate-in zoom-in-50 fade-in duration-200 motion-reduce:animate-none" />
                    : <Copy key="copy" className="size-3.5 animate-in fade-in duration-150 motion-reduce:animate-none" />}
                <span className="sr-only" aria-live="polite">{copied ? "Copied" : "Copy command"}</span>
            </button>
            <pre className={cn(terminal.body, terminal.wrap, "pr-12")}>
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
                                {isShell && /^\s*\$\s?/.test(line)
                                    ? <><span aria-hidden="true" className={terminal.prompt}>$</span>{line.replace(/^\s*\$\s?/, "")}</>
                                    : line || " "}
                            </span>
                        );
                    })}
                </code>
            </pre>
        </div>
    );
}

"use client";

import { useState } from "react";
import { Check, Copy, Terminal } from "lucide-react";
import { copyWithToast } from "@/lib/clipboard";

type Props = {
  language?: string;
  code: string;
};

export function CodeSnippetBlock({ language = "text", code }: Props) {
  const [copied, setCopied] = useState(false);
  const cleanCode = code.replace(/\n$/, "");
  const lines = cleanCode.split("\n");

  const copy = async () => {
    if (!(await copyWithToast(cleanCode, "Code copied"))) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const displayLang = language.replace(/^language-/, "").toLowerCase() || "code";
  const copyButton = (extra = "") => (
    <button
      type="button"
      onClick={() => void copy()}
      className={`inline-flex h-6 items-center gap-1 rounded-[4px] px-2 text-[11px] font-medium hover:bg-card hover:text-foreground transition-colors pointer-coarse:h-9 ${extra}`}
      aria-label="Copy code"
      title="Copy code"
    >
      {copied ? <Check size={12} className="text-[var(--status-success)]" /> : <Copy size={12} />}
      <span className="hidden sm:inline">{copied ? "Copied" : "Copy"}</span>
    </button>
  );

  // A line or two: no header or line numbers, just the code and a Copy on hover.
  if (lines.length < 3) {
    return (
      <div className="group/code relative my-2 overflow-hidden rounded-lg border border-border bg-muted/60">
        <pre className="app-scroll overflow-x-auto p-3 pr-16 font-mono text-[13px] leading-relaxed text-foreground">{cleanCode || " "}</pre>
        {copyButton("absolute right-1.5 top-1.5 bg-muted/90 text-muted-foreground pointer-fine:opacity-0 pointer-fine:group-hover/code:opacity-100 focus-visible:opacity-100")}
      </div>
    );
  }

  return (
    <div className="my-2.5 overflow-hidden rounded-lg border border-border bg-muted/60 text-[13px] shadow-xs">
      {/* Code Header Bar */}
      <div className="flex items-center justify-between border-b border-border bg-muted/90 px-3 py-1.5 text-muted-foreground">
        <div className="flex items-center gap-2">
          <Terminal size={14} className="text-muted-foreground" />
          <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-foreground/80">
            {displayLang}
          </span>
          <span className="font-mono text-[11px] text-muted-foreground">
            {lines.length} {lines.length === 1 ? "line" : "lines"}
          </span>
        </div>
        <div className="flex items-center gap-1">{copyButton()}</div>
      </div>

      {/* Code with line numbers: a <pre> (read as code), the numbers hidden from screen readers and copy. */}
      <pre className="app-scroll overflow-x-auto p-3 font-mono text-[13px] leading-relaxed text-foreground">
        {lines.map((line, idx) => (
          <span key={idx} className="block hover:bg-card/40">
            <span aria-hidden="true" className="inline-block w-8 select-none pr-3 text-right text-[11px] text-muted-foreground/60">{idx + 1}</span>
            {line || " "}
          </span>
        ))}
      </pre>
    </div>
  );
}

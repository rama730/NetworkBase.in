"use client";

import { useState } from "react";
import { Check, Copy, Terminal } from "lucide-react";
import { copyWithToast } from "@/lib/clipboard";

type Props = {
  language?: string;
  code: string;
};

// A long paste stays a few screens tall: past this many lines it scrolls inside, with "Show all".
const COLLAPSED_LINES = 20;

export function CodeSnippetBlock({ language = "text", code }: Props) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
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
      className={`inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12px] font-medium transition-colors duration-[130ms] hover:bg-card hover:text-foreground pointer-coarse:h-11 ${extra}`}
      aria-label="Copy code"
      title="Copy code"
    >
      {copied ? <Check size={14} className="text-[var(--status-success)]" /> : <Copy size={14} />}
      <span className="hidden sm:inline">{copied ? "Copied" : "Copy"}</span>
    </button>
  );

  // A line or two: no header or line numbers, just the code and a Copy on hover.
  if (lines.length < 3) {
    return (
      <div className="group/code relative my-2 overflow-hidden rounded-lg border border-border bg-muted">
        <pre className="app-scroll overflow-x-auto p-3 pr-16 font-mono text-[13px] leading-relaxed text-foreground">{cleanCode || " "}</pre>
        {copyButton("absolute right-1.5 top-1.5 bg-muted text-muted-foreground pointer-fine:opacity-0 pointer-fine:group-hover/code:opacity-100 focus-visible:opacity-100")}
      </div>
    );
  }

  const long = lines.length > COLLAPSED_LINES;
  return (
    <div className="my-2.5 overflow-hidden rounded-lg border border-border bg-muted text-[13px]">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5 text-muted-foreground">
        <div className="flex items-center gap-2">
          <Terminal size={14} className="text-muted-foreground" />
          <span className="nb-micro text-foreground">{displayLang}</span>
          <span className="nb-meta">{lines.length} {lines.length === 1 ? "line" : "lines"}</span>
        </div>
        <div className="flex items-center gap-1">{copyButton()}</div>
      </div>

      {/* Code with line numbers: a <pre> (read as code), the numbers hidden from screen readers and copy. */}
      <pre className={`app-scroll app-scroll-y overflow-x-auto p-3 font-mono text-[13px] leading-relaxed text-foreground ${long && !expanded ? "max-h-[24rem]" : ""}`}>
        {lines.map((line, idx) => (
          <span key={idx} className="block hover:bg-card">
            <span aria-hidden="true" className="inline-block w-8 select-none pr-3 text-right text-[11px] text-muted-foreground">{idx + 1}</span>
            {line || " "}
          </span>
        ))}
      </pre>
      {long ? (
        <button type="button" onClick={() => setExpanded(!expanded)} className="flex min-h-9 w-full items-center justify-center border-t border-border text-[13px] font-medium text-primary hover:bg-card pointer-coarse:min-h-11">
          {expanded ? "Show less" : `Show all ${lines.length} lines`}
        </button>
      ) : null}
    </div>
  );
}

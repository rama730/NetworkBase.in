"use client";

import { useState } from "react";
import { Check, Copy, ExternalLink, Terminal } from "lucide-react";
import { toast } from "sonner";
import { buildIdeLaunchUri, dispatchIdeProtocol } from "@/lib/extension/ide-protocol";

type Props = {
  language?: string;
  code: string;
};

export function CodeSnippetBlock({ language = "text", code }: Props) {
  const [copied, setCopied] = useState(false);
  const cleanCode = code.replace(/\n$/, "");
  const lines = cleanCode.split("\n");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(cleanCode);
      setCopied(true);
      toast.success("Code copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy code");
    }
  };

  const openInIde = () => {
    try {
      // Launch via desktop IDE protocol
      const uri = buildIdeLaunchUri({
        ide: "cursor",
        projectId: "chat-snippet",
      });
      dispatchIdeProtocol(uri, () => {
        void copy();
      });
      toast.success("Opening in IDE...");
    } catch {
      void copy();
    }
  };

  const displayLang = language.replace(/^language-/, "").toLowerCase() || "code";

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
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={openInIde}
            className="inline-flex h-6 items-center gap-1 rounded-[4px] px-2 text-[11px] font-medium hover:bg-card hover:text-foreground transition-colors"
            title="Open in your desktop editor"
          >
            <ExternalLink size={12} />
            <span className="hidden sm:inline">Open in IDE</span>
          </button>
          <button
            type="button"
            onClick={() => void copy()}
            className="inline-flex h-6 items-center gap-1 rounded-[4px] px-2 text-[11px] font-medium hover:bg-card hover:text-foreground transition-colors"
            aria-label="Copy code"
            title="Copy code"
          >
            {copied ? <Check size={12} className="text-[var(--status-success)]" /> : <Copy size={12} />}
            <span className="hidden sm:inline">{copied ? "Copied" : "Copy"}</span>
          </button>
        </div>
      </div>

      {/* Code Body with Line Numbers */}
      <div className="app-scroll overflow-x-auto p-3 font-mono text-[13px] leading-relaxed">
        <table className="w-full border-collapse">
          <tbody>
            {lines.map((line, idx) => (
              <tr key={idx} className="hover:bg-card/40 transition-colors">
                <td className="w-8 select-none pr-3 text-right font-mono text-[11px] text-muted-foreground/60 align-top">
                  {idx + 1}
                </td>
                <td className="whitespace-pre font-mono text-foreground align-top">
                  {line || " "}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

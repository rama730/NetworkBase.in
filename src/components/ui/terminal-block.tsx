"use client";

import { useMemo, useState } from "react";

import { CopyButton } from "@/components/ui/copy-button";
import { commandsOf, parseAnsi, stripAnsi } from "@/lib/terminal/ansi";

import styles from "./terminal-block.module.css";

type Props = {
  /** command: `$ …` lines, copied without the prompt; output: program output (ANSI colors kept); code: source. */
  variant: "command" | "output" | "code";
  children: string;
  label?: string;
  /** Line numbers (code), never copied. */
  lines?: boolean;
  /** Collapse after this many lines (default 20 for output and code). */
  collapseAfter?: number;
  copy?: boolean;
  /** Color added and removed diff lines. */
  diff?: boolean;
  /** Wrap long lines instead of scrolling sideways. */
  wrap?: boolean;
  className?: string;
};

const HUGE = 2_000;

/** Commands, output and code in one style (report A9.1–A9.2): prompts and line numbers are never copied. */
export function TerminalBlock({ variant, children, label, lines = false, collapseAfter, copy = true, diff = false, wrap = false, className }: Props) {
  const [open, setOpen] = useState(false);
  const text = children.replace(/\r\n/g, "\n").replace(/\n$/, "");
  const all = text.split("\n");
  const limit = collapseAfter ?? (variant === "command" ? Infinity : 20);
  const huge = all.length > HUGE;
  const shown = open ? (huge ? [...all.slice(0, 200), `… ${all.length - 400} lines not shown …`, ...all.slice(-200)] : all) : all.slice(0, limit);
  const copyText = variant === "command" ? commandsOf(text) : stripAnsi(text);
  const digits = String(all.length).length;
  const runsByLine = useMemo(() => (variant === "output" ? shown.map((l) => parseAnsi(l)) : null), [variant, shown]);

  return (
    <div role="region" aria-label={label ?? (variant === "code" ? "Code" : variant === "output" ? "Output" : "Command")} className={`${styles.block} ${className ?? ""}`}>
      {(label || copy) && (
        <div className={styles.header}>
          <span className="nb-micro">{label ?? (variant === "command" ? "Terminal" : variant === "output" ? "Output" : "")}</span>
          {copy && <CopyButton text={copyText} variant="ghost" className="nb-touch-target" />}
        </div>
      )}
      <pre tabIndex={0} className={`${styles.body} ${wrap ? styles.wrap : ""} app-scroll`}>
        <code>
          {shown.map((line, i) => {
            const n = i + 1;
            const gutter = lines ? <span aria-hidden="true" className={styles.gutter} style={{ minWidth: `${digits + 2}ch` }}>{n}</span> : null;
            let content: React.ReactNode = line;
            if (variant === "command") {
              const prompt = /^\s*[$>]\s?/.exec(line);
              content = prompt ? <><span aria-hidden="true" className={styles.prompt}>$</span>{line.slice(prompt[0].length)}</> : line;
            } else if (runsByLine) {
              content = runsByLine[i]!.map((r, j) => (
                <span key={j} className={[r.tone ? styles[r.tone] : "", r.bold ? "font-semibold" : "", r.dim ? "opacity-70" : "", r.italic ? "italic" : "", r.underline ? "underline" : ""].filter(Boolean).join(" ") || undefined}>{r.text}</span>
              ));
            } else if (diff) {
              const tone = /^\+(?!\+\+)/.test(line) ? styles.add : /^-(?!--)/.test(line) ? styles.del : /^@@/.test(line) ? styles.info : undefined;
              content = tone ? <span className={tone}>{line}</span> : line;
            }
            return <span key={i}>{gutter}{content}{i < shown.length - 1 ? "\n" : ""}</span>;
          })}
        </code>
      </pre>
      {all.length > limit && (
        <button type="button" className={styles.more} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? "Show less" : `Show all ${all.length.toLocaleString()} lines`}
        </button>
      )}
    </div>
  );
}

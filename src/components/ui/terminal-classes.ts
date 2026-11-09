/**
 * One look for commands, output and code everywhere (CLI report A9.1): 13px mono at 1.6, the app's tokens, so light
 * and dark follow the theme. Plain class strings (no CSS module), shared by TerminalBlock and the README command block.
 */
export const terminal = {
  block: "overflow-hidden rounded-[var(--radius)] border border-border bg-muted font-mono text-[13px] leading-[1.6] text-foreground pointer-coarse:text-[14px]",
  header: "flex min-h-8 items-center justify-between gap-2 border-b border-border pl-3 pr-1.5",
  body: "m-0 overflow-x-auto whitespace-pre px-3.5 py-3 [tab-size:2] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
  wrap: "whitespace-pre-wrap [overflow-wrap:anywhere]",
  prompt: "select-none pr-[1ch] text-muted-foreground",
  gutter: "inline-block select-none pr-[2ch] text-right text-muted-foreground",
  more: "block w-full border-t border-border px-3.5 py-1.5 text-left font-mono text-xs font-medium text-muted-foreground hover:text-foreground",
  success: "text-[var(--status-success)]",
  warning: "text-[var(--status-warning)]",
  danger: "text-destructive",
  info: "text-primary",
  muted: "text-muted-foreground",
  add: "text-[var(--status-success)]",
  del: "text-destructive",
} as const;

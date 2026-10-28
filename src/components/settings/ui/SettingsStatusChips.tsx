import Link from "next/link";
import { cn } from "@/lib/utils";

export type SettingsStatusChip = {
  label: string;
  value: string;
  /** `attention` for something the person may want to fix; the default is neutral. */
  tone?: "ok" | "attention" | "neutral";
  /** Where the control for this lives (a #hash inside the page). */
  href?: string;
};

/** A one-line summary at the top of a section: what is set, each chip linking to its control. */
export function SettingsStatusChips({ items, label }: { items: SettingsStatusChip[]; label: string }) {
  return (
    <ul aria-label={label} className="flex flex-wrap gap-2">
      {items.map((item) => {
        const body = (
          <>
            <span className="text-muted-foreground">{item.label}</span>
            <span className="font-medium text-foreground">{item.value}</span>
          </>
        );
        const className = cn(
          "inline-flex min-h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 nb-meta pointer-coarse:min-h-11",
          item.tone === "ok" && "border-[var(--status-success)]/30 bg-[var(--status-success-soft)]",
          item.tone === "attention" && "border-[var(--status-warning)]/40 bg-[var(--status-warning-soft)]",
        );
        return (
          <li key={item.label}>
            {item.href ? <Link href={item.href} className={cn(className, "hover:border-foreground/40 focus-visible:border-foreground")}>{body}</Link> : <span className={className}>{body}</span>}
          </li>
        );
      })}
    </ul>
  );
}

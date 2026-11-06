import type { ReactNode } from "react";
import { AlertCircle, AlertTriangle, Info } from "lucide-react";

import { cn } from "@/lib/utils";

const TONE = {
  neutral: { box: "bg-muted", icon: "text-muted-foreground", Icon: Info },
  info: { box: "bg-[var(--status-info-soft)]", icon: "text-[var(--status-info)]", Icon: Info },
  warning: { box: "bg-[var(--status-warning-soft)]", icon: "text-[var(--status-warning)]", Icon: AlertTriangle },
  danger: { box: "bg-[var(--status-danger-soft)]", icon: "text-[var(--status-danger)]", Icon: AlertCircle },
} as const;

/**
 * A state the reader should know about, near the work it affects (spec §33: archived, suspended, restricted,
 * scheduled for deletion, offline). One look for every one of them; at most one action. Danger is an alert.
 */
export function Notice({ tone = "neutral", children, action, className }: { tone?: keyof typeof TONE; children: ReactNode; action?: ReactNode; className?: string }) {
  const { box, icon, Icon } = TONE[tone];
  return (
    <div role={tone === "danger" ? "alert" : "status"} data-tone={tone} className={cn("flex flex-wrap items-start gap-x-2.5 gap-y-2 rounded-md border border-border px-3 py-2 text-[13px] leading-[1.5] text-foreground", box, className)}>
      <Icon className={cn("mt-0.5 size-4 shrink-0", icon)} aria-hidden="true" />
      <div className="min-w-0 flex-1">{children}</div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  );
}

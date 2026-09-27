import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

type SecurityListRowProps = {
  icon?: LucideIcon;
  title: ReactNode;
  badges?: ReactNode;
  meta?: ReactNode;
  details?: ReactNode;
  summary?: ReactNode;
  action?: ReactNode;
};

export function SecurityListRow({ icon: Icon, title, badges, meta, details, summary, action }: SecurityListRowProps) {
  return (
    <div className="flex min-h-16 flex-col gap-3 rounded-md border border-border bg-background p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        {Icon ? <span className="rounded-md bg-muted p-2 text-muted-foreground"><Icon className="size-4" strokeWidth={1.75} /></span> : null}
        <div className="min-w-0">
          <div className="nb-ui-label flex flex-wrap items-center gap-2 text-foreground">{title}{badges}</div>
          {details ? <div className="nb-meta mt-1 flex flex-wrap items-center gap-2">{details}</div> : null}
          {summary ? <div className="nb-compact mt-2 text-muted-foreground">{summary}</div> : null}
        </div>
      </div>
      {meta || action ? <div className="nb-meta flex shrink-0 items-center gap-2">{meta}{action}</div> : null}
    </div>
  );
}

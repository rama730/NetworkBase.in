"use client";

import type { ReactNode } from "react";
import type { IconComponent } from "@/components/ui/icons";
import { useOpenSettingsSections } from "./SettingsSectionLayout";

type SecurityListRowProps = {
  icon?: IconComponent;
  /** Replaces the icon tile (a picture, a pixel figure). */
  tile?: ReactNode;
  title: ReactNode;
  badges?: ReactNode;
  meta?: ReactNode;
  details?: ReactNode;
  summary?: ReactNode;
  action?: ReactNode;
  id?: string;
  /** Full-width content under the row (a note, an inline form). */
  children?: ReactNode;
};

/** One list layout (mix): tile, name with tags, mono detail, actions on the right. */
export function SecurityListRow({ icon: Icon, tile, title, badges, meta, details, summary, action, id, children }: SecurityListRowProps) {
  const open = useOpenSettingsSections();
  if (open) {
    return (
      <div className="nbs-li" id={id} data-find={id && typeof title === "string" ? title : undefined}>
        {tile ?? <span className="tile" aria-hidden="true">{Icon ? <Icon strokeWidth={1.75} /> : null}</span>}
        <div className="min-w-0">
          <div className="nm">{title}{badges}</div>
          {details ? <div className="dt">{details}</div> : null}
          {summary ? <div className="dt">{summary}</div> : null}
        </div>
        <div className="ctl">{meta ? <span className="nbs-meta">{meta}</span> : null}{action}</div>
        {children ? <div className="wide">{children}</div> : null}
      </div>
    );
  }
  return (
    <div id={id} className="flex min-h-16 flex-col gap-3 rounded-md border border-border bg-background p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        {tile ?? (Icon ? <span className="rounded-md bg-muted p-2 text-muted-foreground"><Icon className="size-4" strokeWidth={1.75} /></span> : null)}
        <div className="min-w-0">
          <div className="nb-ui-label flex flex-wrap items-center gap-2 text-foreground">{title}{badges}</div>
          {details ? <div className="nb-meta mt-1 flex flex-wrap items-center gap-2">{details}</div> : null}
          {summary ? <div className="nb-compact mt-2 text-muted-foreground">{summary}</div> : null}
        </div>
      </div>
      {meta || action ? <div className="nb-meta flex shrink-0 items-center gap-2">{meta}{action}</div> : null}
      {children}
    </div>
  );
}

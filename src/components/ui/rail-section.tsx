"use client";

import { useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Discover's title and hairline, shared by contextual right rails. */
export function RailSectionHeading({ title, id, action }: {
  title: string;
  id?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-center gap-3">
      {/* Parity bug 12: a long heading cuts off instead of widening the page; the full text stays in the title. */}
      <h2 id={id} className="nb-micro min-w-0 truncate" title={title}>{title}</h2>
      <div className="h-px min-w-0 flex-1 bg-border" aria-hidden="true" />
      {action ? <div className="flex shrink-0 items-center">{action}</div> : null}
    </div>
  );
}

export function RailSection({ title, id, headingId, action, children, className, contentClassName }: {
  title: string;
  id?: string;
  headingId?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  const generatedId = useId();
  const labelId = headingId ?? generatedId;
  return (
    <section id={id} aria-labelledby={labelId} className={cn("min-w-0", className)}>
      <RailSectionHeading title={title} id={labelId} action={action} />
      <div className={cn("rounded-lg border border-border bg-card p-4 text-card-foreground shadow-none", contentClassName)}>
        {children}
      </div>
    </section>
  );
}

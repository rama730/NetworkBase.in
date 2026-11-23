import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { SlowNote } from "@/components/ui/SlowNote";

/**
 * Loading screens in the mix style (prototype: Skeleton loading v2). What the page always has (labels, tab names, the
 * band's grid) shows for real; only the person's data is a skeleton. Every part sizes like the real thing so nothing
 * jumps when it arrives.
 */
export function SkeletonPage({ label, wide = false, children, className }: { label: string; wide?: boolean; children: ReactNode; className?: string }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" aria-label={`Loading ${label}`} className={cn("min-h-full bg-background text-foreground", className)}>
      <span className="sr-only">Loading {label}…</span>
      <div aria-hidden="true" className={cn("nb-sk-page", wide && "is-wide")}>{children}</div>
      <SlowNote label={label} />
    </div>
  );
}

/** A label that is always there ("About", "Members"), with its rule. */
export function SkeletonLabel({ children, rule = true }: { children: ReactNode; rule?: boolean }) {
  return <p className={cn("nb-pf-label", rule && "has-rule")}>{children}</p>;
}

/** Lines of text: cap-height bars, the last one shorter. */
export function SkeletonText({ lines = 2, widths }: { lines?: number; widths?: string[] }) {
  const w = widths ?? Array.from({ length: lines }, (_, i) => (i === lines - 1 && lines > 1 ? "62%" : i % 2 ? "88%" : "96%"));
  return <div className="nb-sk-lines">{w.map((width, i) => <Skeleton key={i} kind="text" style={{ width }} />)}</div>;
}

/** The identity band: photo tile, name, handle and headline, optional stats row. `photo="none"` for a band with no picture. */
export function SkeletonBand({ photo = "person", stats = 0, actions = 1, title }: { photo?: "person" | "place" | "none"; stats?: number; actions?: number; title?: ReactNode }) {
  return (
    <section className="nb-pf-band nb-sk-band">
      <div className="nb-sk-band-in">
        {photo !== "none" ? <Skeleton kind="tile" className="nb-sk-photo" /> : null}
        <div className="nb-sk-id">
          {title ? <p className="nb-sk-title">{title}</p> : <Skeleton className="nb-sk-name" />}
          <Skeleton kind="text" style={{ width: 150 }} />
          <Skeleton kind="text" style={{ width: "min(340px, 100%)" }} />
        </div>
        <div className="nb-sk-acts">{Array.from({ length: actions }, (_, i) => <Skeleton key={i} className="nb-sk-btn" />)}</div>
      </div>
      {stats ? (
        <div className="nb-sk-stats" style={{ ["--cols" as string]: stats }}>
          {Array.from({ length: stats }, (_, i) => <div key={i}><Skeleton style={{ width: 22, height: 22 }} /><Skeleton kind="text" style={{ width: 84 }} /></div>)}
        </div>
      ) : null}
    </section>
  );
}

/** The tab bar under a band, or on its own (`attached={false}`). Tab names are real. */
export function SkeletonTabBar({ tabs, attached = true }: { tabs: string[]; attached?: boolean }) {
  return (
    <div className={cn("nb-sk-tabs", !attached && "is-alone")}>
      {tabs.map((tab, i) => <span key={tab} className={cn("nb-sk-tab", i === 0 && "is-on")}>{tab}</span>)}
    </div>
  );
}

/** List rows: a picture tile, two lines, and an action. */
export function SkeletonRows({ count = 5, tile = 36, action = true, className }: { count?: number; tile?: number | false; action?: boolean; className?: string }) {
  return (
    <div className={cn("nb-sk-rows", className)}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="nb-sk-row">
          {tile ? <Skeleton kind="tile" style={{ width: tile, height: tile }} /> : null}
          <SkeletonText widths={[i % 2 ? "38%" : "46%", i % 3 ? "64%" : "52%"]} />
          {action ? <Skeleton className="nb-sk-btn is-sm" /> : null}
        </div>
      ))}
    </div>
  );
}

/** A grid of cards (workspaces, people): picture tile, title, two lines, footer. */
export function SkeletonCards({ count = 6, columns = 3 }: { count?: number; columns?: number }) {
  return (
    <div className="nb-sk-cards" style={{ ["--cols" as string]: columns }}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="nb-sk-card">
          <div className="nb-sk-card-top"><Skeleton kind="tile" style={{ width: 32, height: 32 }} /><SkeletonText widths={["58%", "36%"]} /></div>
          <SkeletonText lines={2} />
          <div className="nb-sk-card-foot"><Skeleton kind="text" style={{ width: 60 }} /><Skeleton kind="tile" style={{ width: 20, height: 20 }} /></div>
        </div>
      ))}
    </div>
  );
}

/** A card panel with lines of text, optionally under a real label. */
export function SkeletonPanel({ label, lines = 3, children }: { label?: ReactNode; lines?: number; children?: ReactNode }) {
  return (
    <section className="nb-sk-section">
      {label ? <SkeletonLabel>{label}</SkeletonLabel> : null}
      <div className="nb-pf-panel nb-sk-panel">{children ?? <SkeletonText lines={lines} />}</div>
    </section>
  );
}

/** A form: real field labels, input-height blocks. */
export function SkeletonForm({ fields, submit = true }: { fields: string[]; submit?: boolean }) {
  return (
    <div className="nb-sk-form">
      {fields.map((field) => <div key={field} className="nb-sk-field"><span className="nb-sk-flabel">{field}</span><Skeleton className="nb-sk-input" /></div>)}
      {submit ? <Skeleton className="nb-sk-input is-btn" /> : null}
    </div>
  );
}

/** Body beside a right card (profile, workspace overview). */
export function SkeletonBody({ main, rail }: { main: ReactNode; rail?: ReactNode }) {
  return <div className={cn("nb-sk-body", !rail && "is-solo")}><div className="nb-sk-col">{main}</div>{rail ? <div className="nb-sk-rail">{rail}</div> : null}</div>;
}

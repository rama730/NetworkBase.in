import type { ReactNode } from "react";
import { capCount, padCount } from "@/lib/messaging/mix-format";

/** Three stepping squares: the only loader in Messages. A label makes it a status for screen readers. */
export function PixelBeat({ label, className = "" }: { label?: string; className?: string }) {
  return (
    <span className={`nbm-beat ${className}`} role={label ? "status" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <i /><i /><i />
    </span>
  );
}

/** Ten squares, one per 10 %. */
export function PixelProgress({ value, label, className = "" }: { value: number; label: string; className?: string }) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <span className={`nbm-pxprog ${className}`} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={v}>
      {Array.from({ length: 10 }, (_, i) => <i key={i} data-on={v >= (i + 1) * 10 ? "" : undefined} />)}
    </span>
  );
}

/** Mono section label with a count and a hairline rule; actions sit at the end. */
export function GroupLabel({ label, count, actions, className = "" }: { label: ReactNode; count?: number; actions?: ReactNode; className?: string }) {
  return (
    <div className={`nbm-glabel ${className}`}>
      <span>{label}</span>
      {count ? <b aria-hidden="true">{padCount(count)}</b> : null}
      <span className="nbm-glabel-rule" aria-hidden="true" />
      {actions}
    </div>
  );
}

/** Square mono count: clay when it needs you, quiet otherwise; nothing at zero. */
export function MixCount({ value, hot = false, cap = 99, pad = true }: { value: number; hot?: boolean; cap?: number; pad?: boolean }) {
  if (!value || value <= 0) return null;
  return <span className={`nbm-count${hot ? " hot" : ""}`}>{pad ? padCount(value, cap) : capCount(value, cap)}</span>;
}

/** Square mono tag. */
export function MixTag({ tone, children, className = "" }: { tone?: "ok" | "warn" | "bad" | "hot"; children: ReactNode; className?: string }) {
  return <span className={`nbm-tag${tone ? ` ${tone}` : ""} ${className}`}>{children}</span>;
}

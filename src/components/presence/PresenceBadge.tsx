import type { Availability } from "@/lib/presence/model";
import { cn } from "@/lib/utils";

/**
 * The Node badge: one rounded square showing availability only, one small
 * change per step (solid green → grey inner square → amber cutout → grey cutout).
 * A set status is an emoji + text shown beside the name, never on the badge.
 * Colors and the 2 px cut-out come from --presence-* tokens (globals.css).
 */
export function PresenceBadge({
  availability,
  size = 14,
  label,
  className,
  style,
  testId,
}: {
  availability: Availability;
  size?: number;
  label?: string;
  className?: string;
  style?: React.CSSProperties;
  testId?: string;
}) {
  const hasCutout = availability === "today" || availability === "week" || availability === "offline";

  return (
    <span
      suppressHydrationWarning
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      title={label}
      data-testid={testId}
      data-availability={availability}
      className={cn("nb-presence", className)}
      style={{ width: size, height: size, ...style }}
    >
      {hasCutout ? <span aria-hidden="true" className="nb-presence-cutout" /> : null}
    </span>
  );
}

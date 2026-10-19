"use client";

import { useState } from "react";

import { advanceBadgeSpin, showStatusChip, type Availability } from "@/lib/presence/model";
import { cn } from "@/lib/utils";

/** Four rings from the NetworkBase presence design: radius, stroke, and each colored arc as [start°, length°]. */
const RINGS = [
  { r: 135, w: 34, arcs: [[212, 251]] },
  { r: 240, w: 30, arcs: [[149, 130], [44.5, 85]] },
  { r: 330, w: 28, arcs: [[3, 142]] },
  { r: 413, w: 28, arcs: [[210.5, 71], [109.5, 69]] },
] as const;

const CENTER = "645 710";

/**
 * The presence badge: four rings, a gray track under a colored arc each, in one
 * hue per availability (green now, blue today, amber this week, gray offline).
 * When availability changes the rings turn once (`advanceBadgeSpin`); becoming
 * Active now ends with one halo. A person's status emoji sits in a chip docked on
 * the rings' left, only where the badge is big enough (`showStatusChip`).
 * Colors, the 2 px cut-out and the motion come from `--presence-*` rules (globals.css).
 * `animate` is false until the data behind `availability` has loaded.
 */
export function PresenceBadge({
  availability,
  size = 14,
  label,
  className,
  style,
  testId,
  statusEmoji,
  animate = true,
}: {
  availability: Availability;
  size?: number;
  label?: string;
  className?: string;
  style?: React.CSSProperties;
  testId?: string;
  statusEmoji?: string | null;
  animate?: boolean;
}) {
  const [spin, setSpin] = useState({ availability, armed: animate, angle: 0, halo: 0 });
  const next = advanceBadgeSpin(spin, availability, animate);
  if (next !== spin) setSpin(next);

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
      style={style}
    >
      {showStatusChip(statusEmoji, size) ? (
        <span aria-hidden="true" className="nb-presence-chip" style={{ width: size, height: size, fontSize: Math.round(size * 0.62) }}>{statusEmoji}</span>
      ) : null}
      <span className="nb-presence-badge" style={{ width: size, height: size }}>
        <svg aria-hidden="true" className="nb-presence-svg" viewBox="205 270 880 880" width="100%" height="100%" focusable="false">
          {RINGS.map((ring) => (
            <g key={ring.r} className="nb-presence-ring" style={{ transform: `rotate(${spin.angle}deg)` }}>
              <circle className="nb-presence-track" cx="645" cy="710" r={ring.r} fill="none" strokeWidth={ring.w} />
              {ring.arcs.map(([start, length]) => (
                <circle
                  key={start}
                  className="nb-presence-arc"
                  cx="645"
                  cy="710"
                  r={ring.r}
                  fill="none"
                  strokeWidth={ring.w}
                  strokeLinecap="round"
                  pathLength={360}
                  strokeDasharray={`${length - 0.01} ${360 - length + 0.01}`}
                  transform={`rotate(${start} ${CENTER})`}
                />
              ))}
            </g>
          ))}
        </svg>
        {spin.halo > 0 ? <span key={spin.halo} aria-hidden="true" className="nb-presence-halo" /> : null}
      </span>
    </span>
  );
}

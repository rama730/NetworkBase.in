import { cn } from "@/lib/utils";
import type { CSSProperties } from "react";

export type BrandTone = "bare" | "ink" | "paper" | "accent";
export type BrandVariant = "lockup" | "stacked" | "dot" | "monogram";
export type BrandGround = "surface" | "image";

type BrandMarkProps = {
  variant?: BrandVariant;
  tone?: BrandTone;
  size?: number;
  trademark?: boolean;
  /**
   * A wordmark over photography or other mixed imagery is always rendered on
   * the fixed Ink slab. This makes the safe treatment the easy treatment.
   */
  ground?: BrandGround;
  className?: string;
  label?: string;
};

/**
 * The one canonical NetworkBase mark. The dot always precedes the wordmark;
 * product surfaces use the active semantic primary token rather than a fixed
 * export colour so every supported appearance remains coherent.
 */
export function BrandMark({
  variant = "lockup",
  tone = "bare",
  size = 17,
  trademark = false,
  ground = "surface",
  className,
  label,
}: BrandMarkProps) {
  const resolvedSize = Math.max(variant === "dot" ? 12 : 14, size);
  const dot = Math.max(6, Math.round(resolvedSize * 0.41));
  const resolvedTone = ground === "image" ? "ink" : tone;
  const gap = Math.round(dot * 0.55);
  const style = {
    "--nb-brand-mark-size": `${resolvedSize}px`,
    "--nb-brand-dot-size": `${dot}px`,
    // The dot/name relationship is part of the mark, not a layout decision
    // for individual surfaces. Keep it resistant to accidental reflow.
    gap: `${gap}px`,
  } as CSSProperties;
  const accessible = label ? { role: "img" as const, "aria-label": label } : { "aria-hidden": true };

  if (variant === "dot") {
    return (
      <span className={cn("nb-brand-mark nb-brand-mark--dot", `nb-brand-mark--${resolvedTone}`, className)} style={style} data-brand-ground={ground} {...accessible}>
        <span className="nb-brand-dot" />
      </span>
    );
  }

  if (variant === "monogram") {
    return (
      <span className={cn("nb-brand-mark nb-brand-mark--monogram", `nb-brand-mark--${resolvedTone}`, className)} style={style} data-brand-ground={ground} {...accessible}>
        <span className="nb-brand-monogram" aria-hidden="true">NB</span>
      </span>
    );
  }

  return (
    <span className={cn("nb-brand-mark", `nb-brand-mark--${variant}`, `nb-brand-mark--${resolvedTone}`, className)} style={style} data-brand-ground={ground} {...accessible}>
      <span className="nb-brand-dot" aria-hidden="true" />
      <span className="nb-brand-name" aria-hidden="true">
        NetworkBase
        {trademark ? <sup className="ml-0.5 text-[0.6em] font-normal leading-none opacity-80 align-super" aria-label="Trade mark">™</sup> : null}
      </span>
    </span>
  );
}

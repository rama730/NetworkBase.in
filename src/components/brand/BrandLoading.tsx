"use client";

import { BrandMark, type BrandTone } from "@/components/brand/BrandMark";
import { cn } from "@/lib/utils";
import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";

export const DOT_LOADING_VARIANTS = [
  "breathe", "shuttle", "turn", "trace", "split", "wipe", "squash",
  "queue", "orbit", "tally", "relay", "cast", "shatter",
] as const;

export type DotLoadingVariant = (typeof DOT_LOADING_VARIANTS)[number];

const SMALL_SIZE_FALLBACKS = new Set<DotLoadingVariant>([
  "trace", "split", "queue", "orbit", "tally", "relay", "shatter",
]);

type DotLoaderProps = {
  loading?: boolean;
  variant?: DotLoadingVariant;
  size?: number;
  /** Do not show a transient loader for work that resolves in under 300ms. */
  appearAfterMs?: number;
  /** A stalled operation resolves to the danger dot after ten seconds. */
  stalledAfterMs?: number;
  className?: string;
  label?: string;
  announce?: boolean;
  onResolved?: () => void;
};

/**
 * The small, accessible loading primitive from the brand system. Every
 * mechanic lands on a single static dot; reduced-motion users see that dot
 * directly. This component deliberately does not manage page refresh.
 */
export function DotLoader({
  loading = true,
  variant = "breathe",
  size = 20,
  appearAfterMs = 300,
  stalledAfterMs = 10_000,
  className,
  label = "Loading",
  announce = true,
  onResolved,
}: DotLoaderProps) {
  const [visible, setVisible] = useState(appearAfterMs <= 0);
  const [stalled, setStalled] = useState(false);

  useEffect(() => {
    setVisible(appearAfterMs <= 0);
    setStalled(false);
    if (!loading) return;

    const reveal = window.setTimeout(() => setVisible(true), Math.max(0, appearAfterMs));
    const stall = window.setTimeout(() => setStalled(true), Math.max(0, stalledAfterMs));
    return () => {
      window.clearTimeout(reveal);
      window.clearTimeout(stall);
    };
  }, [appearAfterMs, loading, stalledAfterMs]);

  useEffect(() => {
    if (!loading) onResolved?.();
  }, [loading, onResolved]);

  const effectiveVariant = useMemo(
    () => size < 16 && SMALL_SIZE_FALLBACKS.has(variant) ? "breathe" : variant,
    [size, variant],
  );

  if (!visible && loading) return null;

  const accessibility = announce
    ? { role: "status" as const, "aria-label": stalled ? "Loading is taking longer than expected" : label, "aria-live": "polite" as const }
    : { "aria-hidden": true };

  return (
    <span
      className={cn("nb-dot-loader", `nb-dot-loader--${effectiveVariant}`, stalled && "nb-dot-loader--stalled", className)}
      style={{ "--nb-dot-loader-size": `${Math.max(6, size)}px` } as CSSProperties}
      {...accessibility}
    >
      <span className="nb-dot-loader__dot" aria-hidden="true" />
      {announce ? <span className="sr-only">{stalled ? "Loading is taking longer than expected" : label}</span> : null}
    </span>
  );
}

type WordmarkLoadIndicatorProps = Omit<DotLoaderProps, "size" | "className"> & {
  size?: number;
  tone?: BrandTone;
  className?: string;
};

/**
 * Reserves the complete lockup width from the first frame, so the brand mark
 * cannot jump as a route or dialog resolves.
 */
export function WordmarkLoadIndicator({
  loading = true,
  size = 17,
  tone = "bare",
  className,
  ...loaderProps
}: WordmarkLoadIndicatorProps) {
  return (
    <span className={cn("nb-wordmark-load", className)} data-loading={loading ? "true" : "false"}>
      <BrandMark size={size} tone={tone} className="nb-wordmark-load__placeholder" />
      {loading ? <DotLoader {...loaderProps} loading size={Math.max(12, Math.round(size * 0.9))} /> : <BrandMark size={size} tone={tone} label="NetworkBase" />}
    </span>
  );
}

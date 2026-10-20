"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";

import { useNow } from "@/components/presence/usePresence";
import {
  advanceBadgeSpin,
  initialBadgeSpin,
  LOADING_GIVE_UP_MS,
  LOADING_SHOW_AFTER_MS,
  loadingSettlePlan,
  ringOrder,
  ringWeight,
  showStatusEmoji,
  statusBadgeSize,
  statusTimerFraction,
  type Availability,
} from "@/lib/presence/model";
import { motionBudget } from "@/lib/presence/motion-budget";
import { cn } from "@/lib/utils";

/**
 * Four rings from the NetworkBase presence design. `r` is the ring's radius at
 * rest, `rs` its radius when a status emoji opens the centre; `arcs` are the
 * signature [start°, length°] pieces a ring shrinks to while it changes.
 */
const RINGS = [
  { r: 135, rs: 237, w: 34, arcs: [[212, 251]] },
  { r: 240, rs: 303, w: 30, arcs: [[149, 130], [44.5, 85]] },
  { r: 330, rs: 366, w: 28, arcs: [[3, 142]] },
  { r: 413, rs: 428, w: 28, arcs: [[210.5, 71], [109.5, 69]] },
] as const;

const CENTER = "645 710";
const SETTLE_MS = 900;
const FADE_MS = 600;
/** The status emoji opens the rings this long into the settle. */
const EMOJI_AFTER_MS = 450;

/** `wait` placeholder, `load` spinning gray arcs, `settle` landing on the real state, `fade` a quick answer, `rest`. */
type Phase = "wait" | "load" | "settle" | "fade" | "rest";
const vars = (values: Record<string, string | number>) => values as React.CSSProperties;
const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const parity = (count: number) => (count === 0 ? undefined : count % 2 ? "a" : "b");

/** Whether the badge is on screen (kept in a ref: only read when something changes; `onChange` is for the loader). */
function useVisible(ref: React.RefObject<HTMLElement | null>, onChange?: (visible: boolean) => void) {
  const visible = useRef(true);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => {
      visible.current = entry?.isIntersecting ?? true;
      onChange?.(visible.current);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, onChange]);
  return visible;
}

/** A ring's turning angle right now, read from its computed transform. */
function currentAngle(element: SVGGElement) {
  if (typeof DOMMatrix === "undefined") return 0;
  const { a, b } = new DOMMatrix(getComputedStyle(element).transform);
  return (Math.atan2(b, a) * 180) / Math.PI;
}

/** Keeps the last emoji on screen for the 0.3 s it takes to shrink away. */
function useLingering(emoji: string | null) {
  const [shown, setShown] = useState({ emoji, leaving: false });
  useEffect(() => {
    if (emoji) {
      setShown((prev) => (prev.emoji === emoji && !prev.leaving ? prev : { emoji, leaving: false }));
      return;
    }
    setShown((prev) => (prev.emoji ? { ...prev, leaving: true } : prev));
    const timer = setTimeout(() => setShown({ emoji: null, leaving: false }), 320);
    return () => clearTimeout(timer);
  }, [emoji]);
  return shown;
}

/**
 * The presence badge: four full rings in one hue per availability (green now,
 * blue today, amber this week, gray offline), thinner as activity drops. When
 * availability changes the rings shrink to their arcs, turn once and grow back
 * (a wave inner to outer going up, outer to inner going down), the badge pops,
 * and becoming Active now ends with one halo. Only three badges on screen run
 * that at a time; the rest just fade. A person's status emoji sits inside the
 * rings (they pull outward to make room) on badges of 20px or more; a timed
 * status drains the outer ring, one that pauses notifications dots it. While
 * Active now, the rings ripple when `pulseKey` (the data refresh time) changes.
 * `animate` is false until the data behind `availability` has loaded: the badge is
 * then a gray placeholder, and after 200 ms gray arcs that keep turning, until the
 * data arrives and the rings settle into the real state (a quick answer just fades).
 * Colors, the 2 px cut-out and the motion come from `--presence-*` rules (globals.css).
 */
export function PresenceBadge({
  availability,
  size = 14,
  label,
  className,
  style,
  testId,
  statusEmoji,
  statusSize,
  statusTimer,
  statusPaused,
  animate = true,
  pulseKey,
}: {
  availability: Availability;
  size?: number;
  label?: string;
  className?: string;
  style?: React.CSSProperties;
  testId?: string;
  statusEmoji?: string | null;
  /** The badge size to grow to when a status emoji shows (never smaller than `size`). */
  statusSize?: number;
  statusTimer?: { setAt: string; expiresAt: string } | null;
  statusPaused?: boolean;
  animate?: boolean;
  pulseKey?: number;
}) {
  const rootRef = useRef<HTMLSpanElement>(null);

  const [gaveUp, setGaveUp] = useState(false);
  const busy = !animate && !gaveUp;
  const [phase, setPhase] = useState<Phase>(busy ? "wait" : "rest");
  const phaseRef = useRef(phase);
  const go = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);
  const [settleHalf, setSettleHalf] = useState(false);
  const [loadHalo, setLoadHalo] = useState(false);
  const availabilityRef = useRef(availability);
  useEffect(() => {
    availabilityRef.current = availability;
  }, [availability]);
  const [onScreen, setOnScreen] = useState(true);
  const shownAt = useRef<number | null>(null);
  const pins = useRef<number[]>([]);
  const spinRefs = useRef<(SVGGElement | null)[]>([]);
  const visible = useVisible(rootRef, useCallback((now: boolean) => {
    if (phaseRef.current === "wait" || phaseRef.current === "load") setOnScreen(now);
  }, []));

  useEffect(() => {
    const current = phaseRef.current;
    if (current !== "wait" && current !== "load") return;
    if (busy) {
      const show = setTimeout(() => {
        if (phaseRef.current !== "wait") return;
        shownAt.current = performance.now();
        go("load");
      }, LOADING_SHOW_AFTER_MS);
      const giveUp = setTimeout(() => setGaveUp(true), LOADING_GIVE_UP_MS);
      return () => {
        clearTimeout(show);
        clearTimeout(giveUp);
      };
    }
    const plan = loadingSettlePlan(current === "load" ? shownAt.current : null, performance.now());
    const timers: ReturnType<typeof setTimeout>[] = [];
    if (plan.mode === "fade") {
      timers.push(setTimeout(() => {
        go("fade");
        timers.push(setTimeout(() => go("rest"), FADE_MS));
      }, 0));
    } else {
      timers.push(setTimeout(() => {
        pins.current = spinRefs.current.map((element) => (element ? currentAngle(element) : 0));
        go("settle");
        timers.push(
          setTimeout(() => setSettleHalf(true), EMOJI_AFTER_MS),
          setTimeout(() => { if (availabilityRef.current === "now") setLoadHalo(true); }, SETTLE_MS * 0.8),
          setTimeout(() => go("rest"), SETTLE_MS),
        );
      }, plan.delay));
    }
    return () => timers.forEach(clearTimeout);
  }, [busy, go]);

  // Settling: pin each ring at the angle it was turning at, then ease it to the nearest rest angle in its own direction.
  useLayoutEffect(() => {
    if (phase !== "settle") return;
    const elements = spinRefs.current;
    elements.forEach((element, index) => {
      if (!element) return;
      element.style.transition = "none";
      element.style.transform = `rotate(${pins.current[index] ?? 0}deg)`;
    });
    const frame = requestAnimationFrame(() => requestAnimationFrame(() => {
      elements.forEach((element, index) => {
        if (!element) return;
        const angle = pins.current[index] ?? 0;
        const turned = ((angle % 360) + 360) % 360;
        const target = index % 2 ? angle - turned : angle + (turned === 0 ? 0 : 360 - turned);
        element.style.transition = `transform ${SETTLE_MS}ms cubic-bezier(.2,.7,.2,1)`;
        element.style.transform = `rotate(${target}deg)`;
      });
    }));
    return () => cancelAnimationFrame(frame);
  }, [phase]);
  useEffect(() => {
    if (phase !== "rest") return;
    spinRefs.current.forEach((element) => {
      if (!element) return;
      element.style.transition = "";
      element.style.transform = "";
    });
  }, [phase]);

  const [spin, setSpin] = useState(() => initialBadgeSpin(availability, animate));
  const spinRef = useRef(spin);
  useEffect(() => {
    const prev = spinRef.current;
    if (prev.availability === availability && prev.armed === animate) return;
    const wants = prev.availability !== availability && prev.armed && animate;
    const full = wants && visible.current && !reducedMotion() && motionBudget.take();
    const next = advanceBadgeSpin(prev, availability, animate, full);
    spinRef.current = next;
    setSpin(next);
  }, [availability, animate, visible]);

  const px = statusBadgeSize(size, statusSize, statusEmoji);
  const statusReady = phase === "rest" || phase === "fade" || (phase === "settle" && settleHalf);
  const open = showStatusEmoji(statusEmoji, px) && statusReady;
  const emoji = useLingering(open ? statusEmoji ?? null : null);

  const [ripple, setRipple] = useState(0);
  const lastPulse = useRef(pulseKey);
  useEffect(() => {
    const prev = lastPulse.current;
    lastPulse.current = pulseKey;
    if (!prev || !pulseKey || pulseKey === prev) return;
    if (availability === "now" && px >= 20 && visible.current && !reducedMotion() && motionBudget.take()) setRipple((count) => count + 1);
  }, [pulseKey, availability, px, visible]);

  const timed = open && Boolean(statusTimer);
  const now = useNow(timed);
  const fraction = timed && statusTimer ? statusTimerFraction(statusTimer.setAt, statusTimer.expiresAt, now) : null;
  const dotted = open && Boolean(statusPaused);
  const maskId = useId();
  const remaining = (fraction ?? 1) * 360;

  return (
    <span
      ref={rootRef}
      suppressHydrationWarning
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      title={label}
      data-testid={testId}
      data-availability={availability}
      data-from={spin.from}
      className={cn("nb-presence", className)}
      style={{ ...style, ...vars({ "--presence-weight": ringWeight(availability) }) }}
    >
      <span
        className="nb-presence-badge"
        data-phase={phase}
        data-paused={onScreen ? undefined : ""}
        data-cycle={parity(spin.cycle)}
        data-ripple={parity(ripple)}
        data-status={open ? "" : undefined}
        style={{ width: px, height: px }}
      >
        <svg aria-hidden="true" className="nb-presence-svg" viewBox="205 270 880 880" width="100%" height="100%" focusable="false">
          {dotted && fraction !== null ? (
            <mask id={maskId} maskUnits="userSpaceOnUse" x="205" y="270" width="880" height="880">
              <circle cx="645" cy="710" r={RINGS[3].rs} fill="none" stroke="#fff" strokeWidth={RINGS[3].w} pathLength={360} strokeDasharray={`${remaining} ${360 - remaining + 0.001}`} transform={`rotate(-90 ${CENTER})`} style={vars({ "--w": `${RINGS[3].w}px` })} />
            </mask>
          ) : null}
          {RINGS.map((ring, index) => {
            const outer = index === 3;
            const radius = open ? ring.rs : ring.r;
            return (
              <g
                key={ring.r}
                className="nb-presence-ring"
                data-reverse={index % 2 ? "" : undefined}
                mask={outer && dotted && fraction !== null ? `url(#${maskId})` : undefined}
                style={{ ...vars({ "--order": ringOrder(index, spin.dir), "--i": index }), transform: `rotate(${spin.angle}deg)` }}
              >
                <circle className="nb-presence-track" cx="645" cy="710" r={radius} fill="none" strokeWidth={ring.w} style={vars({ "--w": `${ring.w}px` })} />
                <g className="nb-presence-spin" ref={(element) => { spinRefs.current[index] = element; }}>
                {ring.arcs.map(([start, length], arc) => {
                  const draining = outer && !dotted && fraction !== null;
                  const hidden = outer && arc > 0 && (dotted || draining);
                  const dash = outer && dotted ? "0.1 11.9" : draining ? `${remaining} ${360 - remaining + 0.001}` : undefined;
                  return (
                    <circle
                      key={start}
                      className="nb-presence-arc"
                      cx="645"
                      cy="710"
                      r={radius}
                      fill="none"
                      strokeWidth={ring.w}
                      strokeLinecap="round"
                      pathLength={360}
                      transform={`rotate(${outer && (draining || dotted) ? -90 : start} ${CENTER})`}
                      style={{ ...vars({ "--w": `${ring.w}px`, "--arc-len": length, "--arc-gap": 360 - length }), strokeDasharray: dash, display: hidden ? "none" : undefined }}
                    />
                  );
                })}
                </g>
              </g>
            );
          })}
        </svg>
        {emoji.emoji ? (
          <span key={emoji.emoji} aria-hidden="true" className="nb-presence-emoji" data-leaving={emoji.leaving ? "" : undefined} style={{ fontSize: Math.round(px * 0.4) }}>{emoji.emoji}</span>
        ) : null}
        {spin.halo > 0 ? <span key={spin.halo} aria-hidden="true" className="nb-presence-halo" /> : null}
        {loadHalo ? <span aria-hidden="true" className="nb-presence-halo" data-load="" /> : null}
      </span>
    </span>
  );
}

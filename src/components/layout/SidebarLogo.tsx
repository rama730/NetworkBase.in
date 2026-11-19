"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef } from "react";
import { ROUTES } from "@/constants/routes";
import { useRealtime } from "@/components/providers/RealtimeProvider";
import { isReducedMotionEnabled } from "@/lib/theme/appearance";
import { LOGO_ANIMATIONS, pickLoadAnimation, type LogoAnimation } from "@/lib/ui/logo-animations";

// The sidebar logo plays like the home page wordmark (shell redesign): only the logo, under about a second, the orange
// square is the cursor and stays in front of the name (the brand lockup). Six animations take turns: load picks one once
// per visit (the first visit of the day retypes, otherwise never the same as last time), each click plays the next, and
// three moments get their own. Collapsed, the square alone hops, bounces or blinks. Reduced motion: nothing plays.
const DOT_FOR: Record<LogoAnimation, "hop" | "bounce" | "blink"> = { retype: "hop", hop: "hop", drop: "hop", wave: "bounce", terminal: "bounce", decode: "blink" };
const NAME = "NetworkBase";
const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789/<>-_=+*#";
const EASE = "cubic-bezier(.16,1,.3,1)";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function stored(key: string, value?: string) {
    try {
        if (value === undefined) return window.localStorage.getItem(key);
        window.localStorage.setItem(key, value);
    } catch { /* remembered for this visit only */ }
    return null;
}

export function SidebarLogo({ collapsed }: { collapsed: boolean }) {
    const dotRef = useRef<HTMLSpanElement>(null);
    const wordRef = useRef<HTMLSpanElement>(null);
    const termRef = useRef<HTMLSpanElement>(null);
    const playing = useRef(false);
    const next = useRef(0);
    const collapsedRef = useRef(collapsed);
    collapsedRef.current = collapsed;
    const { connectionHealth } = useRealtime();

    const reduced = () => isReducedMotionEnabled({ root: document.documentElement, matchMedia: window.matchMedia?.bind(window) });

    const play = useCallback(async (name: LogoAnimation) => {
        const dot = dotRef.current, word = wordRef.current, term = termRef.current;
        if (!dot || !word || !term || playing.current || reduced()) return;
        const letters = [...word.querySelectorAll<HTMLElement>("[data-ch]")];
        const run = (el: Element, frames: Keyframe[], options: KeyframeAnimationOptions) =>
            el.animate(frames, { fill: "forwards", easing: EASE, ...options }).finished.catch(() => undefined);
        const reset = () => {
            [dot, ...letters].forEach((el) => el.getAnimations().forEach((a) => a.cancel()));
            letters.forEach((l) => { l.textContent = l.dataset.ch ?? ""; l.style.transform = ""; });
            word.hidden = false; term.hidden = true;
        };
        playing.current = true;
        reset();
        // Distances from the square's home spot, measured before it moves.
        const home = dot.getBoundingClientRect().left;
        const xOf = (el: Element) => el.getBoundingClientRect().left - home;
        try {
            if (collapsedRef.current) {
                const small = DOT_FOR[name];
                if (small === "hop") await run(dot, [{ transform: "none" }, { transform: "translateY(-7px)" }, { transform: "none" }, { transform: "translateY(-2px)" }, { transform: "none" }], { duration: 520, easing: "ease-out" });
                else if (small === "bounce") await run(dot, [{ transform: "none" }, { transform: "scale(1.5)" }, { transform: "scale(.85)" }, { transform: "none" }], { duration: 420 });
                else await run(dot, [{ opacity: 1 }, { opacity: 0 }, { opacity: 1 }, { opacity: 0 }, { opacity: 1 }], { duration: 700, easing: "steps(1, end)" });
                return;
            }
            if (name === "retype") {
                // The square grows into a cursor, types the name out, hops back home and shrinks.
                await Promise.all(letters.map((l) => run(l, [{ opacity: 1 }, { opacity: 0, transform: "scale(.6)" }], { duration: 150 })));
                await run(dot, [{ transform: "none" }, { transform: "scale(1.1, 2.1)" }], { duration: 160 });
                let x = 0;
                for (const l of letters) {
                    void run(l, [{ opacity: 0, transform: "scale(.5)" }, { opacity: 1, transform: "none" }], { duration: 220 });
                    x = xOf(l) + l.offsetWidth + 2;
                    void run(dot, [{ transform: `translateX(${x}px) scale(1.1, 2.1)` }], { duration: 50 });
                    await sleep(48);
                }
                await sleep(120);
                await run(dot, [{ transform: `translateX(${x}px) scale(1.1, 2.1)` }, { transform: `translate(${x / 2}px, -14px) scale(1.1, 2.1)` }, { transform: "scale(1.1, 2.1)" }], { duration: 480 });
                await run(dot, [{ transform: "scale(1.1, 2.1)" }, { transform: "none" }], { duration: 220 });
            } else if (name === "decode") {
                // The letters scramble and settle left to right.
                const start = performance.now(), length = 620;
                await new Promise<void>((done) => {
                    const tick = () => {
                        const p = (performance.now() - start) / length;
                        letters.forEach((l, i) => { l.textContent = p >= (i + 1) / letters.length ? l.dataset.ch ?? "" : GLYPHS[Math.floor(Math.random() * GLYPHS.length)]!; });
                        if (p < 1) setTimeout(tick, 34); else done();
                    };
                    tick();
                });
            } else if (name === "wave") {
                // A ripple lifts each letter in turn; the square bounces at the end.
                letters.forEach((l, i) => void run(l, [{ transform: "none" }, { transform: "translateY(-3px)" }, { transform: "none" }], { duration: 360, delay: i * 45, easing: "ease-in-out" }));
                await sleep(letters.length * 45 + 200);
                await run(dot, [{ transform: "none" }, { transform: "translateY(-5px)" }, { transform: "none" }, { transform: "translateY(-2px)" }, { transform: "none" }], { duration: 420, easing: "ease-out" });
            } else if (name === "hop") {
                // The square bounces over the letters like a ball (each squashes as it lands), then jumps home.
                const xs = letters.map((l) => xOf(l) + l.offsetWidth / 2 - dot.offsetWidth / 2);
                const span = xs.length + 1.6;
                const frames: Keyframe[] = [{ transform: "none", offset: 0 }];
                xs.forEach((x, i) => {
                    const at = (i + 1) / span, from = i ? xs[i - 1]! : 0;
                    frames.push({ transform: `translate(${(x + from) / 2}px, -9px)`, offset: at - 0.5 / span }, { transform: `translate(${x}px, -1px)`, offset: at });
                });
                frames.push({ transform: `translate(${xs[xs.length - 1]! / 2}px, -18px)`, offset: 0.93 }, { transform: "none", offset: 1 });
                letters.forEach((l, i) => void run(l, [{ transform: "none" }, { transform: "scale(1, .82)" }, { transform: "none" }], { duration: 160, delay: 1100 * ((i + 1) / span) - 40 }));
                await run(dot, frames, { duration: 1100, easing: "linear" });
            } else if (name === "drop") {
                // The letters fall from just above and land with a tiny bounce; the square lands last.
                letters.forEach((l, i) => void run(l, [{ opacity: 0, transform: "translateY(-14px)" }, { opacity: 1, transform: "none" }], { duration: 420, delay: i * 40, easing: "cubic-bezier(.34,1.56,.64,1)" }));
                await sleep(letters.length * 40 + 120);
                await run(dot, [{ opacity: 0, transform: "translateY(-16px)" }, { opacity: 1, transform: "none" }], { duration: 420, easing: "cubic-bezier(.34,1.56,.64,1)" });
            } else {
                // The name collapses to the CLI's mono `nb` with a blinking caret, then expands back.
                await Promise.all(letters.map((l, i) => run(l, [{ opacity: 1 }, { opacity: 0, transform: "translateX(-4px)" }], { duration: 160, delay: (letters.length - i) * 12 })));
                word.hidden = true; term.hidden = false;
                await sleep(820);
                term.hidden = true; word.hidden = false;
                letters.forEach((l, i) => void run(l, [{ opacity: 0, transform: "translateX(-4px)" }, { opacity: 1, transform: "none" }], { duration: 220, delay: i * 22 }));
                await sleep(letters.length * 22 + 220);
            }
        } finally {
            reset();
            playing.current = false;
        }
    }, []);

    // Load: once per visit (a client navigation keeps the sidebar, so this runs on a full load only).
    useEffect(() => {
        // A click plays the one after the last played, across reloads too.
        const last = stored("nb:logo-last");
        next.current = (LOGO_ANIMATIONS.indexOf(last as LogoAnimation) + 1) % LOGO_ANIMATIONS.length;
        let first = false;
        try { first = !window.sessionStorage.getItem("nb:logo-played"); window.sessionStorage.setItem("nb:logo-played", "1"); } catch { first = true; }
        if (!first) return;
        const today = new Date().toISOString().slice(0, 10);
        const name = pickLoadAnimation(today, stored("nb:logo-day"), stored("nb:logo-last"));
        stored("nb:logo-day", today);
        stored("nb:logo-last", name);
        next.current = (LOGO_ANIMATIONS.indexOf(name) + 1) % LOGO_ANIMATIONS.length;
        const timer = setTimeout(() => void play(name), 250);
        return () => clearTimeout(timer);
    }, [play]);

    // Moment: the welcome flight has landed (the page is revealed) → Drop-in.
    useEffect(() => {
        const root = document.documentElement;
        let was = root.dataset.welcomeFlight;
        const observer = new MutationObserver(() => {
            const now = root.dataset.welcomeFlight;
            if (was && !now) setTimeout(() => void play("drop"), 200);
            was = now;
        });
        observer.observe(root, { attributes: true, attributeFilter: ["data-welcome-flight"] });
        return () => observer.disconnect();
    }, [play]);

    // Moment: live updates come back after being offline or reconnecting → Decode.
    const lastHealth = useRef(connectionHealth);
    useEffect(() => {
        if (connectionHealth === "healthy" && lastHealth.current !== "healthy") void play("decode");
        lastHealth.current = connectionHealth;
    }, [connectionHealth, play]);

    // Hover: the home page's lean, scaled down: a pixel or two of lift and a slight tilt near the pointer.
    const lean = (event: React.PointerEvent) => {
        if (playing.current || collapsedRef.current || event.pointerType !== "mouse" || reduced()) return;
        for (const l of wordRef.current?.querySelectorAll<HTMLElement>("[data-ch]") ?? []) {
            const r = l.getBoundingClientRect(), d = event.clientX - (r.left + r.width / 2), near = Math.max(0, 1 - Math.abs(d) / 60);
            l.style.transform = near ? `translateY(${(-near * 2).toFixed(1)}px) rotate(${(-Math.sign(d) * near * 6).toFixed(1)}deg)` : "";
        }
    };
    const unlean = () => wordRef.current?.querySelectorAll<HTMLElement>("[data-ch]").forEach((l) => { l.style.transform = ""; });

    return (
        <Link
            href={ROUTES.DISCOVER}
            className="nb-sidebar-logo"
            aria-label="NetworkBase home"
            onPointerMove={lean}
            onPointerLeave={unlean}
            // Collapsed: hovering the square gives it a small hop.
            onPointerEnter={() => { if (collapsedRef.current) void play("hop"); }}
            // A click still goes to Discover, and plays the next animation in turn.
            onClick={() => {
                const name = LOGO_ANIMATIONS[next.current]!;
                next.current = (next.current + 1) % LOGO_ANIMATIONS.length;
                stored("nb:logo-last", name);
                void play(name);
            }}
        >
            <span className="nb-sidebar-logo-dot" ref={dotRef} aria-hidden="true" />
            <span className="nb-sidebar-logo-word" ref={wordRef} aria-hidden="true">
                {[...NAME].map((ch, i) => <span key={i} data-ch={ch}>{ch}</span>)}
            </span>
            <span className="nb-sidebar-logo-term" ref={termRef} aria-hidden="true" hidden>nb<i /></span>
        </Link>
    );
}

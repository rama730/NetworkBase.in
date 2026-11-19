/** The sidebar logo's six animations (shell redesign), in the order a click steps through them. */
export const LOGO_ANIMATIONS = ["retype", "decode", "wave", "hop", "drop", "terminal"] as const;
export type LogoAnimation = (typeof LOGO_ANIMATIONS)[number];

/** Which animation the load plays: the first visit of the day retypes; otherwise any but the last one. */
export function pickLoadAnimation(today: string, lastDay: string | null, last: string | null, random = Math.random()): LogoAnimation {
    if (lastDay !== today) return "retype";
    const pool = LOGO_ANIMATIONS.filter((name) => name !== last);
    return pool[Math.min(pool.length - 1, Math.floor(random * pool.length))]!;
}

import { DEFAULT_AUTH_NEXT_PATH } from '@/lib/auth/redirects'

/**
 * The plan for the sign-in welcome flight: when it plays, which version, the words, the timings. Pure, so it can be
 * tested without a browser. The browser-only parts (marker storage, the pre-paint script text) sit at the bottom.
 *
 * Onboarding has its own flight (lib/onboarding/welcome-flight.ts); nothing here changes it.
 */

export const SIGNIN_FLIGHT_EVENT_TYPES = ['signin_flight_started', 'signin_flight_completed', 'signin_flight_skipped'] as const
export type SignInFlightEventType = (typeof SIGNIN_FLIGHT_EVENT_TYPES)[number]

export type SignInVersion = 'full' | 'light'

/** Set when a deliberate sign-in starts, in this tab only, and consumed once when the flight starts. */
export const SIGNIN_MARKER_KEY = 'nb:signin-flight'
/** When the flight last played on this device, to tell the first sign-in of the day from the rest. */
export const SIGNIN_PLAYED_KEY = 'nb:signin-flight-played'
/** Long enough for a Google consent screen or a code from the inbox; short enough that a forgotten marker dies. */
export const SIGNIN_MARKER_TTL_MS = 10 * 60_000

export type SignInMarker = { t: number; next: string }

export function parseSignInMarker(raw: string | null | undefined, now: number): SignInMarker | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as Partial<SignInMarker> | null
    if (!value || typeof value.t !== 'number' || typeof value.next !== 'string') return null
    // Only a path on this site: a marker is never a way to send someone elsewhere.
    if (!/^\/(?![/\\])/.test(value.next)) return null
    if (now - value.t > SIGNIN_MARKER_TTL_MS || value.t - now > 60_000) return null
    return { t: value.t, next: value.next }
  } catch {
    return null
  }
}

/** Pages a sign-in passes through on the way: the marker waits there. */
const INTERIM_PATH = /^\/(login|signup|forgot-password|reset-password|auth|legal|verify)(\/|$)/
const ONBOARDING_PATH = /^\/onboarding(\/|$)/

/**
 * What a page means for the marker: `wait` while the person is still on the way in, `drop` on onboarding (a new
 * person gets the onboarding flight instead), `play` anywhere else.
 */
export function markerPathAction(pathname: string): 'wait' | 'drop' | 'play' {
  if (INTERIM_PATH.test(pathname)) return 'wait'
  if (ONBOARDING_PATH.test(pathname)) return 'drop'
  return 'play'
}

function sameLocalDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

/**
 * The full version is the first sign-in of the day on a device, heading for the default landing page. Everything
 * else (a later sign-in that day, or someone going somewhere in particular) gets the light version.
 * ponytail: per device. Telling a long absence from a short one across devices needs the account's last-active time
 * read before the app's own heartbeat overwrites it; add it when that read exists.
 */
export function chooseSignInVersion(input: { playedAt: number | null; now: number; next: string }): SignInVersion {
  if (input.next !== DEFAULT_AUTH_NEXT_PATH) return 'light'
  if (input.playedAt === null || !Number.isFinite(input.playedAt)) return 'full'
  return sameLocalDay(new Date(input.playedAt), new Date(input.now)) ? 'light' : 'full'
}

export function firstNameOf(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? ''
}

/** Line 1 replaces "Your presence is activated"; line 2 replaces the onboarding welcome. No exclamation marks. */
export function signInLines(fullName: string): { first: string; second: string } {
  const name = firstNameOf(fullName)
  return { first: 'Welcome back', second: name ? `Good to see you again, ${name}` : 'Good to see you again' }
}

/** One spoken sentence for screen readers, so the two visual lines are not read twice. */
export function signInAnnouncement(fullName: string): string {
  const name = firstNameOf(fullName)
  return name ? `Welcome back, ${name}.` : 'Welcome back.'
}

export type SignInTimings = {
  /** The photo rises from the button to the middle (full version). */
  rise: number
  /** The photo fades in at the middle (after a page reload, or reduced motion). */
  fadeIn: number
  /** Line 1 shows this long (full version). The rings keep waking while line 2 shows. */
  presenceHold: number
  /** Line 2 shows this long (full version). */
  secondHold: number
  fly: number
  scrimIn: number
  scrimOut: number
  /** The sign-in page hands over to the destination this long after the flight starts. */
  navigateAt: number
  /** Light version: line 1 fades in after this, out after `captionOutAt`, both counted from the start of the move. */
  captionInAt: number
  captionOutAt: number
  /** Light version: the app starts to appear, and the curtain starts to lift (the page is clickable from then). */
  revealAt: number
  scrimOutAt: number
  /** The skip hint shows after this (full version only). */
  hintAfter: number
  /** How long the photo waits for the next page's first real content before landing anyway. */
  contentWait: number
  /** How long to wait for the next page's top bar before giving up on the landing. */
  slotWait: number
  /** How long the profile picture gets to load before the flight begins without it. */
  photoWait: number
  /** Nothing in the flight may outlast this, whatever happens. */
  max: number
}

/** Reduced motion keeps both lines readable in under a second, with crossfades instead of movement. */
export function signInTimings(version: SignInVersion, reduced: boolean): SignInTimings {
  const base = { slotWait: 4000, contentWait: 1500, photoWait: 800, max: 14000, hintAfter: 1200 }
  if (reduced) {
    return { ...base, rise: 0, fadeIn: 100, presenceHold: 250, secondHold: 300, fly: 260, scrimIn: 100, scrimOut: 200, navigateAt: 100, captionInAt: 0, captionOutAt: 0, revealAt: 0, scrimOutAt: 0, hintAfter: 0 }
  }
  if (version === 'light') {
    return { ...base, rise: 0, fadeIn: 250, presenceHold: 0, secondHold: 0, fly: 1300, scrimIn: 200, scrimOut: 300, navigateAt: 150, captionInAt: 150, captionOutAt: 900, revealAt: 400, scrimOutAt: 500, hintAfter: 0 }
  }
  return { ...base, rise: 650, fadeIn: 500, presenceHold: 1100, secondHold: 600, fly: 1000, scrimIn: 600, scrimOut: 600, navigateAt: 560, captionInAt: 0, captionOutAt: 0, revealAt: 0, scrimOutAt: 0 }
}

/** The second line one word at a time, each word's delay in ms; the name (the last word) arrives a beat after the rest. */
export function wordDelays(text: string): Array<{ word: string; delay: number }> {
  const words = text.split(' ')
  return words.map((word, index) => ({ word, delay: index * 60 + (index === words.length - 1 && words.length > 1 ? 140 : 0) }))
}

/** True when an image URL's decode may be waited for; data and blob URLs are already here. */
export function worthWaitingFor(avatarUrl: string | null | undefined): boolean {
  return Boolean(avatarUrl) && !/^(data|blob):/.test(avatarUrl as string)
}

/* ---- browser only -------------------------------------------------------------------------------------------- */

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function session(): Store | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null
  } catch {
    return null
  }
}

function local(): Store | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}

/** A deliberate sign-in has started in this tab. Storage can be blocked: then there is simply no animation. */
export function markSignIn(next: string, now: number = Date.now(), store: Store | null = session()): void {
  try {
    store?.setItem(SIGNIN_MARKER_KEY, JSON.stringify({ t: now, next } satisfies SignInMarker))
  } catch {
    // no animation, nothing else lost
  }
}

export function readSignInMarker(now: number = Date.now(), store: Store | null = session()): SignInMarker | null {
  try {
    return parseSignInMarker(store?.getItem(SIGNIN_MARKER_KEY), now)
  } catch {
    return null
  }
}

export function clearSignInMarker(store: Store | null = session()): void {
  try {
    store?.removeItem(SIGNIN_MARKER_KEY)
  } catch {
    // nothing to clear
  }
}

export function readSignInPlayedAt(store: Store | null = local()): number | null {
  try {
    const value = Number(store?.getItem(SIGNIN_PLAYED_KEY))
    return Number.isFinite(value) && value > 0 ? value : null
  } catch {
    return null
  }
}

export function writeSignInPlayedAt(now: number = Date.now(), store: Store | null = local()): void {
  try {
    store?.setItem(SIGNIN_PLAYED_KEY, String(now))
  } catch {
    // the next sign-in is simply treated as the first of the day
  }
}

/** The person's own switch (Settings, Appearance). Read from this device's copy, so it works before anything loads. */
export function welcomeAnimationOff(store: Store | null = local()): boolean {
  try {
    return store?.getItem('app-welcome-animation') === 'false'
  } catch {
    return false
  }
}

/**
 * Runs before the first paint. After a full page load (a two-step code, Google or GitHub) it covers the page in its
 * own background colour the moment a sign-in marker is found, so neither the sign-in page nor the app shows before
 * the flight takes over. The flight lifts it; if nothing ever does, it lifts itself.
 */
export function buildSignInCurtainScript(): string {
  return `(() => {
  try {
    var raw = sessionStorage.getItem(${JSON.stringify(SIGNIN_MARKER_KEY)});
    if (!raw) return;
    var marker = JSON.parse(raw);
    var now = Date.now();
    if (!marker || typeof marker.t !== "number" || now - marker.t > ${SIGNIN_MARKER_TTL_MS} || marker.t - now > 60000) return;
    if (${INTERIM_PATH}.test(location.pathname) || ${ONBOARDING_PATH}.test(location.pathname)) return;
    if (localStorage.getItem("app-welcome-animation") === "false") return;
    var root = document.documentElement;
    root.setAttribute("data-signin-curtain", "");
    setTimeout(function () { root.removeAttribute("data-signin-curtain"); }, 9000);
  } catch (_) {}
})();`
}

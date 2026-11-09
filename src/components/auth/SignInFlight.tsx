'use client'

import { createPortal } from 'react-dom'
import { useEffect, useSyncExternalStore } from 'react'
import { usePathname } from 'next/navigation'
import type { OnboardingVisibility } from '@/lib/onboarding/contracts'
import type { Box } from '@/lib/onboarding/welcome-flight'
import {
  chooseSignInVersion,
  clearSignInMarker,
  markerPathAction,
  readSignInMarker,
  readSignInPlayedAt,
  welcomeAnimationOff,
  writeSignInPlayedAt,
  type SignInVersion,
} from '@/lib/auth/signin-flight'

/**
 * The sign-in welcome flight: after a deliberate sign-in the photo travels to its place in the top bar, with two short
 * lines on the way. The host lives in the root layout (next to the onboarding flight, which it never touches), so it
 * survives the move from the sign-in page to the app. The overlay is loaded on demand.
 */

export type SignInIdentity = {
  userId: string
  fullName: string
  username: string
  avatarUrl: string
  visibility: OnboardingVisibility
  /** The status shown inside the badge, as the top bar shows it. */
  status: { emoji: string; pausesNotifications: boolean } | null
}

export type SignInFlightInput = SignInIdentity & {
  /** Where the person is heading. */
  next: string
  version: SignInVersion
  /** The sign-in button as it is on screen; null starts from the middle (after a page reload). */
  from: Box | null
  /** True when the sign-in page is still showing: the flight hands over to the next page itself. */
  navigate: boolean
}

type ActiveFlight = SignInFlightInput & { id: number }
type OverlayModule = typeof import('./SignInFlightOverlay')

let current: ActiveFlight | null = null
let nextId = 1
let overlay: OverlayModule | null = null
let hosts = 0
let arriving = false
const listeners = new Set<() => void>()

const emit = () => listeners.forEach((listener) => listener())
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Loads the overlay ahead of the sign-in, so it can paint in the same frame as the button turns to a check. */
export function preloadSignInFlight(): Promise<void> {
  return import('./SignInFlightOverlay').then((module) => {
    overlay = module
  }).catch(() => undefined)
}

export function releaseSignInCurtain() {
  if (typeof document !== 'undefined') document.documentElement.removeAttribute('data-signin-curtain')
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([promise, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))])
}

/**
 * Who just signed in: name, photo address, privacy and status, read while the button shows its check. Null when it
 * cannot be read in time; the caller then carries on without the flight.
 */
export async function prepareSignInFlight(): Promise<SignInIdentity | null> {
  try {
    // Loaded here, not at the top: this file is in every page's bundle, the browser client is not.
    const { createSupabaseBrowserClient } = await import('@/lib/supabase/client')
    const supabase = createSupabaseBrowserClient()
    const { data } = await supabase.auth.getSession()
    const user = data.session?.user
    if (!user) return null
    const [profile, presence, appearance] = await Promise.all([
      withTimeout(
        Promise.resolve(supabase.from('profiles').select('full_name, username, avatar_url, visibility').eq('id', user.id).single()),
        2500,
      ),
      withTimeout(import('@/app/actions/presence').then((module) => module.getMyPresenceSettings()).catch(() => null), 2500),
      // The person's own switch, from the account: this device may never have seen it (a first sign-in here).
      withTimeout(import('@/lib/theme/appearance-client').then((module) => module.readAppearanceSettings()).catch(() => null), 2500),
    ])
    if (appearance?.snapshot?.welcomeAnimation === false) return null
    const row = profile?.data
    if (!row) return null
    const status = presence && 'settings' in presence ? presence.settings.status : null
    const visibility: OnboardingVisibility = row.visibility === 'connections' || row.visibility === 'private' ? row.visibility : 'public'
    return {
      userId: user.id,
      fullName: row.full_name ?? '',
      username: row.username ?? '',
      avatarUrl: row.avatar_url ?? '',
      visibility,
      status: status?.emoji ? { emoji: status.emoji, pausesNotifications: Boolean(status.pausesNotifications) } : null,
    }
  } catch {
    return null
  }
}

/**
 * Starts the flight. False means it could not (not loaded yet, already running, no host): the caller then does what
 * it always did. Starting is what consumes the marker, so a flight never plays twice for one sign-in.
 */
export function startSignInFlight(input: SignInFlightInput): boolean {
  if (typeof window === 'undefined' || current || !overlay || hosts === 0) return false
  clearSignInMarker()
  writeSignInPlayedAt()
  current = { ...input, id: nextId++ }
  emit()
  return true
}

function finish() {
  current = null
  emit()
}

/**
 * A page has loaded: if this tab just signed in, play the flight. Pages that are still on the way in wait (the marker
 * stays), onboarding drops the marker (a new person gets the onboarding flight), everything else plays.
 */
async function arrive(pathname: string) {
  const marker = readSignInMarker()
  if (!marker) {
    if (!current) releaseSignInCurtain()
    return
  }
  const action = markerPathAction(pathname)
  if (action === 'wait') return
  // A hidden tab would run it unseen and replay it on return; the setting is the person's own.
  if (action === 'drop' || welcomeAnimationOff() || document.hidden) {
    clearSignInMarker()
    releaseSignInCurtain()
    return
  }
  if (current || arriving) return
  arriving = true
  try {
    const [identity] = await Promise.all([prepareSignInFlight(), preloadSignInFlight()])
    if (!identity || !readSignInMarker()) {
      clearSignInMarker()
      releaseSignInCurtain()
      return
    }
    const version = chooseSignInVersion({ playedAt: readSignInPlayedAt(), now: Date.now(), next: marker.next })
    if (!startSignInFlight({ ...identity, next: marker.next, version, from: null, navigate: false })) {
      clearSignInMarker()
      releaseSignInCurtain()
    }
  } finally {
    arriving = false
  }
}

export function SignInFlightHost() {
  const flight = useSyncExternalStore(subscribe, () => current, () => null)
  const pathname = usePathname()
  useEffect(() => {
    hosts += 1
    return () => {
      hosts -= 1
    }
  }, [])
  useEffect(() => {
    void arrive(pathname)
  }, [pathname])
  if (!flight || !overlay) return null
  const Overlay = overlay.default
  return createPortal(<Overlay key={flight.id} flight={flight} onDone={finish} />, document.body)
}

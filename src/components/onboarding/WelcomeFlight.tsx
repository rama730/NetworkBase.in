'use client'

import { createPortal } from 'react-dom'
import { useEffect, useSyncExternalStore } from 'react'
import type { OnboardingVisibility } from '@/lib/onboarding/contracts'
import type { Box } from '@/lib/onboarding/welcome-flight'

/**
 * The welcome flight: after the last onboarding step the photo steps forward, presence activates, the welcome line
 * shows, and the photo travels to its place in the top bar. The host lives in the root layout so it keeps running
 * while the app moves from the onboarding layout to the app layout underneath it. The overlay itself is loaded on
 * demand (the finish screen preloads it), so no other page pays for it.
 */

export type WelcomeFlightInput = {
  fullName: string
  username: string
  userId: string
  avatarUrl: string
  visibility: OnboardingVisibility
  /** Where the person is heading. The flight starts the navigation itself, so the page loads while it plays. */
  continuePath: string
  /** The photo as it is on screen now; null starts it from the middle. */
  from: Box | null
}

type ActiveFlight = WelcomeFlightInput & { id: number }
type OverlayModule = typeof import('./WelcomeFlightOverlay')

let current: ActiveFlight | null = null
let nextId = 1
let overlay: OverlayModule | null = null
let hosts = 0
const listeners = new Set<() => void>()

const emit = () => listeners.forEach((listener) => listener())
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Loads the overlay ahead of the click, so it can paint in the same frame as the button press. */
export function preloadWelcomeFlight(): Promise<void> {
  return import('./WelcomeFlightOverlay').then((module) => {
    overlay = module
  }).catch(() => undefined)
}

/**
 * Starts the flight. False means it could not (not loaded yet, already running, no host): the caller then does what
 * it always did and navigates straight away.
 */
export function startWelcomeFlight(input: WelcomeFlightInput): boolean {
  if (typeof window === 'undefined' || current || !overlay || hosts === 0) return false
  current = { ...input, id: nextId++ }
  emit()
  return true
}

function finish() {
  current = null
  emit()
}

export function WelcomeFlightHost() {
  const flight = useSyncExternalStore(subscribe, () => current, () => null)
  useEffect(() => {
    hosts += 1
    return () => {
      hosts -= 1
    }
  }, [])
  if (!flight || !overlay) return null
  const Overlay = overlay.default
  return createPortal(<Overlay key={flight.id} flight={flight} onDone={finish} />, document.body)
}

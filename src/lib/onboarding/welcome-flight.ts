import type { OnboardingVisibility } from '@/lib/onboarding/contracts'

/** The plan for the welcome flight: what shows, when, and where the photo goes. Pure, so it can be tested without a browser. */

export const WELCOME_FLIGHT_EVENT_TYPES = ['welcome_flight_started', 'welcome_flight_completed', 'welcome_flight_skipped'] as const
export type WelcomeFlightEventType = (typeof WELCOME_FLIGHT_EVENT_TYPES)[number]

export type Box = { left: number; top: number; width: number; height: number }

/** The phone breakpoint of the app shell: the top-bar avatar is hidden below it, so the photo goes to the menu button. */
export const WELCOME_FLIGHT_PHONE_MAX_WIDTH = 767

/** "Your presence is activated" is only said when it is true: a private profile is not shown to other people. */
export function announcesPresence(visibility: OnboardingVisibility): boolean {
  return visibility !== 'private'
}

export type FlightTimings = {
  /** The photo moves from the finish screen to the middle. */
  stepForward: number
  /** The badge gets this long to settle before the line changes. Without the presence step the welcome line takes this long instead, because it carries the privacy note. */
  presenceHold: number
  welcomeHold: number
  fly: number
  tooltip: number
  /** How long to wait for the top bar of the next page before giving up on the landing. */
  slotWait: number
  /** The badge starts to settle this long after it appears. */
  settleAfter: number
  /** Nothing in the flight may outlast this, whatever happens. */
  max: number
}

/** Reduced motion keeps the same story at half the length, with crossfades instead of movement. */
export function flightTimings(reduced: boolean): FlightTimings {
  const k = reduced ? 0.5 : 1
  return {
    stepForward: Math.round(850 * k),
    presenceHold: Math.round(1700 * k),
    welcomeHold: Math.round(800 * k),
    fly: Math.round(1000 * k),
    tooltip: 2400,
    slotWait: 4000,
    settleAfter: Math.round(250 * k),
    max: 14000,
  }
}

/** Where the photo rests while the lines are read: the middle, a little above centre, with room for the lines below. */
export function centerBox(viewport: { width: number; height: number }): { box: Box; captionTop: number; phone: boolean } {
  const phone = viewport.width <= WELCOME_FLIGHT_PHONE_MAX_WIDTH
  const size = phone ? 112 : 128
  const centreY = viewport.height * (phone ? 0.37 : 0.4075)
  const top = Math.round(centreY - size / 2)
  return {
    box: { left: Math.round((viewport.width - size) / 2), top, width: size, height: size },
    captionTop: top + size + (phone ? 30 : 56),
    phone,
  }
}

/** Initials scale with the tile: 14px at the top bar, 15px on the finish screen, a quarter of the size when large. */
export function avatarFontSize(size: number): number {
  if (size <= 32) return 14
  if (size <= 64) return 15
  return Math.round(size * 0.25)
}

/** The box the photo lands in: the avatar's own place on desktop, a small tile centred on the menu button on phones. */
export function landingBox(slot: Box, kind: 'avatar' | 'menu'): Box {
  if (kind === 'avatar') return slot
  const size = 28
  return { left: Math.round(slot.left + (slot.width - size) / 2), top: Math.round(slot.top + (slot.height - size) / 2), width: size, height: size }
}

'use client'

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { recordWelcomeFlight } from '@/app/actions/welcome-flight'
import { VISIBILITY_NOTE } from '@/components/onboarding/FinishScreen'
import type { WelcomeFlightInput } from '@/components/onboarding/WelcomeFlight'
import { PresenceBadge } from '@/components/presence/PresenceBadge'
import { UserAvatar } from '@/components/ui/UserAvatar'
import {
  announcesPresence,
  avatarFontSize,
  centerBox,
  flightTimings,
  landingBox,
  type Box,
  type WelcomeFlightEventType,
} from '@/lib/onboarding/welcome-flight'
import { isReducedMotionEnabled } from '@/lib/theme/appearance'
import { cn } from '@/lib/utils'

const EASE = 'cubic-bezier(.2,.8,.3,1)'
/** The vertical move eases in and out while the horizontal one eases out, so the photo travels on a curve. */
const EASE_VERTICAL = 'cubic-bezier(.5,0,.3,1)'
const px = (value: number) => `${value}px`
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const frames = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))

type Slot = { box: Box; kind: 'avatar' | 'menu' }

/** The top bar's avatar on desktop, or the menu button where the avatar is not shown (phones). Null until the page has them. */
function findSlot(): Slot | null {
  const read = (selector: string): Box | null => {
    const rect = document.querySelector(selector)?.getBoundingClientRect()
    return rect && rect.width > 0 && rect.height > 0 ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null
  }
  const avatar = read('[data-welcome-slot]')
  if (avatar) return { box: avatar, kind: 'avatar' }
  const menu = read('[data-welcome-slot-mobile]')
  return menu ? { box: menu, kind: 'menu' } : null
}

const CAPTION = 'text-2xl font-bold tracking-tight text-foreground sm:text-3xl'

export default function WelcomeFlightOverlay({ flight, onDone }: { flight: WelcomeFlightInput & { id: number }; onDone: () => void }) {
  const router = useRouter()
  const pathname = usePathname()
  const pathRef = useRef(pathname)
  useEffect(() => {
    pathRef.current = pathname
  }, [pathname])

  const avatarRef = useRef<HTMLDivElement>(null)
  const skip = useRef<() => void>(() => undefined)
  const pub = announcesPresence(flight.visibility)
  const [reduced] = useState(() => isReducedMotionEnabled({ root: document.documentElement, matchMedia: window.matchMedia?.bind(window) }))
  const [layout] = useState(() => centerBox({ width: window.innerWidth, height: window.innerHeight }))
  // The start never changes after the first render: React must not reset what the animation does to these styles.
  const [startStyle] = useState<CSSProperties>(() => {
    const from = flight.from ?? centerBox({ width: window.innerWidth, height: window.innerHeight }).box
    return { left: from.left, top: from.top, width: from.width, height: from.height, fontSize: avatarFontSize(from.width) }
  })
  const [scrim, setScrim] = useState(false)
  const [caption, setCaption] = useState<0 | 1 | 2>(0)
  const [badge, setBadge] = useState<{ animate: boolean; size: number; edge: number } | null>(null)
  const [announce, setAnnounce] = useState('')
  const [hint, setHint] = useState(false)
  const [ringed, setRinged] = useState(false)
  const [avatarGone, setAvatarGone] = useState(false)
  const [tip, setTip] = useState<CSSProperties | null>(null)
  // Skipped: the curtain lifts quickly instead of at its usual pace.
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    const root = document.documentElement
    const t = flightTimings(reduced)
    const startedAt = Date.now()
    let skipped = false
    let alive = true
    const waits = new Set<() => void>()
    const running = new Set<Animation>()

    /** A pause the person can cut short: Skip resolves every one of them at once. */
    const wait = (ms: number) =>
      new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(id)
          waits.delete(done)
          resolve()
        }
        const id = setTimeout(done, ms)
        waits.add(done)
      })

    skip.current = () => {
      if (skipped) return
      skipped = true
      setHint(false)
      setLeaving(true)
      waits.forEach((resume) => resume())
      running.forEach((animation) => {
        try {
          animation.finish()
        } catch {
          // already finished
        }
      })
    }

    const record = (event: WelcomeFlightEventType) => {
      void recordWelcomeFlight({ event, ms: Date.now() - startedAt, reduced, phone: layout.phone, presence: pub }).catch(() => undefined)
    }

    const place = (el: HTMLElement, box: Box) => {
      el.style.left = px(box.left)
      el.style.top = px(box.top)
      el.style.width = px(box.width)
      el.style.height = px(box.height)
      el.style.fontSize = px(avatarFontSize(box.width))
    }

    /** Moves the photo: a curved flight, or with reduced motion a quick fade out and in at the new place. */
    const moveTo = async (to: Box, ms: number) => {
      const el = avatarRef.current
      if (!el) return
      if (reduced) {
        const out = el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 110, fill: 'forwards' })
        running.add(out)
        await out.finished.catch(() => undefined)
        el.style.opacity = '0'
        out.cancel()
        place(el, to)
        const back = el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, fill: 'forwards' })
        running.add(back)
        await back.finished.catch(() => undefined)
        el.style.opacity = ''
        back.cancel()
        running.delete(out)
        running.delete(back)
        return
      }
      const rect = el.getBoundingClientRect()
      const horizontal = el.animate(
        [
          { left: px(rect.left), width: px(rect.width), height: px(rect.height), fontSize: px(avatarFontSize(rect.width)) },
          { left: px(to.left), width: px(to.width), height: px(to.height), fontSize: px(avatarFontSize(to.width)) },
        ],
        { duration: ms, easing: EASE, fill: 'forwards' },
      )
      const vertical = el.animate([{ top: px(rect.top) }, { top: px(to.top) }], { duration: ms, easing: EASE_VERTICAL, fill: 'forwards' })
      running.add(horizontal)
      running.add(vertical)
      await Promise.allSettled([horizontal.finished, vertical.finished])
      place(el, to)
      horizontal.cancel()
      vertical.cancel()
      running.delete(horizontal)
      running.delete(vertical)
    }

    /** The next page's top bar: found as soon as it exists, or null if the page has none (a join page) or never came. */
    const waitForSlot = async (): Promise<Slot | null> => {
      const until = Date.now() + t.slotWait
      let settledAt: number | null = null
      while (alive && Date.now() < until) {
        const slot = findSlot()
        if (slot) return slot
        if (!pathRef.current.startsWith('/onboarding')) settledAt ??= Date.now()
        // The page has arrived and has no top bar: nothing to land on.
        if (settledAt !== null && Date.now() - settledAt > 900) return null
        await sleep(50)
      }
      return null
    }

    const release = () => {
      delete root.dataset.welcomeFlight
    }

    const run = async () => {
      root.dataset.welcomeFlight = 'hold'
      // The overlay is on screen before anything moves: the finish screen's photo and the overlay's photo are the same pixels.
      await frames()
      if (!alive) return
      record('welcome_flight_started')
      setScrim(true)
      router.push(flight.continuePath)
      const hintTimer = setTimeout(() => alive && !skipped && setHint(true), 600)

      await moveTo(layout.box, t.stepForward)
      if (pub && !skipped) {
        setBadge({ animate: false, size: 26, edge: -3 })
        setCaption(1)
        setAnnounce('Your presence is activated')
        await wait(t.settleAfter)
        setBadge((current) => current && { ...current, animate: true })
        await wait(t.presenceHold - t.settleAfter)
      }
      if (!skipped) {
        setCaption(2)
        setAnnounce(pub ? `Welcome to NetworkBase, ${flight.fullName}!` : `Welcome to NetworkBase, ${flight.fullName}! ${VISIBILITY_NOTE.private}`)
        await wait(pub ? t.welcomeHold : t.presenceHold)
      }
      clearTimeout(hintTimer)
      setHint(false)

      if (skipped) {
        // Out of the way at once: the page underneath is already coming.
        setCaption(0)
        setAvatarGone(true)
      }
      const slot = await waitForSlot()
      if (!alive) return
      if (!slot) {
        // No top bar to land on. If the page never even moved, do what the finish screen used to do.
        if (pathRef.current.startsWith('/onboarding')) window.location.assign(flight.continuePath)
        setCaption(0)
        setScrim(false)
        record(skipped ? 'welcome_flight_skipped' : 'welcome_flight_completed')
        // Let the curtain finish lifting before the overlay goes.
        await sleep(reduced || skipped ? 260 : 650)
        release()
        onDone()
        return
      }

      const target = landingBox(slot.box, slot.kind)
      if (skipped) release()
      else root.dataset.welcomeFlight = 'reveal'
      setCaption(0)
      setScrim(false)
      // The top bar always shows your own badge, even when others cannot see it: the photo brings one, quietly, so nothing pops in at the handoff.
      if (slot.kind === 'menu') setBadge(null)
      else setBadge((current) => ({ animate: true, ...current, size: 16, edge: -2 }))
      if (!skipped) await moveTo(target, t.fly)
      const el = avatarRef.current
      if (el && !skipped) {
        if (slot.kind === 'avatar') setRinged(true)
        if (!reduced && slot.kind === 'avatar') {
          const pop = el.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.14)' }, { transform: 'scale(1)' }], { duration: 320, easing: 'ease-in-out' })
          running.add(pop)
          await pop.finished.catch(() => undefined)
          running.delete(pop)
        } else if (slot.kind === 'menu') {
          const tuck = el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: reduced ? 120 : 250, fill: 'forwards' })
          running.add(tuck)
          await tuck.finished.catch(() => undefined)
        }
      }
      // The real avatar takes over at exactly this place; the overlay's copy goes in the same frame.
      release()
      setAvatarGone(true)
      record(skipped ? 'welcome_flight_skipped' : 'welcome_flight_completed')
      if (pub && !skipped) {
        setTip(
          slot.kind === 'avatar'
            ? { top: slot.box.top + slot.box.height + 10, right: Math.max(8, window.innerWidth - (slot.box.left + slot.box.width) - 4) }
            : { top: slot.box.top + slot.box.height + 4, left: Math.max(8, slot.box.left) },
        )
        await wait(t.tooltip)
        setTip(null)
      }
      await sleep(skipped ? 260 : 150)
      onDone()
    }

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || event.key === 'Enter') skip.current()
    }
    window.addEventListener('keydown', onKey)
    const watchdog = setTimeout(() => {
      // Whatever went wrong, the person is never left behind a curtain.
      release()
      if (alive && pathRef.current.startsWith('/onboarding')) window.location.assign(flight.continuePath)
      onDone()
    }, t.max)
    void run().catch(() => {
      release()
      onDone()
    })

    return () => {
      alive = false
      clearTimeout(watchdog)
      window.removeEventListener('keydown', onKey)
      waits.forEach((resume) => resume())
      running.forEach((animation) => animation.cancel())
      release()
    }
    // The flight is planned once, from what was true when the button was pressed.
  }, [])

  return (
    <div data-welcome-flight className="fixed inset-0 z-[1000] cursor-default" onClick={() => skip.current()}>
      <div
        className={cn('absolute inset-0 bg-background transition-opacity', scrim ? 'opacity-100' : 'opacity-0')}
        style={{ transitionDuration: reduced || leaving ? '200ms' : '600ms', transitionTimingFunction: EASE }}
      />
      <div role="status" aria-live="polite" className="sr-only">
        {announce}
      </div>
      <div className="absolute inset-x-0" style={{ top: layout.captionTop }}>
        <p
          data-welcome-caption="presence"
          aria-hidden="true"
          className={cn(CAPTION, 'absolute inset-x-4 text-center transition-opacity', caption === 1 ? 'opacity-100 duration-300' : 'opacity-0 duration-150')}
        >
          Your presence is activated
        </p>
        <div
          data-welcome-caption="welcome"
          aria-hidden="true"
          className={cn('absolute inset-x-4 text-center transition-opacity', caption === 2 ? 'opacity-100 delay-150 duration-300' : 'opacity-0 duration-150')}
        >
          <p className={CAPTION}>Welcome to NetworkBase, {flight.fullName}!</p>
          {pub ? null : <p className="mx-auto mt-2.5 max-w-[32.5rem] text-[15px] leading-[22px] text-muted-foreground">{VISIBILITY_NOTE.private}</p>}
        </div>
      </div>
      <p className={cn('absolute inset-x-0 bottom-5 text-center text-xs text-muted-foreground transition-opacity duration-[400ms]', hint ? 'opacity-100' : 'opacity-0')}>
        Click or press Esc to skip
      </p>
      {tip ? (
        <div role="status" className="fixed z-[1001] whitespace-nowrap rounded-md bg-foreground px-2.5 py-1.5 text-xs leading-4 text-background" style={tip}>
          You’re active now
        </div>
      ) : null}
      {avatarGone ? null : (
        <div
          ref={avatarRef}
          data-welcome-avatar
          className={cn('fixed rounded-md transition-shadow duration-500', ringed && 'ring-2 ring-white dark:ring-zinc-950')}
          style={startStyle}
        >
          <UserAvatar
            identity={{ id: flight.userId, fullName: flight.fullName, username: flight.username, avatarUrl: flight.avatarUrl }}
            style={{ width: '100%', height: '100%' }}
            roundedClassName="rounded-[inherit]"
            sizes="128px"
            priority
          />
          {badge ? (
            <PresenceBadge
              availability="now"
              size={badge.size}
              animate={badge.animate}
              className="absolute"
              style={{ right: badge.edge, bottom: badge.edge }}
            />
          ) : null}
        </div>
      )}
    </div>
  )
}

'use client'

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { recordSignInFlight } from '@/app/actions/signin-flight'
import { releaseSignInCurtain, type SignInFlightInput } from '@/components/auth/SignInFlight'
import { PresenceBadge } from '@/components/presence/PresenceBadge'
import { UserAvatar } from '@/components/ui/UserAvatar'
import {
  markerPathAction,
  signInAnnouncement,
  signInLines,
  signInTimings,
  worthWaitingFor,
  type SignInFlightEventType,
} from '@/lib/auth/signin-flight'
import { announcesPresence, avatarFontSize, centerBox, landingBox, type Box } from '@/lib/onboarding/welcome-flight'
import { isReducedMotionEnabled } from '@/lib/theme/appearance'
import { cn } from '@/lib/utils'

const EASE = 'cubic-bezier(.2,.8,.3,1)'
/** The vertical move eases in and out while the horizontal one eases out, so the photo travels on a curve. */
const EASE_VERTICAL = 'cubic-bezier(.5,0,.3,1)'
const px = (value: number) => `${value}px`
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const frames = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))

type Slot = { box: Box; kind: 'avatar' | 'menu' }

/**
 * The top bar's avatar on desktop, or the menu button where the avatar is not shown (phones). Null until the page has
 * them. The header rises a few pixels as it appears: the box is read as if that had finished, so the photo aims at
 * the place it will be, not the place it passes through.
 * ponytail: the onboarding overlay keeps its own copy of this so it stays untouched.
 */
function findSlot(): Slot | null {
  const read = (selector: string): Box | null => {
    const element = document.querySelector<HTMLElement>(selector)
    const rect = element?.getBoundingClientRect()
    if (!element || !rect || rect.width <= 0 || rect.height <= 0) return null
    const header = element.closest('header')
    const rise = header ? new DOMMatrix(getComputedStyle(header).transform) : null
    return { left: rect.left - (rise?.e ?? 0), top: rect.top - (rise?.f ?? 0), width: rect.width, height: rect.height }
  }
  const avatar = read('[data-welcome-slot]')
  if (avatar) return { box: avatar, kind: 'avatar' }
  const menu = read('[data-welcome-slot-mobile]')
  return menu ? { box: menu, kind: 'menu' } : null
}

/** The next page has something real on it, not only placeholders. */
const contentReady = () => Boolean(document.querySelector('main')) && !document.querySelector('main .nb-skeleton')

const CAPTION = 'text-2xl font-bold tracking-tight text-foreground text-balance [overflow-wrap:anywhere] sm:text-3xl'

type BadgeState = { key: number; availability: 'offline' | 'now'; animate: boolean; size: number; edge: number }

export default function SignInFlightOverlay({ flight, onDone }: { flight: SignInFlightInput & { id: number }; onDone: () => void }) {
  const router = useRouter()
  const pathname = usePathname()
  const pathRef = useRef(pathname)
  useEffect(() => {
    pathRef.current = pathname
  }, [pathname])

  const avatarRef = useRef<HTMLDivElement>(null)
  const skip = useRef<() => void>(() => undefined)
  const pub = announcesPresence(flight.visibility)
  const lines = signInLines(flight.fullName)
  const [reduced] = useState(() => isReducedMotionEnabled({ root: document.documentElement, matchMedia: window.matchMedia?.bind(window) }))
  const light = flight.version === 'light' && !reduced
  const fromButton = flight.from !== null
  const [layout, setLayout] = useState(() => centerBox({ width: window.innerWidth, height: window.innerHeight }))
  // The start never changes after the first render: React must not reset what the animation does to these styles.
  const [startStyle] = useState<CSSProperties>(() => {
    const from = flight.from ?? centerBox({ width: window.innerWidth, height: window.innerHeight }).box
    return { left: from.left, top: from.top, width: from.width, height: from.height, fontSize: avatarFontSize(from.width), opacity: 0 }
  })
  // After a page reload the curtain is already up: the scrim starts opaque, so nothing shows when the curtain lifts.
  const [scrim, setScrim] = useState(!fromButton)
  const [instant, setInstant] = useState(!fromButton)
  const [caption, setCaption] = useState<0 | 1 | 2>(0)
  const [badge, setBadge] = useState<BadgeState | null>(null)
  const [announce, setAnnounce] = useState('')
  const [hint, setHint] = useState(false)
  const [ringed, setRinged] = useState(false)
  const [avatarGone, setAvatarGone] = useState(false)
  const [photoReady, setPhotoReady] = useState(!worthWaitingFor(flight.avatarUrl))
  // Skipped: the curtain lifts quickly instead of at its usual pace.
  const [leaving, setLeaving] = useState(false)
  // From here the page underneath takes clicks again (light version).
  const [clickable, setClickable] = useState(false)

  useEffect(() => {
    const root = document.documentElement
    const t = signInTimings(flight.version, reduced)
    const startedAt = Date.now()
    let skipped = false
    let alive = true
    let hintTimer: ReturnType<typeof setTimeout> | undefined
    let centre = layout
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

    const track = (animation: Animation) => {
      running.add(animation)
      return animation
    }

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

    const record = (event: SignInFlightEventType) => {
      void recordSignInFlight({
        event,
        ms: Date.now() - startedAt,
        reduced,
        phone: centre.phone,
        version: flight.version,
        from: fromButton ? 'button' : 'center',
      }).catch(() => undefined)
    }

    const place = (el: HTMLElement, box: Box) => {
      el.style.left = px(box.left)
      el.style.top = px(box.top)
      el.style.width = px(box.width)
      el.style.height = px(box.height)
      el.style.fontSize = px(avatarFontSize(box.width))
    }

    /** The photo arrives: it fades in where it is (a little larger to start, unless motion is reduced). */
    const appear = async (ms: number) => {
      const el = avatarRef.current
      if (!el) return
      const grow = reduced || fromButton ? 'none' : 'scale(.92)'
      const animation = track(el.animate([{ opacity: 0, transform: grow }, { opacity: 1, transform: 'none' }], { duration: ms, easing: 'ease-out', fill: 'forwards' }))
      await animation.finished.catch(() => undefined)
      el.style.opacity = '1'
      animation.cancel()
      running.delete(animation)
    }

    /** Moves the photo: a curved flight, or with reduced motion a quick fade out and in at the new place. */
    const moveTo = async (to: Box, ms: number) => {
      const el = avatarRef.current
      if (!el) return
      if (reduced || ms === 0) {
        place(el, to)
        return
      }
      const rect = el.getBoundingClientRect()
      const horizontal = track(el.animate(
        [
          { left: px(rect.left), width: px(rect.width), height: px(rect.height), fontSize: px(avatarFontSize(rect.width)) },
          { left: px(to.left), width: px(to.width), height: px(to.height), fontSize: px(avatarFontSize(to.width)) },
        ],
        { duration: ms, easing: EASE, fill: 'forwards' },
      ))
      const vertical = track(el.animate([{ top: px(rect.top) }, { top: px(to.top) }], { duration: ms, easing: EASE_VERTICAL, fill: 'forwards' }))
      await Promise.allSettled([horizontal.finished, vertical.finished])
      place(el, to)
      horizontal.cancel()
      vertical.cancel()
      running.delete(horizontal)
      running.delete(vertical)
    }

    /**
     * The last leg, to the top bar's avatar. The landing place is read again while it flies: if the page moves it (a
     * window resize, a collapsing sidebar) the photo heads for the new place and still lands exactly on it.
     */
    const glide = (initial: Box, ms: number, read: () => Box | null) =>
      new Promise<Box>((resolve) => {
        const el = avatarRef.current
        if (!el) {
          resolve(initial)
          return
        }
        if (reduced) {
          // A quick crossfade at the new place.
          void (async () => {
            const out = track(el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: Math.round(ms * 0.42), fill: 'forwards' }))
            await out.finished.catch(() => undefined)
            el.style.opacity = '0'
            out.cancel()
            place(el, initial)
            const back = track(el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: Math.round(ms * 0.58), fill: 'forwards' }))
            await back.finished.catch(() => undefined)
            el.style.opacity = '1'
            back.cancel()
            running.delete(out)
            running.delete(back)
            resolve(initial)
          })()
          return
        }
        let target = initial
        let finished = false
        let current: Animation[] = []
        const startedGlide = performance.now()
        const go = (to: Box, duration: number) => {
          const rect = el.getBoundingClientRect()
          current.forEach((animation) => {
            running.delete(animation)
            animation.cancel()
          })
          place(el, rect)
          const horizontal = track(el.animate(
            [
              { left: px(rect.left), width: px(rect.width), height: px(rect.height), fontSize: px(avatarFontSize(rect.width)) },
              { left: px(to.left), width: px(to.width), height: px(to.height), fontSize: px(avatarFontSize(to.width)) },
            ],
            { duration, easing: EASE, fill: 'forwards' },
          ))
          const vertical = track(el.animate([{ top: px(rect.top) }, { top: px(to.top) }], { duration, easing: EASE_VERTICAL, fill: 'forwards' }))
          current = [horizontal, vertical]
          void Promise.allSettled([horizontal.finished, vertical.finished]).then(() => {
            if (current[0] === horizontal) done()
          })
        }
        const done = () => {
          if (finished) return
          finished = true
          clearInterval(watch)
          place(el, target)
          current.forEach((animation) => {
            running.delete(animation)
            animation.cancel()
          })
          resolve(target)
        }
        const watch = setInterval(() => {
          if (finished || skipped) return
          const next = read()
          if (!next) return
          const moved = Math.abs(next.left - target.left) > 3 || Math.abs(next.top - target.top) > 3 || Math.abs(next.width - target.width) > 2
          if (!moved) return
          target = next
          go(target, Math.max(220, ms - (performance.now() - startedGlide)))
        }, 60)
        go(target, ms)
      })

    /** The next page's top bar: found as soon as it exists, or null if the page has none (a join page) or never came. */
    const waitForSlot = async (): Promise<Slot | null> => {
      const until = Date.now() + t.slotWait
      let settledAt: number | null = null
      while (alive && Date.now() < until) {
        const slot = findSlot()
        if (slot) return slot
        if (markerPathAction(pathRef.current) === 'play') settledAt ??= Date.now()
        // The page has arrived and has no top bar: nothing to land on.
        if (settledAt !== null && Date.now() - settledAt > 900) return null
        await sleep(50)
      }
      return null
    }

    const waitForContent = async (cap: number) => {
      const until = Date.now() + cap
      while (alive && !skipped && Date.now() < until && !contentReady()) await sleep(50)
    }

    /** The profile picture gets a moment to arrive, so it is in place before anything flies. */
    const waitForPhoto = async () => {
      if (!worthWaitingFor(flight.avatarUrl)) return
      const until = Date.now() + t.photoWait
      while (alive && !skipped && Date.now() < until) {
        const image = avatarRef.current?.querySelector('img')
        if (image?.complete && image.naturalWidth > 0) {
          await image.decode().catch(() => undefined)
          break
        }
        await sleep(40)
      }
      setPhotoReady(true)
    }

    /** The keyboard of a password sign-in may still be closing: measure the screen once it has stopped changing. */
    const settleViewport = async () => {
      const active = document.activeElement
      const typing = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement
      ;(active as HTMLElement | null)?.blur?.()
      const read = () => ({ width: window.innerWidth, height: window.visualViewport?.height ?? window.innerHeight })
      let last = read()
      if (!typing) return last
      let steadySince = Date.now()
      const until = Date.now() + 400
      while (alive && Date.now() < until && Date.now() - steadySince < 120) {
        await sleep(30)
        const now = read()
        if (now.width !== last.width || Math.abs(now.height - last.height) > 1) {
          last = now
          steadySince = Date.now()
        }
      }
      return last
    }

    /** The sign-in column softens and shrinks away while the photo leaves the button. */
    const shrinkSignIn = (ms: number) => {
      if (reduced) return
      const column = document.querySelector<HTMLElement>('.nb-auth-column')
      if (!column) return
      track(column.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(.94)' }], { duration: ms, easing: 'ease', fill: 'forwards' }))
    }

    const release = () => {
      delete root.dataset.welcomeFlight
      delete root.dataset.signinFlight
      releaseSignInCurtain()
    }

    const focusMain = () => {
      const main = document.querySelector<HTMLElement>('main')
      const active = document.activeElement
      if (!main || (active && active !== document.body)) return
      main.setAttribute('tabindex', '-1')
      main.style.outline = 'none'
      main.focus({ preventScroll: true })
    }

    const run = async () => {
      root.dataset.welcomeFlight = 'hold'
      root.dataset.signinFlight = ''
      // The overlay is on screen before anything moves.
      await frames()
      if (!alive) return
      record('signin_flight_started')
      if (fromButton) setScrim(true)
      // The scrim is opaque (at once after a reload), so the curtain can lift without showing anything.
      if (!fromButton) releaseSignInCurtain()
      setAnnounce(signInAnnouncement(flight.fullName))
      if (document.hidden) skip.current()
      if (flight.navigate) void wait(t.navigateAt).then(() => alive && router.replace(flight.next))

      const viewport = await settleViewport()
      centre = centerBox(viewport)
      setLayout(centre)
      await waitForPhoto()
      if (!alive) return
      if (fromButton && !skipped) shrinkSignIn(light ? 400 : 500)

      // The photo arrives, from the button or in the middle. The light version does not stop in the middle.
      let appearing: Promise<void> = Promise.resolve()
      const appearedAt = Date.now()
      if (!skipped) {
        if (fromButton && !reduced) {
          if (light) {
            appearing = appear(t.appear)
          } else {
            const rising = moveTo(centre.box, t.rise)
            await appear(t.appear)
            await rising
          }
        } else {
          place(avatarRef.current as HTMLElement, centre.box)
          appearing = appear(t.fadeIn)
          if (!light) await appearing
        }
      }
      if (!skipped && !light && !reduced) hintTimer = setTimeout(() => alive && !skipped && setHint(true), Math.max(0, t.hintAfter - (Date.now() - startedAt)))

      let captionTimer: ReturnType<typeof setTimeout> | undefined
      if (light) {
        // "Welcome back" fades in beside the photo while it waits for the page and then moves.
        if (pub) setBadge({ key: 1, availability: 'now', animate: true, size: fromButton ? 18 : 26, edge: -3 })
        captionTimer = setTimeout(() => alive && !skipped && setCaption(1), t.captionInAt)
      } else if (!skipped) {
        // Line 1 with the rings waking, then line 2 a word at a time.
        setCaption(1)
        if (pub) {
          // The badge starts as it is not yet (gray) and becomes what it is: the real badge plays its own change.
          setBadge({ key: 1, availability: 'offline', animate: true, size: 26, edge: -3 })
          await wait(150)
          setBadge((current) => current && { ...current, availability: 'now' })
          await wait(t.presenceHold - 150)
        } else {
          await wait(t.presenceHold)
        }
        if (!skipped) {
          setCaption(2)
          await wait(t.secondHold)
        }
        clearTimeout(hintTimer)
        setHint(false)
      }

      if (skipped) {
        // Out of the way at once: the page underneath is already coming.
        clearTimeout(captionTimer)
        setCaption(0)
        setAvatarGone(true)
      }
      const slot = await waitForSlot()
      if (!alive) return
      if (!slot) {
        clearTimeout(captionTimer)
        await finishWithoutSlot()
        return
      }
      // A slow page: the photo stays where it is with the rings turning, then settles when something real is there.
      if (!skipped && !contentReady()) {
        const loader = pub && !light
        if (loader) setBadge((current) => current && { ...current, key: current.key + 1, availability: 'now', animate: false })
        await waitForContent(t.contentWait)
        if (loader) setBadge((current) => current && { ...current, animate: true })
      }
      if (!alive) return
      await appearing
      // Light version: the photo and the greeting rest in place long enough to be seen before the photo moves on.
      if (light && !skipped) await wait(Math.max(0, t.lightRest - (Date.now() - appearedAt)))

      const read = () => {
        const next = findSlot()
        return next ? landingBox(next.box, next.kind) : null
      }
      const timers: Array<ReturnType<typeof setTimeout>> = []
      if (skipped) {
        release()
      } else if (light) {
        // The app appears and the page takes clicks again before the photo has landed.
        timers.push(
          setTimeout(() => {
            root.dataset.welcomeFlight = 'reveal'
          }, t.revealAt),
          setTimeout(() => {
            setInstant(false)
            setScrim(false)
            setClickable(true)
          }, t.scrimOutAt),
          setTimeout(() => setCaption(0), t.captionOutAt),
        )
      } else {
        root.dataset.welcomeFlight = 'reveal'
      }
      if (!light) {
        setCaption(0)
        setInstant(false)
        setScrim(false)
      }
      // The top bar always shows your own badge, even when others cannot see it: the photo brings one, quietly.
      setBadge(slot.kind === 'menu' ? null : (current) => ({ key: current?.key ?? 1, availability: 'now', animate: true, size: 16, edge: -2 }))
      if (!skipped) await glide(landingBox(slot.box, slot.kind), t.fly, read)
      clearTimeout(captionTimer)
      timers.forEach(clearTimeout)
      setCaption(0)
      setInstant(false)
      setScrim(false)
      await finishLanding(slot, !light)
    }

    /** No top bar to land on (or the page never came). If the person is still on the way in, do what a plain sign-in does. */
    const finishWithoutSlot = async () => {
      if (markerPathAction(pathRef.current) === 'wait') window.location.replace(flight.next)
      setCaption(0)
      setInstant(false)
      setScrim(false)
      setHint(false)
      record(skipped ? 'signin_flight_skipped' : 'signin_flight_completed')
      // Let the curtain finish lifting before the overlay goes.
      await sleep(reduced || skipped ? 260 : 650)
      release()
      onDone()
    }

    /** The real avatar takes over at exactly this place; the overlay's copy goes in the same frame. */
    const finishLanding = async (slot: Slot, withPop: boolean) => {
      const el = avatarRef.current
      if (el && !skipped) {
        if (slot.kind === 'avatar') setRinged(true)
        if (withPop && !reduced && slot.kind === 'avatar') {
          const pop = track(el.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.06)' }, { transform: 'scale(1)' }], { duration: 320, easing: 'ease-in-out' }))
          await pop.finished.catch(() => undefined)
          running.delete(pop)
        } else if (slot.kind === 'menu') {
          const tuck = track(el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: reduced ? 120 : 250, fill: 'forwards' }))
          await tuck.finished.catch(() => undefined)
        }
      }
      release()
      setAvatarGone(true)
      focusMain()
      record(skipped ? 'signin_flight_skipped' : 'signin_flight_completed')
      await sleep(skipped ? 260 : 150)
      onDone()
    }

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || event.key === 'Enter') skip.current()
    }
    // Hidden mid-flight: jump to the end instead of running unseen.
    const onVisibility = () => {
      if (document.hidden) skip.current()
    }
    window.addEventListener('keydown', onKey)
    document.addEventListener('visibilitychange', onVisibility)
    const watchdog = setTimeout(() => {
      // Whatever went wrong, the person is never left behind a curtain.
      release()
      if (alive && markerPathAction(pathRef.current) === 'wait') window.location.replace(flight.next)
      onDone()
    }, t.max)
    void run().catch(() => {
      release()
      onDone()
    })

    return () => {
      alive = false
      clearTimeout(watchdog)
      clearTimeout(hintTimer)
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('visibilitychange', onVisibility)
      waits.forEach((resume) => resume())
      running.forEach((animation) => animation.cancel())
      release()
    }
    // The flight is planned once, from what was true when the sign-in finished.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div data-signin-overlay className={cn('fixed inset-0 z-[1000] cursor-default', clickable && 'pointer-events-none')} onClick={() => skip.current()}>
      <div
        className={cn('absolute inset-0 bg-background transition-opacity', scrim ? 'opacity-100' : 'opacity-0')}
        style={{ transitionDuration: instant ? '0ms' : reduced || leaving ? '200ms' : `${signInTimings(flight.version, reduced)[scrim ? 'scrimIn' : 'scrimOut']}ms`, transitionTimingFunction: EASE }}
      />
      <div role="status" aria-live="polite" className="sr-only">
        {announce}
      </div>
      <div className="absolute inset-x-0" style={{ top: layout.captionTop }}>
        <p
          data-signin-caption="first"
          aria-hidden="true"
          dir="auto"
          className={cn(CAPTION, 'absolute inset-x-4 text-center transition-opacity', caption === 1 ? 'opacity-100 duration-300' : 'opacity-0 duration-150')}
        >
          {lines.first}
        </p>
        <p
          data-signin-caption="second"
          aria-hidden="true"
          dir="auto"
          className={cn(CAPTION, 'absolute inset-x-4 text-center transition-opacity', caption === 2 ? 'opacity-100 delay-150 duration-300' : 'opacity-0 duration-150')}
        >
          {lines.second}
        </p>
      </div>
      <p className={cn('absolute inset-x-0 bottom-5 text-center text-xs text-muted-foreground transition-opacity duration-[400ms]', hint ? 'opacity-100' : 'opacity-0')}>
        Click or press Esc to skip
      </p>
      {avatarGone ? null : (
        <div
          ref={avatarRef}
          data-signin-avatar
          className={cn('pointer-events-none fixed rounded-md transition-shadow duration-500', ringed && 'ring-2 ring-white dark:ring-zinc-950')}
          style={startStyle}
        >
          <div className={cn('h-full w-full [&_img]:transition-opacity [&_img]:duration-200', !photoReady && '[&_img]:opacity-0')}>
            <UserAvatar
              identity={{ id: flight.userId, fullName: flight.fullName, username: flight.username, avatarUrl: flight.avatarUrl }}
              style={{ width: '100%', height: '100%' }}
              roundedClassName="rounded-[inherit]"
              sizes="128px"
              priority
            />
          </div>
          {badge ? (
            <PresenceBadge
              key={badge.key}
              availability={badge.availability}
              size={badge.size}
              animate={badge.animate}
              statusEmoji={flight.status?.emoji}
              statusSize={20}
              statusPaused={flight.status?.pausesNotifications}
              className="absolute"
              style={{ right: badge.edge, bottom: badge.edge }}
            />
          ) : null}
        </div>
      )}
    </div>
  )
}

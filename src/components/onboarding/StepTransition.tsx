'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

export interface StepTransitionProps {
  children: React.ReactNode
  step: number
  transitionKey?: string | number
  direction: 'forward' | 'backward' | 'section'
}

/**
 * Checks whether reduced motion is preferred via the `prefers-reduced-motion`
 * media query or the `data-reduce-motion` attribute on the document element.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return true
  if (document.documentElement.hasAttribute('data-reduce-motion')) return true
  return false
}

/**
 * Returns the CSS transform for the enter/exit phases based on direction.
 *
 * - forward: exit left (-4px), enter from right (+4px)
 * - backward: exit right (+4px), enter from left (-4px)
 * - section: cross-fade only, no directional movement
 */
export function getTranslateX(
  direction: 'forward' | 'backward' | 'section',
  phase: 'exit' | 'enter',
): string {
  if (direction === 'section') return 'translateX(0)'
  if (direction === 'forward') {
    return phase === 'exit' ? 'translateX(-4px)' : 'translateX(4px)'
  }
  // backward
  return phase === 'exit' ? 'translateX(4px)' : 'translateX(-4px)'
}

export const EXIT_DURATION = 80
export const ENTER_DURATION = 100

/**
 * StepTransition — Wrapper component that animates step content transitions.
 *
 * Forward navigation: fade/4px shift (180ms); section changes cross-fade only.
 *
 * Uses CSS transforms only (GPU-accelerated, no layout thrash).
 * Respects `prefers-reduced-motion` and `data-reduce-motion` — instant swap when enabled.
 * Moves focus to [data-step-header] after transition completes.
 */
export function StepTransition({ children, step, transitionKey = step, direction }: StepTransitionProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [displayedChildren, setDisplayedChildren] = useState(children)
  const [phase, setPhase] = useState<'idle' | 'exit' | 'enter-start' | 'enter-active'>('idle')
  const previousKeyRef = useRef(transitionKey)
  const animationRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rafRef = useRef<number | null>(null)

  const moveFocusToHeader = useCallback(() => {
    const header = containerRef.current?.querySelector('[data-step-header]') as HTMLElement | null
    if (header) {
      header.setAttribute('tabindex', '-1')
      header.focus({ preventScroll: true })
    }
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animationRef.current) clearTimeout(animationRef.current)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  useEffect(() => {
    // No transition on initial render
    if (previousKeyRef.current === transitionKey) {
      setDisplayedChildren(children)
      return
    }

    previousKeyRef.current = transitionKey

    // Instant swap when reduced motion is preferred
    if (prefersReducedMotion()) {
      setDisplayedChildren(children)
      setPhase('idle')
      // Still move focus even with reduced motion
      requestAnimationFrame(() => {
        moveFocusToHeader()
      })
      return
    }

    // Clear any pending animation
    if (animationRef.current) clearTimeout(animationRef.current)
    if (rafRef.current) cancelAnimationFrame(rafRef.current)

    // Phase 1: Exit — fade out current content with directional slide
    setPhase('exit')

    animationRef.current = setTimeout(() => {
      // Phase 2: Swap content and set enter start position (no transition yet)
      setDisplayedChildren(children)
      setPhase('enter-start')

      // Phase 3: After browser paints the start position, trigger enter animation
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = requestAnimationFrame(() => {
          setPhase('enter-active')

          // Phase 4: After enter animation completes, return to idle
          animationRef.current = setTimeout(() => {
            setPhase('idle')
            moveFocusToHeader()
          }, ENTER_DURATION)
        })
      })
    }, EXIT_DURATION)
  }, [children, moveFocusToHeader, transitionKey])

  // Compute inline styles based on current phase
  const style: React.CSSProperties = (() => {
    switch (phase) {
      case 'idle':
        return { opacity: 1, transform: 'translateX(0)' }

      case 'exit':
        return {
          opacity: 0,
          transform: getTranslateX(direction, 'exit'),
          transition: `opacity ${EXIT_DURATION}ms cubic-bezier(.2,.8,.3,1), transform ${EXIT_DURATION}ms cubic-bezier(.2,.8,.3,1)`,
        }

      case 'enter-start':
        // Initial position for enter — no transition so it snaps into place
        return {
          opacity: 0,
          transform: getTranslateX(direction, 'enter'),
        }

      case 'enter-active':
        // Animate from enter-start position to final position
        return {
          opacity: 1,
          transform: 'translateX(0)',
          transition: `opacity ${ENTER_DURATION}ms cubic-bezier(.2,.8,.3,1), transform ${ENTER_DURATION}ms cubic-bezier(.2,.8,.3,1)`,
        }
    }
  })()

  return (
    <div
      ref={containerRef}
      className={cn(phase !== 'idle' && 'will-change-[opacity,transform]')}
      style={style}
      aria-busy={phase !== 'idle'}
    >
      {displayedChildren}
    </div>
  )
}

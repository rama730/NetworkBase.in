'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { PixelIcon } from '@/components/auth/pixel'
import { PixelPerson } from '@/components/ui/PixelPerson'
import { OnboardingSteps } from '@/components/onboarding/OnboardingSteps'
import { Face, OnboardingCard, firstNameOf, type CardData } from '@/components/onboarding/OnboardingPanel'
import { ONBOARDING_TOTAL_STEPS, type OnboardingVisibility } from '@/lib/onboarding/contracts'
import { pixelPersonPair } from '@/lib/ui/avatar'
import type { Box } from '@/lib/onboarding/welcome-flight'

type Trail = { destroy(): void; refresh(): void }

interface FinishScreenProps {
  /** Everything the card shows. */
  data: CardData
  /** The user id: your pixel person's colours, the same as in the top bar the welcome flight lands in. */
  userId: string
  /** Where the button goes, named: "Go to Discover" or just "Continue" when the person was heading elsewhere. */
  continueLabel: string
  /** Gets your avatar's place on screen, so the welcome flight can start from exactly there. */
  onContinue: (avatarBox: Box | null) => void
}

export const VISIBILITY_NOTE: Record<OnboardingVisibility, string> = {
  public: 'Your profile is live. Connect with developers, collaborate on workspaces, and manage tasks across your workspace.',
  connections: 'Your profile is set up and visible to your connections. Connect with developers and collaborate on workspaces.',
  private: 'Your profile is set up and hidden from Discovery. You can change who sees it any time in Settings.',
}

const SIDE = 8

/**
 * Shown once, after the profile is saved: one hero grid. A row of people like the home page band (new code; the band itself
 * stays locked), you drop into the middle and say hi with your first skill, then the card and the button with the ring.
 * It waits for the person: nothing redirects them.
 */
export function FinishScreen({ data, userId, continueLabel, onContinue }: FinishScreenProps) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const meRef = useRef<HTMLSpanElement>(null)
  const stage = useRef<HTMLElement | null>(null)
  // Pressed once: the flight (or the navigation) takes over, and a second press must not start another.
  const [continuing, setContinuing] = useState(false)
  useEffect(() => {
    headingRef.current?.focus()
  }, [])
  useEffect(() => {
    let gone = false
    let trail: Trail | null = null
    void import('@/lib/grid-trail').then(({ attachGridTrail }) => {
      if (gone || !stage.current) return
      trail = attachGridTrail(stage.current, 'hero')
      void document.fonts?.ready.then(() => trail?.refresh())
    })
    return () => { gone = true; trail?.destroy() }
  }, [])

  const [figure] = pixelPersonPair(userId)
  const skill = data.skills[0]
  const first = firstNameOf(data.fullName)
  const person = (k: number, order: number) => (
    <span key={k} className="nb-onb-people-f" style={{ ['--c' as string]: order }}>
      <PixelPerson identityKey={`${userId}:${k}`} tile={false} />
    </span>
  )

  return (
    <div className="nb-onb-finish">
      <OnboardingSteps currentStep={0} completedThrough={ONBOARDING_TOTAL_STEPS} />
      <section ref={stage} className="nb-err-stage nb-onb-finish-stage" data-trail-script="nb whoami|nb next" aria-labelledby="onb-finish-title">
        <p className="nb-err-path" aria-hidden="true"><span>networkbase / </span><b>u/{data.username}</b><span className="nb-auth-caret nb-onb-inline-caret" /></p>
        <div className="nb-onb-people-wrap" aria-hidden="true">
          <div className="nb-onb-people">
            <div className="nb-onb-people-row">
              {Array.from({ length: SIDE }, (_, k) => person(k, SIDE - k))}
              <span ref={meRef} className="nb-onb-people-me"><Face avatarUrl={data.avatarUrl} identityKey={userId} size={54} /></span>
              {Array.from({ length: SIDE }, (_, k) => person(k + 40, k + 1))}
            </div>
          </div>
          <p className="nb-onb-bubble" style={{ ['--bc' as string]: data.avatarUrl ? 'var(--nb-brand)' : figure }}>
            {skill ? <>Hi! I know <b>{skill}</b>.</> : 'Hi! I just joined.'}
          </p>
        </div>
        <span className="nb-onb-finish-mark"><PixelIcon name="check" size={24} /></span>
        <h1 id="onb-finish-title" ref={headingRef} tabIndex={-1} className="nb-err-title">
          Welcome to NetworkBase, {first || data.username}.
        </h1>
        <p className="nb-err-lead">{VISIBILITY_NOTE[data.visibility]}</p>
        <div className="nb-onb-finish-card"><OnboardingCard data={data} identityKey={userId} /></div>
        <div className="nb-err-actions" data-cta-row="">
          <Button
            type="button"
            data-cta=""
            className="nb-err-primary"
            disabled={continuing}
            aria-busy={continuing || undefined}
            onClick={() => {
              if (continuing) return
              setContinuing(true)
              const rect = meRef.current?.getBoundingClientRect()
              onContinue(rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null)
            }}
          >
            {continueLabel}
          </Button>
        </div>
      </section>
    </div>
  )
}

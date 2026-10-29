'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { UserAvatar } from '@/components/ui/UserAvatar'
import type { OnboardingVisibility } from '@/lib/onboarding/contracts'
import type { Box } from '@/lib/onboarding/welcome-flight'

interface FinishScreenProps {
  fullName: string
  username: string
  /** Part of the photo's identity everywhere else in the app, so its colour matches the top bar's. */
  userId: string
  headline: string
  avatarUrl: string
  skills: string[]
  visibility: OnboardingVisibility
  /** Where the button goes, named: "Go to Discover" or just "Continue" when the person was heading elsewhere. */
  continueLabel: string
  /** Gets the photo's place on screen, so the welcome flight can start from exactly there. */
  onContinue: (avatarBox: Box | null) => void
}

export const VISIBILITY_NOTE: Record<OnboardingVisibility, string> = {
  public: 'Your profile is live. Connect with developers, collaborate on workspaces, and manage tasks across your workspace.',
  connections: 'Your profile is set up and visible to your connections. Connect with developers and collaborate on workspaces.',
  private: 'Your profile is set up and hidden from Discovery. You can change who sees it any time in Settings.',
}

/** Shown once, after the profile is saved. It waits for the person: nothing redirects them. */
export function FinishScreen({ fullName, username, userId, headline, avatarUrl, skills, visibility, continueLabel, onContinue }: FinishScreenProps) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const avatarRef = useRef<HTMLDivElement>(null)
  // Pressed once: the flight (or the navigation) takes over, and a second press must not start another.
  const [continuing, setContinuing] = useState(false)
  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  return (
    <div className="flex flex-col items-center py-6 text-center sm:py-10">
      <div ref={avatarRef}>
        <UserAvatar identity={{ id: userId, fullName, username, avatarUrl }} size={64} />
      </div>
      <h1 ref={headingRef} tabIndex={-1} className="mt-5 text-2xl font-bold tracking-tight text-foreground outline-none sm:text-3xl">
        Welcome to NetworkBase, {fullName}!
      </h1>
      <p className="mt-1 text-sm font-medium text-muted-foreground">@{username}</p>
      {headline ? <p className="mt-1 max-w-md text-xs text-muted-foreground">{headline}</p> : null}

      <div className="mb-6 mt-6 max-w-md rounded-lg border border-border bg-card p-4 text-left shadow-sm sm:p-5">
        <p className="text-sm leading-relaxed text-foreground">{VISIBILITY_NOTE[visibility]}</p>
        {skills.length > 0 ? (
          <ul className="mt-3 flex flex-wrap gap-1.5 border-t border-border pt-3" aria-label="Your top skills">
            {skills.slice(0, 5).map((skill) => (
              <li key={skill} className="rounded-[4px] bg-muted px-2 py-0.5 text-[11px] font-medium text-foreground">
                {skill}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <Button
        type="button"
        disabled={continuing}
        aria-busy={continuing || undefined}
        onClick={() => {
          if (continuing) return
          setContinuing(true)
          const rect = avatarRef.current?.getBoundingClientRect()
          onContinue(rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null)
        }}
        className="min-h-11 px-6"
      >
        {continueLabel}
      </Button>
    </div>
  )
}

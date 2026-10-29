'use client'

import { useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { UserAvatar } from '@/components/ui/UserAvatar'
import type { OnboardingVisibility } from '@/lib/onboarding/contracts'

interface FinishScreenProps {
  fullName: string
  username: string
  headline: string
  avatarUrl: string
  skills: string[]
  visibility: OnboardingVisibility
  /** Where the button goes, named: "Go to Discover" or just "Continue" when the person was heading elsewhere. */
  continueLabel: string
  onContinue: () => void
}

const VISIBILITY_NOTE: Record<OnboardingVisibility, string> = {
  public: 'Your profile is live. Connect with developers, collaborate on workspaces, and manage tasks across your workspace.',
  connections: 'Your profile is set up and visible to your connections. Connect with developers and collaborate on workspaces.',
  private: 'Your profile is set up and hidden from Discovery. You can change who sees it any time in Settings.',
}

/** Shown once, after the profile is saved. It waits for the person: nothing redirects them. */
export function FinishScreen({ fullName, username, headline, avatarUrl, skills, visibility, continueLabel, onContinue }: FinishScreenProps) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  return (
    <div className="flex flex-col items-center py-6 text-center sm:py-10">
      <UserAvatar identity={{ fullName, username, avatarUrl }} size={64} />
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

      <Button type="button" onClick={onContinue} className="min-h-11 px-6">
        {continueLabel} 
      </Button>
    </div>
  )
}

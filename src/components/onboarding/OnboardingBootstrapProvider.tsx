'use client'

import { createContext, useContext } from 'react'
import type { OnboardingDraft } from '@/lib/validations/onboarding'

export type OnboardingBootstrap = {
  userId: string
  draft: {
    step: number
    completedThrough: number
    version: number
    data: OnboardingDraft
  }
}

const OnboardingBootstrapContext = createContext<OnboardingBootstrap | null>(null)

export function OnboardingBootstrapProvider({
  value,
  children,
}: {
  value: OnboardingBootstrap
  children: React.ReactNode
}) {
  return (
    <OnboardingBootstrapContext.Provider value={value}>
      {children}
    </OnboardingBootstrapContext.Provider>
  )
}

export function useOnboardingBootstrap(): OnboardingBootstrap {
  const value = useContext(OnboardingBootstrapContext)
  if (!value) {
    throw new Error('useOnboardingBootstrap must be used inside OnboardingBootstrapProvider')
  }
  return value
}

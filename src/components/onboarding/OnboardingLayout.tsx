"use client"

import { cn } from '@/lib/utils'

interface OnboardingLayoutProps {
  children: React.ReactNode
  sidebar?: React.ReactNode
  mobileProgress?: React.ReactNode
}

/**
 * OnboardingLayout — Split-pane shell for the onboarding flow.
 *
 * Desktop (≥1024px): sidebar 248px fixed left, form content max-width 608px centered right.
 * Tablet and mobile (<1024px): one column with the compact progress bar.
 *
 * Uses flat `background` color (no gradient). Content area has generous
 * vertical padding (48px top, 32px bottom).
 */
export function OnboardingLayout({
  children,
  sidebar,
  mobileProgress,
}: OnboardingLayoutProps) {
  return (
    <div className={cn('onb-page min-h-dvh lg:grid lg:grid-cols-[248px_minmax(0,1fr)]')}>
      <aside
        className={cn(
          'onb-progress-rail hidden border-r border-border lg:block',
          'h-dvh sticky top-0 overflow-y-auto'
        )}
      >
        {sidebar}
      </aside>

      <section className="min-w-0">
        <div className="lg:hidden">{mobileProgress}</div>
        <main
          className={cn(
            'mx-auto flex min-h-[calc(100dvh-3.5rem)] w-full flex-col px-4 pb-8 pt-10',
            'md:min-h-dvh md:max-w-[560px] md:px-6 md:pb-10 md:pt-12',
            'lg:max-w-[608px] lg:px-6 lg:pt-16'
          )}
        >
          {children}
        </main>
      </section>
    </div>
  )
}

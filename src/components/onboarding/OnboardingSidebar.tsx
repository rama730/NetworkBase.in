"use client"

import Logo from '@/components/layout/header/Logo'
import { LegalLinks } from '@/components/legal/LegalLinks'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'


interface OnboardingSidebarProps {
  currentStep: number
  totalSteps: number
  stepLabels: Array<{ title: string; subtitle: string }>
  completedSteps: Set<number>
  justCompletedStep?: number | null
}

/**
 * OnboardingSidebar — Persistent left rail showing brand, vertical stepper progress, and help link.
 *
 * Width: 248px on desktop (≥1024px), hidden below the desktop breakpoint.
 * Background: `card` with a right `border`.
 * Top: brand logo/mark (24px height) + app name.
 * Middle: VerticalStepper with numbered circles.
 * Bottom: "Need help?" link.
 *
 * Requirements: 1.4, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 16.5
 */
export function OnboardingSidebar({
  currentStep,
  totalSteps,
  stepLabels,
  completedSteps,
  justCompletedStep = null,
}: OnboardingSidebarProps) {
  return (
    <div className="flex h-full flex-col px-6 py-8">
      {/* Top: Brand logo/mark + app name */}
      <div className="mb-12">
        <Logo />
        <p className="onb-wordmark-kicker mt-5">Profile setup</p>
        <p className="mt-2 max-w-[19ch] text-[13px] leading-5 text-muted-foreground">
          Build a profile that helps the right collaborators find you.
        </p>
      </div>

      {/* Middle: Vertical Stepper */}
      <nav aria-label="Onboarding progress" className="flex-1">
        <ol className="relative flex flex-col">
          {Array.from({ length: totalSteps }, (_, i) => {
            const step = i + 1
            const isCurrent = step === currentStep
            const showAcknowledgedCheck = isCurrent && justCompletedStep === step
            const isCompleted = completedSteps.has(step) && !isCurrent
            const isPending = !isCompleted && !isCurrent

            return (
              <li
                key={step}
                className="relative grid grid-cols-[24px_minmax(0,1fr)] items-start gap-3 pb-8 last:pb-0"
                {...(isCurrent ? { 'aria-current': 'step' as const } : {})}
              >
                {/* Connecting line (not on last step) */}
                {step < totalSteps && (
                  <>
                    {/* Gray background line segment */}
                    <div
                      className="absolute left-[11px] top-3 bottom-[-12px] z-0 w-px bg-border"
                      aria-hidden="true"
                    />
                    {/* Blue animated progress line segment */}
                    <div
                      className="absolute left-[11px] top-3 z-0 w-px origin-top bg-primary transition-transform duration-200 ease-[cubic-bezier(0.2,0.8,0.3,1)]"
                      style={{ bottom: '-12px', transform: `scaleY(${isCompleted ? 1 : 0})` }}
                      aria-hidden="true"
                    />
                  </>
                )}
                {/* Step indicator circle */}
                <div className="relative z-10 flex shrink-0 items-center justify-center">
                  {(isCompleted || showAcknowledgedCheck) && (
                    <div className="animate-stepper-fill relative flex h-6 w-6 items-center justify-center overflow-hidden rounded-full bg-primary shadow-none">
                      <Check className="animate-stepper-check h-3 w-3 text-primary-foreground" strokeWidth={3} />
                      <span className="sr-only">Step {step} completed</span>
                    </div>
                  )}
                  {isCurrent && !showAcknowledgedCheck && (
                    <div className="relative flex h-6 w-6 items-center justify-center overflow-hidden rounded-full border-2 border-primary bg-card text-primary shadow-none">
                      <div className="absolute inset-0 bg-primary/10" />
                      <span className="relative z-10 text-[11px] font-semibold tabular-nums">{step}</span>
                    </div>
                  )}
                  {isPending && (
                    <div className="relative flex h-6 w-6 items-center justify-center overflow-hidden rounded-full border border-border bg-card text-muted-foreground shadow-none">
                      <div className="absolute inset-0 bg-muted-foreground/10" />
                      <span className="relative z-10 font-mono text-[11px] font-medium">
                        {step}
                      </span>
                    </div>
                  )}
                </div>

                {/* Step labels */}
                <div className="min-w-0 pt-0.5">
                  <p
                    className={cn(
                      'text-[13px] font-medium leading-5',
                      isCurrent ? 'text-foreground' : isCompleted ? 'text-foreground' : 'text-muted-foreground'
                    )}
                  >
                    {stepLabels[i]?.title}
                  </p>
                  <p className="mt-0.5 text-[12px] leading-tight text-muted-foreground">
                    {stepLabels[i]?.subtitle}
                  </p>
                </div>
              </li>
            )
          })}
        </ol>
      </nav>

      {/* Bottom: Help & Legal info */}
      <div className="mt-auto border-t border-border pt-5 space-y-2.5">
        <div className="flex items-center justify-between text-[13px] text-muted-foreground">
          <a
            href="mailto:support@networkbase.in?subject=Onboarding%20help"
            className="onb-focusable rounded transition-colors hover:text-foreground"
          >
            Need help?
          </a>
          <span className="text-[11px] font-mono text-muted-foreground/60">v0.1.0</span>
        </div>
        <LegalLinks align="start" showCopyright className="text-[11px]" />
      </div>
    </div>
  )
}

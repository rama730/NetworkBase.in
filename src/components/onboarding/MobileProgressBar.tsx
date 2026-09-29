import { cn } from '@/lib/utils'

interface MobileProgressBarProps {
  currentStep: number
  totalSteps: number
  stepLabels: string[]
  completedThrough: number
  justCompletedStep?: number | null
  /** Mono prefix before the step name; the create-project wizard reuses this bar (spec §18). */
  label?: string
  ariaLabel?: string
  className?: string
}

export function MobileProgressBar({
  currentStep,
  totalSteps,
  stepLabels,
  completedThrough,
  justCompletedStep = null,
  label = 'Setup',
  ariaLabel = 'Onboarding progress',
  className,
}: MobileProgressBarProps) {
  return (
    <div
      className={cn(
        'sticky top-0 z-50 flex h-14 items-center justify-between px-4',
        'bg-card border-b border-border',
        'lg:hidden',
        className
      )}
      role="progressbar"
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={totalSteps}
      aria-valuenow={completedThrough}
    >
      {/* Current step label */}
      <span className="min-w-0 truncate text-[13px] font-medium text-foreground">
        <span className="mr-2 font-mono text-[11px] uppercase tracking-[.09em] text-primary">{label}</span>
        {stepLabels[currentStep - 1] ?? ''}
      </span>

      {/* Horizontal dots connected by lines */}
      <div className="flex items-center gap-0">
        {Array.from({ length: totalSteps }, (_, i) => {
          const step = i + 1
          const isCompleted = step <= completedThrough && step !== currentStep
          const isCurrent = step === currentStep
          const showAcknowledgedCheck = isCurrent && justCompletedStep === step
          const isPending = !isCompleted && !isCurrent

          return (
            <div key={step} className="flex items-center">
              {/* Connecting line before dot (skip for first) */}
              {i > 0 && (
                <div
                  className={cn(
                    'h-[2px] w-4',
                    completedThrough >= step - 1 ? 'bg-primary' : 'bg-border'
                  )}
                />
              )}

              <div className="flex h-6 w-6 shrink-0 items-center justify-center">
                {(isCompleted || showAcknowledgedCheck) && (
                  <div className="h-2 w-2 rounded-full bg-primary" />
                )}
                {isCurrent && !showAcknowledgedCheck && (
                  <div className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-primary bg-primary/10">
                    <span className="text-[11px] font-semibold text-primary tabular-nums">{step}</span>
                  </div>
                )}
                {isPending && (
                  <div className="h-2 w-2 rounded-full bg-muted-foreground/30" />
                )}
              </div>
            </div>
          )
        })}
      </div>

      <span className="ml-3 shrink-0 font-mono text-[11px] tracking-[.04em] text-muted-foreground tabular-nums">
        {currentStep}/{totalSteps}
      </span>
    </div>
  )
}

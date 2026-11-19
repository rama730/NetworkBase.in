import { cn } from '@/lib/utils'

interface MobileProgressBarProps {
  currentStep: number
  totalSteps: number
  stepLabels: string[]
  completedThrough: number
  /** Finished steps become buttons that go back to that step. */
  onSelectStep?: (step: number) => void
}

export function MobileProgressBar({ currentStep, totalSteps, stepLabels, completedThrough, onSelectStep }: MobileProgressBarProps) {
  return (
    <div className="flex h-14 items-center justify-between gap-3 border-b border-border bg-card px-4">
      <p className="min-w-0 truncate text-[13px] font-medium text-foreground">
        <span className="mr-2 font-mono text-[11px] uppercase tracking-[.09em] text-primary">
          Step {currentStep} of {totalSteps}
        </span>
        {stepLabels[currentStep - 1] ?? ''}
      </p>

      <ol className="flex shrink-0 items-center" aria-label="Steps">
        {Array.from({ length: totalSteps }, (_, i) => {
          const step = i + 1
          const isCurrent = step === currentStep
          const isDone = step <= completedThrough && !isCurrent
          return (
            <li key={step} className="flex" aria-current={isCurrent ? 'step' : undefined}>
              {isDone && onSelectStep ? (
                <button
                  type="button"
                  onClick={() => onSelectStep(step)}
                  aria-label={`Go to step ${step}: ${stepLabels[i]}`}
                  className="onb-focusable flex h-11 w-9 items-center justify-center rounded"
                >
                  <span className="h-2.5 w-2.5 rounded-full bg-primary" />
                </button>
              ) : (
                <span className="flex h-11 w-9 items-center justify-center">
                  <span
                    className={cn(
                      'h-2.5 w-2.5 rounded-full',
                      isDone && 'bg-primary',
                      isCurrent && 'h-3.5 w-3.5 border-2 border-primary bg-primary/10',
                      !isDone && !isCurrent && 'border border-muted-foreground',
                    )}
                  />
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

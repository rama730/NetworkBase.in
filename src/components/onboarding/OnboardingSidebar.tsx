import { LegalLinks } from '@/components/legal/LegalLinks'
import { BrandMark } from '@/components/brand/BrandMark'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

interface OnboardingSidebarProps {
  currentStep: number
  stepLabels: Array<{ title: string; subtitle: string }>
  completedThrough: number
  /** Finished steps become buttons that go back to that step. */
  onSelectStep?: (step: number) => void
}

/** Desktop progress rail: brand, the four steps, help and legal. Not a link out: leaving mid-setup just bounces back. */
export function OnboardingSidebar({ currentStep, stepLabels, completedThrough, onSelectStep }: OnboardingSidebarProps) {
  return (
    <div className="flex h-full flex-col px-6 py-8">
      <div className="mb-12">
        <BrandMark size={17} />
        <p className="onb-wordmark-kicker mt-5">Profile setup</p>
        <p className="mt-2 max-w-[19ch] text-[13px] leading-5 text-muted-foreground">
          Build a profile that helps the right collaborators find you.
        </p>
      </div>

      <ol className="flex-1" aria-label="Setup steps">
        {stepLabels.map((label, i) => {
          const step = i + 1
          const isCurrent = step === currentStep
          const isDone = step <= completedThrough && !isCurrent
          const body = (
            <>
              <span
                className={cn(
                  'relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums',
                  isDone && 'bg-primary text-primary-foreground',
                  isCurrent && 'border-2 border-primary bg-primary/10 text-primary',
                  !isDone && !isCurrent && 'border border-border bg-card text-muted-foreground',
                )}
              >
                {isDone ? <Check className="h-3 w-3" strokeWidth={3} aria-hidden="true" /> : step}
              </span>
              <span className="min-w-0 pt-0.5 text-left">
                <span className={cn('block text-[13px] font-medium leading-5', isCurrent || isDone ? 'text-foreground' : 'text-muted-foreground')}>
                  {label.title}
                  {isDone ? <span className="sr-only"> (completed)</span> : null}
                </span>
                <span className="mt-0.5 block text-[12px] leading-tight text-muted-foreground">{label.subtitle}</span>
              </span>
            </>
          )
          return (
            <li key={step} className="relative pb-8 last:pb-0" aria-current={isCurrent ? 'step' : undefined}>
              {step < stepLabels.length ? (
                <span
                  className={cn('absolute left-[11px] top-6 bottom-0 w-px', step <= completedThrough ? 'bg-primary' : 'bg-border')}
                  aria-hidden="true"
                />
              ) : null}
              {isDone && onSelectStep ? (
                <button
                  type="button"
                  onClick={() => onSelectStep(step)}
                  className="onb-focusable grid min-h-11 w-full grid-cols-[24px_minmax(0,1fr)] items-start gap-3 rounded"
                >
                  {body}
                </button>
              ) : (
                <div className="grid grid-cols-[24px_minmax(0,1fr)] items-start gap-3">{body}</div>
              )}
            </li>
          )
        })}
      </ol>

      <div className="mt-auto space-y-2.5 border-t border-border pt-5">
        <a
          href="mailto:support@networkbase.in?subject=Onboarding%20help"
          className="onb-link inline-flex min-h-11 items-center rounded text-[13px] text-muted-foreground transition-colors hover:text-foreground"
        >
          Need help?
        </a>
        <LegalLinks align="start" showCopyright className="text-[11px]" />
      </div>
    </div>
  )
}
